# Spec — VOLEA Torneos online (gestor en el admin + público en vivo)

**Fecha:** 2026-07-29
**Estado:** aprobado en diseño, pendiente de plan de implementación (por etapa)
**Repos:** trabajo principal en `VOLEA/` (web pública, React 19 + Vite + Supabase `volea-web` + Vercel). Origen del código a migrar: `pickle-torneos/` (motor + UI del gestor, 86 tests, estética VOLEA navy+lima).

## 1. Objetivo

Llevar **todo el gestor de torneos** (grupos+llave dobles, One Point Challenge individual, canchas, ranking VOLEA con padrón) a la webapp pública de VOLEA:

- **Organizar** desde `/#/admin` (los 3 admins actuales), con datos en Supabase `volea-web` y **local-first + sync** para que la cancha sin wifi no frene nada.
- **Mirar** desde páginas públicas: `/#/ranking` y `/#/torneos` (+ detalle por torneo con grupos, tablas, llave y podio), **en vivo** mientras se juega.
- La app local (`pickle-torneos`, abrir-torneos.bat) queda **congelada como respaldo**; la web pasa a ser la única fuente de verdad y todo lo nuevo se construye acá.

Decisiones ya tomadas con Brian: gestor online completo (no solo publicación) · torneos visibles en vivo con interruptor por torneo (default visible) · web manda, local de respaldo.

## 2. No-objetivos

- **Edición concurrente fina** del mismo torneo por dos admins a la vez (modelo documento, último-gana con aviso; ver §4.3). Un organizador por torneo es el caso real.
- **Realtime por websockets**: lo público refresca por polling (§6). Realtime queda como mejora futura si el polling molesta.
- **Canje de puntos** (pieza aparte, ya esbozada en pickle-torneos) y cuentas de jugadores no-admin: nada de login para jugadores.
- **Migración automática silenciosa** de datos: la importación es explícita (Brian sube sus `.torneo.json`).
- Tocar el flujo de e-commerce/bot/caja existente: cero cambios fuera de lo listado.

## 3. Datos (Supabase `volea-web`)

Tres tablas nuevas, prefijo `rk_` (migraciones vía MCP de Supabase, como el resto del proyecto):

```sql
create table rk_torneos (
  id text primary key,              -- el id que ya genera la app (nuevoId)
  nombre text not null,
  fase text not null,               -- denormalizado de data para listar/filtrar
  categoria text,                   -- 'A' | 'B' | null
  visible boolean not null default true,       -- interruptor "lo ve el público"
  cuenta_ranking boolean not null default true,
  data jsonb not null,              -- el objeto Torneo COMPLETO (mismo shape que la app local, estado v2)
  creado_el timestamptz not null,
  updated_at timestamptz not null default now()
);
create table rk_jugadores (
  id text primary key,
  nombre text not null,
  alias jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create table rk_config (
  id int primary key default 1 check (id = 1),  -- fila única
  data jsonb not null,              -- ConfigPuntos { escalera, offsetB }
  updated_at timestamptz not null default now()
);
```

**RLS** (patrones ya probados en este proyecto):
- `rk_torneos`: SELECT anon/authenticated **solo `visible = true`**; admins (vía `is_admin()`) SELECT todo + INSERT/UPDATE/DELETE.
- `rk_jugadores`, `rk_config`: SELECT público; escritura solo admins.
- Nada de upsert anónimo (trampa conocida de `orders`): todas las escrituras van autenticadas como admin.
- Los campos denormalizados (`nombre`, `fase`, `categoria`, `visible`, `cuenta_ranking`, `creado_el`) se reescriben desde `data` en cada guardado — `data` es la verdad.

## 4. El gestor en el admin (Etapa 1)

### 4.1 Código que se muda desde pickle-torneos

A `VOLEA/src/torneos/` (carpeta propia, aislada del resto de la web):
- `engine/` completo (tipos, rng, fixture, tabla, clasificacion, llave, llaveIndividual, grupos, canchas, ranking, padron) **con sus tests** (se agrega `vitest` como devDependency y script `npm test`; config `environment: 'node'`).
- `components/` del gestor (PasoParejas/Grupos/FaseGrupos/Llave, PantallaRanking/Jugadores/ConfigPuntos, reconciliar, dialogos) y su CSS como `torneos.css` **con las clases scopeadas bajo `.rk`** (un wrapper `<div className="rk">`) para no pisar los estilos de la web.
- Adaptaciones permitidas: imports, el shell (el wizard ya no vive en un App propio sino dentro de la pestaña), y el reemplazo de `storage.ts` por el sync (§4.2). El motor NO se toca.

### 4.2 Persistencia local-first + sync

Módulo nuevo `src/torneos/sync.ts`:
- **Cache local**: el estado completo (torneos + jugadores + config) vive en localStorage clave `volea-torneos:cache` con el shape del estado v2 de la app local. La UI lee/escribe SIEMPRE contra el cache (instantáneo, funciona offline).
- **Push**: cada cambio marca el torneo/jugadores/config como "sucio" y dispara un upsert a Supabase con debounce (~1,5 s). Patrón de la web: **intentar siempre que haya cliente**, y si la nube rechaza → toast fuerte (`warnCloudFail`) + reintento en el próximo cambio o al recuperar conexión (`online` event + reintento periódico c/30 s mientras haya sucios).
- **Pull**: al abrir la pestaña Torneos se bajan `rk_torneos` (todos, es admin) + jugadores + config y se mergea por `updated_at`: gana el más nuevo por torneo; si el local está sucio y el server cambió después de nuestra última base → **aviso de conflicto** con elección explícita ("quedarme con lo mío" / "traer lo del server").
- El indicador de estado (✓ sincronizado / ⏳ pendiente / ⚠ sin conexión) se muestra chico en la cabecera de la pestaña.

### 4.3 Concurrencia (honesta y simple)

Modelo documento: si dos admins editan el MISMO torneo a la vez, el último en sincronizar pisa (con el aviso de §4.2 si se detecta la divergencia). Regla operativa documentada en la guía: un organizador por torneo. Torneos distintos en paralelo: sin problema.

### 4.4 UI del admin

- Pestaña **"Torneos"** nueva en `/#/admin` (componente `AdminTorneosTab.tsx`, siguiendo el patrón de las pestañas existentes).
- Adentro: el home del gestor tal cual (lista de torneos + Nuevo/Importar/Exportar + Ranking/Jugadores/Puntos) y el wizard completo. Los modales de `dialogos.tsx` se montan dentro de la pestaña.
- Por torneo se agregan el toggle **"Visible al público"** (nuevo) y los existentes de categoría y "cuenta para el ranking".
- **Importar**: acepta los `.torneo.json` v2 de la app local (traen jugadores) → sube a Supabase. Con esto Brian migra sus torneos reales.

## 5. Lo público (Etapa 2)

- **`/#/ranking`** — página `RankingPage.tsx`: la tabla del ranking VOLEA (posición, jugador, puntos, torneos; detalle expandible por jugador), filtro año/histórico. Calcula con el MISMO motor (`calcularRanking`) sobre los torneos visibles que aportan.
- **`/#/torneos`** — lista de torneos visibles (nombre, fecha, categoría, estado, campeón si terminó).
- **`/#/torneos/:id`** — el registro visual: grupos con sus tablas, fixture por rondas con canchas/tandas, llave con podio. Solo lectura (sin inputs), reusando los componentes de vista con un flag `soloLectura` o componentes de vista paralelos si resulta más limpio.
- **En vivo**: si el torneo no está terminado, la página refresca su documento cada ~15 s (polling con `setInterval` + refetch puntual; se detiene al terminar o al salir).
- **Coherencia ranking público vs admin**: un torneo oculto (`visible=false`) tampoco puede sumar al ranking público (RLS impide leerlo). Regla: ocultos = pruebas, que deben tener "cuenta para el ranking" apagado. El admin muestra un aviso si un torneo terminado quedó oculto pero marcado como que cuenta ("está sumando solo para vos"), con botones para hacerlo visible o excluirlo.
- Enlaces desde la landing (sección "Camino al Mundial"/menú) a `/#/ranking` — detalle a definir en el plan de la Etapa 2 sin tocar el resto de la landing.
- SEO/meta: `usePageMeta` como el resto de las rutas.

## 6. Riesgos y trampas conocidas (y cómo se esquivan)

- **Supabase free se pausa** tras ~1 semana inactivo: `volea-web` tiene actividad diaria (tienda/bot), riesgo bajo; igualmente lo público degrada con mensaje claro si no puede leer.
- **HashRouter + magic link**: no tocamos `supabaseClient.ts` (fix delicado del commit 79f18b4). El gestor usa la sesión existente.
- **AnimatePresence mode="wait"**: prohibido en las rutas nuevas (cuelga la navegación).
- **RLS**: sin upsert anónimo; políticas de lectura pública explícitas por tabla; escrituras siempre con sesión admin.
- **Pérdida silenciosa de escrituras**: el sync usa el patrón post-fix de la web (intentar siempre + toast fuerte si falla), nunca un "probe" previo.
- **Doble fuente de verdad transitoria**: hasta terminar la migración, el ranking "verdadero" sigue siendo el local; al importar todo, la web manda y la app local se congela (nota en su GUIA-USO).

## 7. Etapas y criterios de éxito

**Etapa 1 — Gestor online (admin):** migraciones SQL + carpeta `src/torneos/` con motor+tests verdes en el repo VOLEA + sync local-first + pestaña Torneos completa + importación.
✓ Éxito: (1) importar los torneos reales de Brian y ver el ranking idéntico al de la app local; (2) crear y correr un torneo de prueba completo desde `/#/admin` en el navegador; (3) cortar la red a mitad de la carga de resultados, seguir cargando, reconectar y ver el documento sincronizado (indicador ✓); (4) `npm test` verde en VOLEA (motor heredado) y `npm run build` ok; (5) un no-admin no puede escribir (verificado con anon key).

**Etapa 2 — Público en vivo:** rutas `/#/ranking`, `/#/torneos`, `/#/torneos/:id` + polling + enlaces + meta.
✓ Éxito: (1) con un torneo en juego, la página pública refleja un resultado nuevo en ≤20 s sin recargar a mano; (2) un torneo con `visible=false` no aparece ni por URL directa (RLS lo bloquea, no solo la UI); (3) el ranking público coincide con el del admin; (4) se ve bien en celu (la audiencia es 95% móvil).

Cada etapa: plan propio (writing-plans) + subagentes con doble review, como siempre.
