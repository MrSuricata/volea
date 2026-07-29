# VOLEA Torneos online — Etapa 1 (gestor en el admin) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El gestor de torneos completo (motor de pickle-torneos con sus 86 tests) corriendo como pestaña "Torneos" del admin de la web VOLEA, con datos en Supabase `volea-web` (tablas `rk_*`), persistencia local-first con sync, e importación de los `.torneo.json` existentes.

**Architecture:** El motor y las pantallas se MUDAN desde `pickle-torneos` a `VOLEA/src/torneos/` casi sin tocarse (el motor no se toca). La persistencia localStorage se reemplaza por un hook de sync local-first: cache en localStorage + push debounced a Supabase (patrón "intentar siempre + toast si falla") + pull con merge por `updated_at` y aviso de conflicto. Escrituras solo con la sesión admin existente; RLS deja al público leer solo `visible=true` (lo usa la Etapa 2).

**Tech Stack:** VOLEA web: React 19 + Vite + Tailwind + react-router 7 + Supabase (`src/services/supabaseClient.ts` exporta `supabase`, `supabaseReady`). Se agrega `vitest`. Migraciones vía MCP de Supabase (proyecto `volea-web`, id `scftuxrtflfowohiewsc`). Spec: `docs/superpowers/specs/2026-07-29-volea-torneos-online-design.md`.

**Convenciones:** rama `feat/torneos-online` (creada). Commits con trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; mensajes con acentos → archivo UTF-8 + `git commit -F`. No stagear `docs/`. Origen de código: `C:\Users\Usuario\Desktop\CLAUDE\PAPRIKA CLAUDE\pickle-torneos` (master, `95badcd`). Destino: `C:\Users\Usuario\Desktop\CLAUDE\PAPRIKA CLAUDE\VOLEA`. **PRECAUCIÓN: el Supabase es el de PRODUCCIÓN de la tienda — solo tocar objetos `rk_*` (las migraciones son aditivas).**

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/torneos/engine/*` (copiado + 1 campo) | Motor puro + 86 tests (fixture, tabla, clasificación, llave, llaveIndividual, grupos, canchas, ranking, padrón, rng, tipos). Único cambio: `Torneo.visible?: boolean` |
| `vite.config.ts` (mod) + `package.json` (mod) | vitest (environment node) + script `test` |
| Supabase `volea-web` | Migración `rk_torneos` / `rk_jugadores` / `rk_config` + RLS + seed de config |
| `src/torneos/ui/*` (copiado/adaptado) | dialogos, util(+test), reconciliar, Paso*, Pantalla*, PantallaConfigPuntos |
| `src/torneos/torneos.css` (adaptado) | El CSS del gestor scopeado bajo `.rk` (coexiste con Tailwind) |
| `src/torneos/TorneosApp.tsx` (new) | El shell del gestor (home + wizard + pantallas) con `{estado, setEstado}` por props |
| `src/torneos/sync.ts` (+test, new) | Lógica PURA de merge local/remoto por `updated_at` con sucios y conflictos |
| `src/torneos/useSyncTorneos.ts` (new) | Hook: cache localStorage + pull/merge + push debounced + reintentos + conflictos |
| `src/components/AdminTorneosTab.tsx` (new) | La pestaña: `<div className="rk">` + indicador de sync + conflictos + TorneosApp |
| `src/App.tsx` (mod) | Import + entrada en `tabs` + render branch `activeTab === 'torneos'` |

Tareas V1-V6. Motor y merge con TDD; UI verificada en navegador (dev server de VOLEA + Playwright MCP). Cada tarea termina en commit.

---

### Task V1: Vitest + motor migrado (86 tests verdes en VOLEA)

**Files:**
- Create: `src/torneos/engine/` (22 archivos copiados de pickle-torneos)
- Modify: `package.json`, `vite.config.ts`
- Modify: `src/torneos/engine/tipos.ts` (agregar `visible`)

- [ ] **Step 1: Copiar el motor completo**

Desde bash:
```bash
mkdir -p "C:/Users/Usuario/Desktop/CLAUDE/PAPRIKA CLAUDE/VOLEA/src/torneos/engine"
cp "C:/Users/Usuario/Desktop/CLAUDE/PAPRIKA CLAUDE/pickle-torneos/src/engine/"*.ts "C:/Users/Usuario/Desktop/CLAUDE/PAPRIKA CLAUDE/VOLEA/src/torneos/engine/"
ls "C:/Users/Usuario/Desktop/CLAUDE/PAPRIKA CLAUDE/VOLEA/src/torneos/engine" | wc -l
```
Expected: **21 archivos** — 11 módulos (canchas, clasificacion, fixture, grupos, llave, llaveIndividual, padron, ranking, rng, tabla, tipos) + 10 tests (todos menos tipos). Si el número difiere, listar y comparar contra el origen.

- [ ] **Step 2: Agregar `visible` al type `Torneo`**

En `src/torneos/engine/tipos.ts`, dentro del type `Torneo`, después de `cuentaParaRanking?: boolean;`, agregar:
```ts
  visible?: boolean; // interruptor "lo ve el publico" (default true); la web lo denormaliza a la columna rk_torneos.visible
```

- [ ] **Step 3: Agregar vitest**

Run: `npm install -D vitest@^3`

En `package.json`, en `"scripts"`, agregar: `"test": "vitest run",`

En `vite.config.ts`: agregar la primera línea `/// <reference types="vitest/config" />` y dentro del `defineConfig({ ... })` agregar la clave:
```ts
  test: {
    environment: 'node',
  },
```

- [ ] **Step 4: Verificar**

Run: `npm test`
Expected: **77 passed en 10 archivos** (el motor solo; los 9 tests restantes de pickle son de storage —que no se migra— y de util —que llega en V3). Si algún import falla: los tests del motor importan SOLO entre `./` del mismo folder — no debería haber ninguno externo.

Run: `npx tsc -b`
Expected: sin errores (el motor es autocontenido).

- [ ] **Step 5: Commit**

```bash
git add src/torneos/engine package.json package-lock.json vite.config.ts
git commit -m "feat: motor de torneos migrado desde pickle-torneos + vitest (86 tests)"
```

---

### Task V2: Migraciones `rk_*` + RLS en Supabase volea-web

**Files:** ninguno en el repo (migraciones remotas vía MCP de Supabase). Proyecto: `scftuxrtflfowohiewsc`.

- [ ] **Step 1: Cargar las herramientas del MCP de Supabase** (ToolSearch `select:` de `apply_migration`, `execute_sql`, `list_tables` del server `87adf6c9-...`).

- [ ] **Step 2: Aplicar la migración `rk_torneos_ranking`** con `apply_migration` (project_id `scftuxrtflfowohiewsc`), query:

```sql
create table if not exists public.rk_torneos (
  id text primary key,
  nombre text not null,
  fase text not null,
  categoria text,
  visible boolean not null default true,
  cuenta_ranking boolean not null default true,
  data jsonb not null,
  creado_el timestamptz not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.rk_jugadores (
  id text primary key,
  nombre text not null,
  alias jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.rk_config (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.rk_torneos enable row level security;
alter table public.rk_jugadores enable row level security;
alter table public.rk_config enable row level security;

create policy rk_torneos_select on public.rk_torneos for select using (visible = true or public.is_admin());
create policy rk_torneos_insert on public.rk_torneos for insert with check (public.is_admin());
create policy rk_torneos_update on public.rk_torneos for update using (public.is_admin()) with check (public.is_admin());
create policy rk_torneos_delete on public.rk_torneos for delete using (public.is_admin());

create policy rk_jugadores_select on public.rk_jugadores for select using (true);
create policy rk_jugadores_write on public.rk_jugadores for all using (public.is_admin()) with check (public.is_admin());

create policy rk_config_select on public.rk_config for select using (true);
create policy rk_config_write on public.rk_config for all using (public.is_admin()) with check (public.is_admin());

insert into public.rk_config (id, data)
values (1, '{"escalera":[100,86,72,60,50,40],"offsetB":1}'::jsonb)
on conflict (id) do nothing;
```

Nota: `public.is_admin()` YA existe en este proyecto (la usan las policies de bot_ledger/socio_moves). Si `apply_migration` falla porque no existe, DETENERSE y reportar BLOCKED (no crearla — averiguar el nombre real con `select proname from pg_proc where proname like '%admin%'`).

- [ ] **Step 3: Verificar objetos y policies**

Con `execute_sql`:
```sql
select tablename, policyname, cmd from pg_policies where tablename like 'rk_%' order by 1, 2;
```
Expected: 8 policies (4 de rk_torneos, 2+2 de las otras). Y `select * from public.rk_config;` → 1 fila con la escalera.

- [ ] **Step 4: Verificar RLS desde afuera (anon de verdad)**

Leer la URL y anon key de `src/services/supabaseClient.ts` (están inline en el código). Con bash/curl:

```bash
# SELECT anon sobre rk_torneos: debe responder 200 con [] (no error)
curl -s -o /dev/null -w "%{http_code}" "https://scftuxrtflfowohiewsc.supabase.co/rest/v1/rk_torneos?select=id" -H "apikey: <ANON_KEY>"
# INSERT anon: debe FALLAR (401/403), no 201
curl -s -o /dev/null -w "%{http_code}" -X POST "https://scftuxrtflfowohiewsc.supabase.co/rest/v1/rk_torneos" -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" -d '{"id":"hack","nombre":"x","fase":"parejas","data":{},"creado_el":"2026-07-29T00:00:00Z"}'
```
Expected: 200 y 401/403 respectivamente. Reportar los códigos reales.

- [ ] **Step 5: Registrar en el reporte** (no hay commit de repo; la migración queda en Supabase con su nombre).

---

### Task V3: UI migrada + TorneosApp (compila, aún sin cablear)

**Files:**
- Create: `src/torneos/ui/` (dialogos.tsx, util.ts, util.test.ts, reconciliar.ts, PasoParejas.tsx, PasoGrupos.tsx, PasoFaseGrupos.tsx, PasoLlave.tsx, PantallaRanking.tsx, PantallaJugadores.tsx, ConfigPuntos.tsx — copiados de pickle-torneos)
- Create: `src/torneos/torneos.css` (styles.css de pickle scopeado bajo `.rk`)
- Create: `src/torneos/TorneosApp.tsx`

- [ ] **Step 1: Copiar los componentes**

```bash
mkdir -p "C:/Users/Usuario/Desktop/CLAUDE/PAPRIKA CLAUDE/VOLEA/src/torneos/ui"
cd "C:/Users/Usuario/Desktop/CLAUDE/PAPRIKA CLAUDE/pickle-torneos/src/components"
cp dialogos.tsx util.ts util.test.ts reconciliar.ts PasoParejas.tsx PasoGrupos.tsx PasoFaseGrupos.tsx PasoLlave.tsx PantallaRanking.tsx PantallaJugadores.tsx ConfigPuntos.tsx "C:/Users/Usuario/Desktop/CLAUDE/PAPRIKA CLAUDE/VOLEA/src/torneos/ui/"
```

- [ ] **Step 2: Arreglar imports en los copiados**

En TODOS los archivos de `src/torneos/ui/`: reemplazar `from '../engine/` por `from '../engine/` (queda igual — verificar que resuelve porque `ui/` y `engine/` son hermanos bajo `torneos/`; sí resuelve). Reemplazar `from '../App'` por `from '../TorneosApp'` en los 4 Paso*.tsx (el type `PropsPaso` ahora vive ahí; TorneosApp se crea en el Step 4 — el orden de creación no importa para el commit único de esta tarea).

- [ ] **Step 3: CSS scopeado**

Copiar `pickle-torneos/src/styles.css` a `VOLEA/src/torneos/torneos.css` y transformarlo:
1. El bloque `:root { --navy-1: ... }` pasa a `.rk { --navy-1: ...; color: var(--texto); font-family: system-ui, 'Segoe UI Variable Display', 'Segoe UI', sans-serif; font-size: 17px; }` (las variables quedan disponibles solo dentro del gestor).
2. El bloque `body { ... }` se ELIMINA (la web ya tiene su body; el fondo navy del gestor lo pone `.rk` — agregar a `.rk`: `background: var(--navy-2); border-radius: 16px; padding: 4px;`).
3. TODOS los demás selectores top-level se prefijan con `.rk ` (ej. `.carta {` → `.rk .carta {`, `table {` → `.rk table {`, `input[type='text'], ...` → `.rk input[type='text'], ...` — ojo con las listas de selectores separadas por coma: prefijar CADA uno).
4. `::selection`, `::-webkit-scrollbar*` → prefijar como `.rk ::selection`, `.rk ::-webkit-scrollbar` etc.
5. `@keyframes modal-aparecer` queda igual (los keyframes no se scopean). `@media (max-width: 640px)` : prefijar los selectores DE ADENTRO.
6. `.modal-fondo` (position fixed) queda `.rk .modal-fondo` — sigue siendo fixed full-screen, correcto (el modal debe tapar todo el admin).

- [ ] **Step 4: Crear `src/torneos/TorneosApp.tsx`**

Adaptación del `App.tsx` de pickle-torneos: mismo shell (home con lista + wizard + pantallas Ranking/Jugadores/Config + crear/borrar/exportar/importar + selector de categoría + toggles), pero SIN storage propio: recibe `{ estado, setEstado }` por props (el hook de sync se los da en V5). Contenido EXACTO:

```tsx
import { useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import type { ConfigPuntos as TConfigPuntos, Jugador, Torneo } from './engine/tipos';
import { CONFIG_PUNTOS_DEFAULT, nuevoId } from './engine/tipos';
import { DialogosProvider, useDialogos } from './ui/dialogos';
import { reconciliarTorneo } from './ui/reconciliar';
import PasoParejas from './ui/PasoParejas';
import PasoGrupos from './ui/PasoGrupos';
import PasoFaseGrupos from './ui/PasoFaseGrupos';
import PasoLlave from './ui/PasoLlave';
import PantallaRanking from './ui/PantallaRanking';
import PantallaJugadores from './ui/PantallaJugadores';
import PantallaConfigPuntos from './ui/ConfigPuntos';

// Estado completo del gestor (mismo shape que el "estado v2" de la app local, sin el campo version)
export type EstadoTorneos = { torneos: Torneo[]; jugadores: Jugador[]; configPuntos?: TConfigPuntos };

const ETIQUETA_FASE: Record<Torneo['fase'], string> = {
  parejas: 'Cargando parejas',
  grupos: 'Armando grupos',
  faseGrupos: 'Fase de grupos',
  llave: 'Llave',
  terminado: 'Terminado 🏆',
};

const ETIQUETA_FORMATO: Record<string, string> = { grupos: 'Grupos + llave', individual: 'One Point Challenge' };

type Props = { estado: EstadoTorneos; setEstado: (cambio: (e: EstadoTorneos) => EstadoTorneos) => void; extraCabecera?: ReactNode };

export default function TorneosApp(props: Props) {
  return (
    <DialogosProvider>
      <TorneosInterno {...props} />
    </DialogosProvider>
  );
}

function TorneosInterno({ estado, setEstado, extraCabecera }: Props) {
  const dialogos = useDialogos();
  const [torneoActivoId, setTorneoActivoId] = useState<string | null>(null);
  const [vista, setVista] = useState<'home' | 'ranking' | 'jugadores' | 'config'>('home');
  const config = estado.configPuntos ?? CONFIG_PUNTOS_DEFAULT;

  const torneo = estado.torneos.find((t) => t.id === torneoActivoId) ?? null;

  function actualizarTorneo(id: string, cambio: (t: Torneo) => Torneo) {
    setEstado((e) => ({ ...e, torneos: e.torneos.map((t) => (t.id === id ? cambio(t) : t)) }));
  }
  function setJugadores(jugadores: Jugador[]) { setEstado((e) => ({ ...e, jugadores })); }
  function setTorneos(torneos: Torneo[]) { setEstado((e) => ({ ...e, torneos })); }
  function setConfig(configPuntos: TConfigPuntos) { setEstado((e) => ({ ...e, configPuntos })); }

  async function vincularTorneo(torneoId: string) {
    const t = estado.torneos.find((x) => x.id === torneoId);
    if (!t) return;
    const r = await reconciliarTorneo(t, estado.jugadores, dialogos);
    if (r.cancelado) return;
    setEstado((e) => ({ ...e, jugadores: r.jugadores, torneos: e.torneos.map((x) => (x.id === torneoId ? r.torneo : x)) }));
  }

  async function crearTorneo() {
    const r = await dialogos.pedirTextoConOpcion({
      titulo: 'Nuevo torneo',
      valorInicial: `Torneo ${new Date().toLocaleDateString('es-UY')}`,
      placeholder: 'Nombre del torneo',
      textoConfirmar: 'Seguir',
      etiquetaOpciones: 'Formato',
      opciones: [
        { clave: 'grupos', etiqueta: 'Grupos + llave (parejas)', ayuda: 'Fase de grupos todos contra todos y llave final.' },
        { clave: 'individual', etiqueta: 'One Point Challenge (individual)', ayuda: 'Eliminación directa, jugadores individuales.' },
      ],
    });
    if (!r) return;
    const cat = await dialogos.elegirDeLista({
      titulo: 'Categoría del torneo',
      mensaje: 'Para el ranking VOLEA (la A da más puntos que la B). Se puede cambiar después.',
      opciones: [
        { clave: 'A', etiqueta: 'Categoría A', ayuda: 'Puntaje completo.' },
        { clave: 'B', etiqueta: 'Categoría B', ayuda: 'Un escalón menos que la A.' },
      ],
      textoConfirmar: 'Crear',
    });
    const nuevo: Torneo = {
      id: nuevoId(),
      nombre: r.texto,
      creadoEl: new Date().toISOString(),
      fase: 'parejas',
      formato: r.opcion === 'individual' ? 'individual' : 'grupos',
      categoria: cat === 'A' || cat === 'B' ? cat : undefined,
      visible: true,
      parejas: [],
      grupos: [],
      partidosGrupo: [],
      configLlave: null,
      partidosLlave: null,
    };
    setEstado((e) => ({ ...e, torneos: [nuevo, ...e.torneos] }));
    setTorneoActivoId(nuevo.id);
  }

  async function borrarTorneo(id: string) {
    const t = estado.torneos.find((x) => x.id === id);
    if (!t) return;
    const ok = await dialogos.confirmar({ titulo: 'Borrar torneo', mensaje: `¿Borrar "${t.nombre}"? No se puede deshacer.`, textoConfirmar: 'Borrar', peligro: true });
    if (!ok) return;
    setEstado((e) => ({ ...e, torneos: e.torneos.filter((x) => x.id !== id) }));
  }

  function exportar(t: Torneo) {
    const ids = new Set(t.parejas.flatMap((p) => p.jugadorIds ?? []));
    const jugadoresDelTorneo = estado.jugadores.filter((j) => ids.has(j.id));
    const json = JSON.stringify({ tipo: 'pickle-torneo', version: 2, torneo: t, jugadores: jugadoresDelTorneo }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t.nombre.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.torneo.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importar(ev: ChangeEvent<HTMLInputElement>) {
    const archivo = ev.target.files?.[0];
    ev.target.value = '';
    if (!archivo) return;
    archivo.text().then((texto) => {
      try {
        const dato = JSON.parse(texto) as { tipo?: string; torneo?: Torneo; jugadores?: Jugador[] };
        if (!dato || dato.tipo !== 'pickle-torneo' || !dato.torneo) throw new Error('El archivo no es un torneo exportado por la app');
        const t = dato.torneo;
        const formaValida = typeof t.id === 'string' && typeof t.nombre === 'string' && Array.isArray(t.parejas) && Array.isArray(t.grupos) && Array.isArray(t.partidosGrupo);
        if (!formaValida) throw new Error('El archivo de torneo está dañado o incompleto');
        setEstado((e) => {
          const idsJ = new Set(e.jugadores.map((j) => j.id));
          const jugadoresNuevos = (dato.jugadores ?? []).filter((j) => j && typeof j.id === 'string' && !idsJ.has(j.id));
          const torneoFinal = e.torneos.some((x) => x.id === t.id) ? { ...t, id: nuevoId(), nombre: `${t.nombre} (importado)` } : t;
          return { ...e, torneos: [torneoFinal, ...e.torneos], jugadores: [...e.jugadores, ...jugadoresNuevos] };
        });
      } catch (err) {
        dialogos.avisar({ titulo: 'No se pudo importar', mensaje: err instanceof Error ? err.message : 'No se pudo importar el archivo' });
      }
    }).catch(() => dialogos.avisar({ titulo: 'No se pudo leer', mensaje: 'No se pudo leer el archivo' }));
  }

  if (!torneo && vista === 'ranking') {
    return <PantallaRanking torneos={estado.torneos} jugadores={estado.jugadores} config={config} onVincular={vincularTorneo} onVolver={() => setVista('home')} />;
  }
  if (!torneo && vista === 'jugadores') {
    return <PantallaJugadores jugadores={estado.jugadores} torneos={estado.torneos} config={config} setJugadores={setJugadores} setTorneos={setTorneos} onVolver={() => setVista('home')} />;
  }
  if (!torneo && vista === 'config') {
    return <PantallaConfigPuntos config={config} setConfig={setConfig} onVolver={() => setVista('home')} />;
  }

  if (!torneo) {
    return (
      <main className="contenedor">
        <header className="cabecera">
          <h1><span className="marca">VOLEA</span> · Torneos</h1>
          <div className="acciones">
            {extraCabecera}
            <button className="boton secundario" onClick={() => setVista('ranking')}>🏆 Ranking</button>
            <button className="boton secundario" onClick={() => setVista('jugadores')}>Jugadores</button>
            <button className="boton secundario" onClick={() => setVista('config')}>Puntos</button>
            <label className="boton secundario">
              Importar
              <input type="file" accept="application/json,.json" onChange={importar} className="oculto-accesible" />
            </label>
            <button className="boton" onClick={crearTorneo}>+ Nuevo torneo</button>
          </div>
        </header>
        {estado.torneos.length === 0 ? (
          <p className="vacio">Todavía no hay torneos. Creá el primero con "+ Nuevo torneo".</p>
        ) : (
          <ul className="lista-torneos">
            {estado.torneos.map((t) => (
              <li key={t.id} className="carta">
                <button className="titulo-torneo" onClick={() => setTorneoActivoId(t.id)}>
                  <strong>{t.nombre}</strong>
                  <span>
                    {new Date(t.creadoEl).toLocaleDateString('es-UY')} · {t.parejas.length} {(t.formato ?? 'grupos') === 'individual' ? 'jugadores' : 'parejas'} · {ETIQUETA_FORMATO[t.formato ?? 'grupos']} · {ETIQUETA_FASE[t.fase]}
                    {t.categoria ? ` · Cat ${t.categoria}` : ' · sin categoría'}
                    {t.visible === false ? ' · 🔒 oculto' : ''}
                  </span>
                </button>
                {t.fase === 'terminado' && t.cuentaParaRanking !== false && t.visible === false && (
                  <span className="chip" style={{ color: 'var(--rojo)' }} title="Está sumando al ranking pero el público no lo ve">⚠ suma oculto</span>
                )}
                <div className="acciones">
                  <button className="boton secundario" onClick={() => exportar(t)}>Exportar</button>
                  <button className="boton peligro" onClick={() => borrarTorneo(t.id)}>Borrar</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  return (
    <main className="contenedor">
      <header className="cabecera">
        <button className="boton secundario" onClick={() => setTorneoActivoId(null)}>← Torneos</button>
        <h1>{torneo.nombre}</h1>
      </header>
      <div className="acciones" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <label>Categoría:{' '}
          <select
            value={torneo.categoria ?? ''}
            onChange={(e) => actualizarTorneo(torneo.id, (t) => ({ ...t, categoria: e.target.value === '' ? undefined : (e.target.value as 'A' | 'B') }))}
          >
            <option value="">— sin categoría —</option>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={torneo.cuentaParaRanking !== false}
            onChange={(e) => actualizarTorneo(torneo.id, (t) => ({ ...t, cuentaParaRanking: e.target.checked }))}
          />{' '}
          Cuenta para el ranking
        </label>
        <label>
          <input
            type="checkbox"
            checked={torneo.visible !== false}
            onChange={(e) => actualizarTorneo(torneo.id, (t) => ({ ...t, visible: e.target.checked }))}
          />{' '}
          Visible al público
        </label>
      </div>
      <Wizard torneo={torneo} actualizar={(cambio) => actualizarTorneo(torneo.id, cambio)} />
    </main>
  );
}

// Contrato de los pasos del wizard: `cambio` corre dentro del state updater de React,
// así que debe ser PURO (nada de alerts/confirms adentro; esos van antes de llamar a actualizar).
export type PropsPaso = { torneo: Torneo; actualizar: (cambio: (t: Torneo) => Torneo) => void };

const PASOS_GRUPOS: { fase: Exclude<Torneo['fase'], 'terminado'>; titulo: string }[] = [
  { fase: 'parejas', titulo: 'Parejas' },
  { fase: 'grupos', titulo: 'Grupos' },
  { fase: 'faseGrupos', titulo: 'Fase de grupos' },
  { fase: 'llave', titulo: 'Llave' },
];
const PASOS_INDIVIDUAL: { fase: Exclude<Torneo['fase'], 'terminado'>; titulo: string }[] = [
  { fase: 'parejas', titulo: 'Jugadores' },
  { fase: 'llave', titulo: 'Llave' },
];

function Wizard({ torneo, actualizar }: PropsPaso) {
  const dialogos = useDialogos();
  const individual = (torneo.formato ?? 'grupos') === 'individual';
  const PASOS = individual ? PASOS_INDIVIDUAL : PASOS_GRUPOS;
  const faseVisible = torneo.fase === 'terminado' ? 'llave' : torneo.fase;
  const idxActual = PASOS.findIndex((p) => p.fase === faseVisible);

  async function volverA(fase: (typeof PASOS)[number]['fase']) {
    const idx = PASOS.findIndex((p) => p.fase === fase);
    if (idx >= idxActual) return;
    if (fase === 'parejas' && !individual && torneo.partidosGrupo.length > 0) {
      const ok = await dialogos.confirmar({ titulo: 'Volver a Parejas', mensaje: 'Descarta los grupos, el fixture, los resultados y la llave. ¿Seguir?', textoConfirmar: 'Volver', peligro: true });
      if (!ok) return;
      actualizar((t) => ({ ...t, grupos: [], partidosGrupo: [], configLlave: null, partidosLlave: null, fase: 'parejas' }));
      return;
    }
    if (fase === 'parejas' && individual && torneo.partidosLlave !== null) {
      const ok = await dialogos.confirmar({ titulo: 'Volver a Jugadores', mensaje: 'Descarta la llave y sus resultados. ¿Seguir?', textoConfirmar: 'Volver', peligro: true });
      if (!ok) return;
      actualizar((t) => ({ ...t, configLlave: null, partidosLlave: null, fase: 'parejas' }));
      return;
    }
    if (
      fase === 'grupos' &&
      (torneo.partidosGrupo.some((p) => p.puntosA !== null || p.puntosB !== null) || torneo.partidosLlave !== null)
    ) {
      const ok = await dialogos.confirmar({ titulo: 'Volver a Grupos', mensaje: 'Borra los resultados de la fase de grupos y la llave. ¿Seguir?', textoConfirmar: 'Volver', peligro: true });
      if (!ok) return;
      actualizar((t) => ({ ...t, partidosGrupo: [], configLlave: null, partidosLlave: null, fase: 'grupos' }));
      return;
    }
    actualizar((t) => ({ ...t, fase }));
  }

  return (
    <>
      <nav className="pasos">
        {PASOS.map((p, i) =>
          i < idxActual ? (
            <button key={p.fase} className="paso hecho" onClick={() => volverA(p.fase)} aria-label={`Volver a ${p.titulo}`}>
              {i + 1} · {p.titulo}
            </button>
          ) : (
            <span key={p.fase} className={`paso ${i === idxActual ? 'activo' : ''}`}>
              {i + 1} · {p.titulo}
            </span>
          ),
        )}
      </nav>
      <section className="contenido">
        {faseVisible === 'parejas' && <PasoParejas torneo={torneo} actualizar={actualizar} />}
        {faseVisible === 'grupos' && !individual && <PasoGrupos torneo={torneo} actualizar={actualizar} />}
        {faseVisible === 'faseGrupos' && !individual && <PasoFaseGrupos torneo={torneo} actualizar={actualizar} />}
        {faseVisible === 'llave' && <PasoLlave torneo={torneo} actualizar={actualizar} />}
      </section>
    </>
  );
}
```

**IMPORTANTE antes de dar por buena esta tarea:** comparar este `Wizard` y los handlers contra el `App.tsx` real de pickle-torneos (`C:\Users\Usuario\Desktop\CLAUDE\PAPRIKA CLAUDE\pickle-torneos\src\App.tsx`). Ese archivo evolucionó (formato individual/OPC, wizard de 2 pasos, `pedirTextoConOpcion`) y ES LA REFERENCIA de comportamiento: si algo difiere (nombres de pasos del OPC, guardas de volverA, etiquetas), COPIAR el comportamiento del original. El código de arriba es la adaptación esperada; el original manda.

- [ ] **Step 5: Verificar que compila**

Run: `npx tsc -b`
Expected: sin errores. (TorneosApp aún no se importa desde App.tsx — es standalone.)
Run: `npm test`
Expected: 77 + los 3 de `util.test.ts` = **80 passed**.

- [ ] **Step 6: Commit**

```bash
git add src/torneos/ui src/torneos/torneos.css src/torneos/TorneosApp.tsx
git commit -m "feat: UI del gestor migrada (dialogos, pasos, pantallas) + TorneosApp con estado por props"
```

---

### Task V4: Sync local-first (merge puro con TDD + hook)

**Files:**
- Create: `src/torneos/sync.ts`
- Test: `src/torneos/sync.test.ts`
- Create: `src/torneos/useSyncTorneos.ts`

- [ ] **Step 1: Escribir los tests del merge que fallan**

`src/torneos/sync.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Torneo } from './engine/tipos';
import { mergeTorneos } from './sync';

function t(id: string, nombre: string): Torneo {
  return {
    id, nombre, creadoEl: '2026-07-29T10:00:00.000Z', fase: 'parejas',
    parejas: [], grupos: [], partidosGrupo: [], configLlave: null, partidosLlave: null,
  };
}
const remoto = (torneo: Torneo, updatedAt: string) => ({ torneo, updatedAt });

describe('mergeTorneos', () => {
  it('sin sucios: gana lo remoto y la base se actualiza', () => {
    const r = mergeTorneos({
      locales: [t('t1', 'Viejo local')],
      remotos: [remoto(t('t1', 'Nuevo server'), '2026-07-29T12:00:00.000Z')],
      sucios: new Set(),
      base: { t1: '2026-07-29T11:00:00.000Z' },
    });
    expect(r.torneos[0].nombre).toBe('Nuevo server');
    expect(r.base.t1).toBe('2026-07-29T12:00:00.000Z');
    expect(r.conflictos).toEqual([]);
  });

  it('sucio local con server sin cambios: se queda lo local (pendiente de push)', () => {
    const r = mergeTorneos({
      locales: [t('t1', 'Editado local')],
      remotos: [remoto(t('t1', 'Base server'), '2026-07-29T11:00:00.000Z')],
      sucios: new Set(['t1']),
      base: { t1: '2026-07-29T11:00:00.000Z' },
    });
    expect(r.torneos[0].nombre).toBe('Editado local');
    expect(r.conflictos).toEqual([]);
  });

  it('sucio local Y server avanzo: CONFLICTO, se queda lo local hasta resolver', () => {
    const r = mergeTorneos({
      locales: [t('t1', 'Editado local')],
      remotos: [remoto(t('t1', 'Otro admin'), '2026-07-29T13:00:00.000Z')],
      sucios: new Set(['t1']),
      base: { t1: '2026-07-29T11:00:00.000Z' },
    });
    expect(r.conflictos).toEqual(['t1']);
    expect(r.torneos[0].nombre).toBe('Editado local');
  });

  it('nuevo local (sin base, sucio): se conserva; nuevo remoto: se agrega', () => {
    const r = mergeTorneos({
      locales: [t('nuevoLocal', 'Recien creado aca')],
      remotos: [remoto(t('nuevoRemoto', 'Creado en otra maquina'), '2026-07-29T12:00:00.000Z')],
      sucios: new Set(['nuevoLocal']),
      base: {},
    });
    const ids = r.torneos.map((x) => x.id).sort();
    expect(ids).toEqual(['nuevoLocal', 'nuevoRemoto']);
  });

  it('borrado remoto de un torneo limpio: desaparece; si esta sucio: se conserva', () => {
    const r = mergeTorneos({
      locales: [t('limpio', 'x'), t('sucio', 'y')],
      remotos: [],
      sucios: new Set(['sucio']),
      base: { limpio: '2026-07-29T11:00:00.000Z', sucio: '2026-07-29T11:00:00.000Z' },
    });
    expect(r.torneos.map((x) => x.id)).toEqual(['sucio']);
    expect(r.base.limpio).toBeUndefined();
  });
});
```

- [ ] **Step 2: Verificar que falla** — `npm test -- sync` → FAIL (no existe `./sync`).

- [ ] **Step 3: Implementar `src/torneos/sync.ts`**

```ts
import type { Torneo } from './engine/tipos';

// Merge local-first por torneo:
// - torneo limpio (no sucio): manda el server (o desaparece si el server lo borro)
// - torneo sucio con base == server: se queda lo local (pendiente de push)
// - torneo sucio con server avanzado: CONFLICTO (se queda lo local y se avisa)
// - torneo local sin base y sucio: nuevo local, se conserva
export type EntradaRemota = { torneo: Torneo; updatedAt: string };
export type ResultadoMerge = { torneos: Torneo[]; base: Record<string, string>; conflictos: string[] };

export function mergeTorneos(args: {
  locales: Torneo[];
  remotos: EntradaRemota[];
  sucios: Set<string>;
  base: Record<string, string>;
}): ResultadoMerge {
  const { locales, remotos, sucios, base } = args;
  const remotoPorId = new Map(remotos.map((r) => [r.torneo.id, r]));
  const nuevaBase: Record<string, string> = {};
  const conflictos: string[] = [];
  const resultado: Torneo[] = [];
  const vistos = new Set<string>();

  for (const local of locales) {
    vistos.add(local.id);
    const rem = remotoPorId.get(local.id);
    const esSucio = sucios.has(local.id);
    if (!rem) {
      if (esSucio) resultado.push(local); // nuevo local o borrado remoto con cambios locales: conservar
      continue; // limpio y no esta en el server: borrado remoto
    }
    if (!esSucio) {
      resultado.push(rem.torneo);
      nuevaBase[local.id] = rem.updatedAt;
      continue;
    }
    // sucio: comparar la base conocida con el server
    if (base[local.id] && base[local.id] !== rem.updatedAt) conflictos.push(local.id);
    resultado.push(local);
    nuevaBase[local.id] = base[local.id] ?? rem.updatedAt;
  }

  for (const rem of remotos) {
    if (vistos.has(rem.torneo.id)) continue;
    resultado.push(rem.torneo);
    nuevaBase[rem.torneo.id] = rem.updatedAt;
  }

  return { torneos: resultado, base: nuevaBase, conflictos };
}
```

- [ ] **Step 4: Verificar que pasa** — `npm test -- sync` → PASS (5 tests). Suite completa: **85**.

- [ ] **Step 5: Implementar `src/torneos/useSyncTorneos.ts`** (hook; sin test unitario — se verifica en navegador en V5/V6)

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import type { EstadoTorneos } from './TorneosApp';
import type { Torneo } from './engine/tipos';
import { mergeTorneos } from './sync';

const CLAVE_CACHE = 'volea-torneos:cache';

type Cache = {
  estado: EstadoTorneos;
  base: Record<string, string>; // torneoId -> updated_at visto del server
  sucios: string[];
  jugadoresSucios: boolean;
  configSucia: boolean;
};

type EstadoSync = 'sincronizado' | 'pendiente' | 'sinConexion';

function leerCache(): Cache {
  try {
    const crudo = localStorage.getItem(CLAVE_CACHE);
    if (crudo) {
      const c = JSON.parse(crudo) as Cache;
      if (c && c.estado && Array.isArray(c.estado.torneos)) return { sucios: [], jugadoresSucios: false, configSucia: false, base: {}, ...c };
    }
  } catch { /* cache corrupto: arrancar limpio */ }
  return { estado: { torneos: [], jugadores: [] }, base: {}, sucios: [], jugadoresSucios: false, configSucia: false };
}

export function useSyncTorneos(avisarError: (mensaje: string) => void) {
  const [cache, setCache] = useState<Cache>(() => leerCache());
  const [estadoSync, setEstadoSync] = useState<EstadoSync>('pendiente');
  const [conflictos, setConflictos] = useState<string[]>([]);
  const timerPush = useRef<number | null>(null);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  const persistir = useCallback((c: Cache) => {
    try { localStorage.setItem(CLAVE_CACHE, JSON.stringify(c)); } catch (e) { console.error(e); }
  }, []);

  // ---- PUSH: sube sucios (torneos, jugadores, config) ----
  const push = useCallback(async () => {
    const c = cacheRef.current;
    if (!supabase) { setEstadoSync('sinConexion'); return; }
    if (c.sucios.length === 0 && !c.jugadoresSucios && !c.configSucia) { setEstadoSync('sincronizado'); return; }
    try {
      const ahora = new Date().toISOString();
      const nuevaBase = { ...c.base };
      // upsert de torneos sucios existentes (los sucios que ya no existen se borran mas abajo)
      const filas = c.sucios
        .map((id) => c.estado.torneos.find((x) => x.id === id))
        .filter((t): t is Torneo => !!t)
        .map((t) => ({
          id: t.id,
          nombre: t.nombre,
          fase: t.fase,
          categoria: t.categoria ?? null,
          visible: t.visible !== false,
          cuenta_ranking: t.cuentaParaRanking !== false,
          data: t,
          creado_el: t.creadoEl,
          updated_at: ahora,
        }));
      if (filas.length > 0) {
        const { error } = await supabase.from('rk_torneos').upsert(filas);
        if (error) throw error;
        for (const f of filas) nuevaBase[f.id] = ahora;
      }
      // borrados: ids sucios que ya no estan en el estado
      const idsBorrar = c.sucios.filter((id) => !c.estado.torneos.some((t) => t.id === id));
      if (idsBorrar.length > 0) {
        const { error } = await supabase.from('rk_torneos').delete().in('id', idsBorrar);
        if (error) throw error;
        for (const id of idsBorrar) delete nuevaBase[id];
      }
      if (c.jugadoresSucios) {
        const filasJ = c.estado.jugadores.map((j) => ({ id: j.id, nombre: j.nombre, alias: j.alias ?? [], updated_at: ahora }));
        if (filasJ.length > 0) {
          const { error } = await supabase.from('rk_jugadores').upsert(filasJ);
          if (error) throw error;
        }
      }
      if (c.configSucia && c.estado.configPuntos) {
        const { error } = await supabase.from('rk_config').upsert({ id: 1, data: c.estado.configPuntos, updated_at: ahora });
        if (error) throw error;
      }
      setCache((prev) => {
        const limpio: Cache = { ...prev, base: nuevaBase, sucios: [], jugadoresSucios: false, configSucia: false };
        persistir(limpio);
        return limpio;
      });
      setEstadoSync('sincronizado');
    } catch (err) {
      console.error('[torneos sync] push fallo', err);
      setEstadoSync('sinConexion');
      avisarError('No se pudo sincronizar con la nube. Tus cambios quedan guardados en este navegador y se reintenta solo.');
    }
  }, [avisarError, persistir]);

  // ---- PULL: baja todo y mergea ----
  const pull = useCallback(async () => {
    if (!supabase) { setEstadoSync('sinConexion'); return; }
    try {
      const [rt, rj, rc] = await Promise.all([
        supabase.from('rk_torneos').select('id, data, updated_at'),
        supabase.from('rk_jugadores').select('id, nombre, alias'),
        supabase.from('rk_config').select('data').eq('id', 1).maybeSingle(),
      ]);
      if (rt.error) throw rt.error;
      if (rj.error) throw rj.error;
      setCache((prev) => {
        const remotos = (rt.data ?? []).map((f) => ({ torneo: f.data as Torneo, updatedAt: f.updated_at as string }));
        const m = mergeTorneos({ locales: prev.estado.torneos, remotos, sucios: new Set(prev.sucios), base: prev.base });
        const jugadores = prev.jugadoresSucios
          ? prev.estado.jugadores
          : (rj.data ?? []).map((f) => ({ id: f.id as string, nombre: f.nombre as string, alias: (f.alias as string[]) ?? [] }));
        const configPuntos = prev.configSucia ? prev.estado.configPuntos : ((rc.data?.data as EstadoTorneos['configPuntos']) ?? prev.estado.configPuntos);
        const nuevo: Cache = { ...prev, estado: { torneos: m.torneos, jugadores, configPuntos }, base: m.base };
        persistir(nuevo);
        setConflictos(m.conflictos);
        return nuevo;
      });
      setEstadoSync((s) => (s === 'sinConexion' ? 'pendiente' : s));
      void push(); // si habia sucios, empujarlos ahora
    } catch (err) {
      console.error('[torneos sync] pull fallo', err);
      setEstadoSync('sinConexion');
    }
  }, [persistir, push]);

  // ---- setEstado del gestor: escribe cache + marca sucios + agenda push ----
  const setEstado = useCallback((cambio: (e: EstadoTorneos) => EstadoTorneos) => {
    setCache((prev) => {
      const estadoNuevo = cambio(prev.estado);
      const suciosNuevos = new Set(prev.sucios);
      // torneos que cambiaron de referencia o desaparecieron => sucios
      const antesPorId = new Map(prev.estado.torneos.map((t) => [t.id, t]));
      for (const t of estadoNuevo.torneos) {
        if (antesPorId.get(t.id) !== t) suciosNuevos.add(t.id);
      }
      for (const t of prev.estado.torneos) {
        if (!estadoNuevo.torneos.some((x) => x.id === t.id)) suciosNuevos.add(t.id); // borrado
      }
      const nuevo: Cache = {
        ...prev,
        estado: estadoNuevo,
        sucios: [...suciosNuevos],
        jugadoresSucios: prev.jugadoresSucios || estadoNuevo.jugadores !== prev.estado.jugadores,
        configSucia: prev.configSucia || estadoNuevo.configPuntos !== prev.estado.configPuntos,
      };
      persistir(nuevo);
      return nuevo;
    });
    setEstadoSync('pendiente');
    if (timerPush.current !== null) window.clearTimeout(timerPush.current);
    timerPush.current = window.setTimeout(() => { void push(); }, 1500);
  }, [persistir, push]);

  // ---- resolver conflicto: 'local' re-empuja lo mio; 'server' trae lo del server ----
  const resolverConflicto = useCallback(async (id: string, eleccion: 'local' | 'server') => {
    if (eleccion === 'local') {
      setCache((prev) => {
        const nuevo: Cache = { ...prev, base: { ...prev.base, [id]: '' } }; // base vacia: el proximo push pisa
        persistir(nuevo);
        return nuevo;
      });
      setConflictos((cs) => cs.filter((x) => x !== id));
      void push();
      return;
    }
    if (!supabase) return;
    const { data, error } = await supabase.from('rk_torneos').select('data, updated_at').eq('id', id).maybeSingle();
    if (error || !data) { avisarError('No se pudo traer la versión del server.'); return; }
    setCache((prev) => {
      const nuevo: Cache = {
        ...prev,
        estado: { ...prev.estado, torneos: prev.estado.torneos.map((t) => (t.id === id ? (data.data as Torneo) : t)) },
        base: { ...prev.base, [id]: data.updated_at as string },
        sucios: prev.sucios.filter((x) => x !== id),
      };
      persistir(nuevo);
      return nuevo;
    });
    setConflictos((cs) => cs.filter((x) => x !== id));
  }, [avisarError, persistir, push]);

  // ---- arranque + reconexion + reintento periodico ----
  useEffect(() => {
    void pull();
    const onOnline = () => { void pull(); };
    window.addEventListener('online', onOnline);
    const intervalo = window.setInterval(() => {
      const c = cacheRef.current;
      if (c.sucios.length > 0 || c.jugadoresSucios || c.configSucia) void push();
    }, 30000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(intervalo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { estado: cache.estado, setEstado, estadoSync, conflictos, resolverConflicto, refrescar: pull };
}
```

- [ ] **Step 6: Verificar** — `npx tsc -b` sin errores; `npm test` → 85.

- [ ] **Step 7: Commit**

```bash
git add src/torneos/sync.ts src/torneos/sync.test.ts src/torneos/useSyncTorneos.ts
git commit -m "feat: sync local-first (merge puro testeado + hook con push debounced y conflictos)"
```

---

### Task V5: Pestaña "Torneos" en el admin

**Files:**
- Create: `src/components/AdminTorneosTab.tsx`
- Modify: `src/App.tsx` (import + entrada en `tabs` + render branch + icono)

- [ ] **Step 1: Crear `src/components/AdminTorneosTab.tsx`**

```tsx
import TorneosApp from '../torneos/TorneosApp';
import { useSyncTorneos } from '../torneos/useSyncTorneos';
import '../torneos/torneos.css';

const ETIQUETA_SYNC: Record<string, { texto: string; clase: string }> = {
  sincronizado: { texto: '✓ Sincronizado', clase: 'text-lime-500' },
  pendiente: { texto: '⏳ Sincronizando…', clase: 'text-amber-400' },
  sinConexion: { texto: '⚠ Sin conexión — trabajando local', clase: 'text-red-400' },
};

export function AdminTorneosTab({ avisar }: { avisar: (mensaje: string) => void }) {
  const { estado, setEstado, estadoSync, conflictos, resolverConflicto, refrescar } = useSyncTorneos(avisar);
  const et = ETIQUETA_SYNC[estadoSync];

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className={`text-sm font-semibold ${et.clase}`}>{et.texto}</span>
        <button className="text-sm underline text-navy-500 hover:text-navy-700" onClick={() => void refrescar()}>Refrescar</button>
      </div>
      {conflictos.map((id) => {
        const t = estado.torneos.find((x) => x.id === id);
        return (
          <div key={id} className="mb-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-navy-800">
            ⚠ <strong>{t?.nombre ?? id}</strong> fue modificado por otro admin mientras vos tenías cambios sin subir. ¿Con cuál te quedás?
            <div className="mt-2 flex gap-2">
              <button className="rounded bg-navy-700 px-3 py-1 text-white" onClick={() => void resolverConflicto(id, 'local')}>Mi versión</button>
              <button className="rounded border border-navy-700 px-3 py-1" onClick={() => void resolverConflicto(id, 'server')}>La del server</button>
            </div>
          </div>
        );
      })}
      <div className="rk">
        <TorneosApp estado={estado} setEstado={setEstado} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Cablear en `src/App.tsx`**

1. Junto a los imports de tabs (líneas ~33-37): `import { AdminTorneosTab } from './components/AdminTorneosTab';`
2. En el import de `lucide-react` (buscar la lista larga de iconos): agregar `Trophy` si no está.
3. En el array `tabs` del admin (termina con `{ id: 'announcements', ... }` cerca de la línea 2930): agregar al final:
```tsx
    { id: 'torneos', label: 'Torneos', icon: <Trophy size={18} /> },
```
4. Junto a los otros render branches (después del de `standings`, cerca de la línea 3639), agregar:
```tsx
        {activeTab === 'torneos' && (
          <AdminTorneosTab avisar={(m) => showToast(m)} />
        )}
```
**OJO:** el mecanismo real de toasts del admin hay que LEERLO en App.tsx (buscar cómo las otras tabs muestran avisos: puede ser `showToast`, `toast`, o similar de `sonner` — el paquete `sonner` está en node_modules). Usar EXACTAMENTE el que ya usan las pestañas vecinas (AdminCajaTab recibe props — mirar qué le pasan). Si ninguna recibe un callback de aviso, usar `toast.error(m)` de sonner importándolo como lo haga el resto del archivo.

- [ ] **Step 3: Verificar en navegador**

Dev server de VOLEA (`npm run dev`, puerto que indique vite — típicamente 5173; usar preview_start/Playwright MCP contra ese puerto):
1. `/#/admin` → login (los tests NO deben tocar datos de la tienda: solo la pestaña nueva). Si no hay credenciales en la sesión de prueba, verificar al menos que la pestaña "Torneos" aparece en el sidebar y que el bundle compila; y hacer la verificación funcional con un mock: en la consola, `localStorage` NO puede simular la sesión — en ese caso reportar qué se pudo y qué no, y dejar la verificación funcional completa para V6 (que usa credenciales reales de Brian si él está, o el patrón de admin temporal vía SQL documentado en la memoria del proyecto).
2. Con sesión: la pestaña abre el gestor (estética navy+lima dentro del admin), crear un torneo de prueba → en Supabase (`execute_sql`): `select id, nombre, fase, visible from rk_torneos;` → aparece la fila con `data` completo. Toggle "Visible al público" → columna `visible` cambia tras el debounce.
3. Indicador: al editar algo pasa a "⏳" y en ~2 s vuelve a "✓".
4. Consola del navegador: cero errores.
5. Borrar el torneo de prueba desde el gestor → la fila desaparece de `rk_torneos`.

- [ ] **Step 4: `npx tsc -b` + `npm test` + `npm run build`** — todo verde.

- [ ] **Step 5: Commit**

```bash
git add src/components/AdminTorneosTab.tsx src/App.tsx
git commit -m "feat: pestaña Torneos en el admin con gestor completo e indicador de sync"
```

---

### Task V6: E2E de criterios de éxito + importación real + push a producción

**Files:** ninguno nuevo (verificación + deploy). Puede haber micro-fixes si el e2e los revela (commitearlos sueltos con mensaje claro).

- [ ] **Step 1: E2E criterios de la spec (§7 Etapa 1)** con dev server + Playwright MCP + **sesión admin temporal vía SQL** (patrón ya usado en este proyecto). Crearlo con `execute_sql` (ANTES mirar la forma real de la tabla admins con `select * from public.admins limit 1` y adaptar la columna de email si difiere):

```sql
-- ADMIN TEMPORAL E2E (borrar al final — ver cleanup)
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('11111111-2222-3333-4444-555555555555', '00000000-0000-0000-0000-000000000000', 'e2e-torneos@test.local',
        crypt('E2eTorneos!2026', gen_salt('bf')), now(), 'authenticated', 'authenticated',
        '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
values (gen_random_uuid(), '11111111-2222-3333-4444-555555555555', 'e2e-torneos@test.local',
        jsonb_build_object('sub', '11111111-2222-3333-4444-555555555555', 'email', 'e2e-torneos@test.local'),
        'email', now(), now(), now());
insert into public.admins (email) values ('e2e-torneos@test.local');
```
Login en la UI con ese email + password. **Cleanup al final del e2e:**
```sql
delete from public.admins where email = 'e2e-torneos@test.local';
delete from auth.identities where user_id = '11111111-2222-3333-4444-555555555555';
delete from auth.users where id = '11111111-2222-3333-4444-555555555555';
```
Los criterios:

1. **Importación**: importar un `.torneo.json` v2 real (generar uno exportando desde la app local pickle-torneos si no hay a mano: abrir `pickle-torneos/dist/index.html` con Playwright sobre file://, exportar un torneo con ranking, y usar ese archivo). Verificar: el torneo aparece en el gestor web, y el Ranking del gestor muestra los mismos puntos que mostraba la app local.
2. **Torneo completo online**: crear "E2E Web" (formato grupos, cat B), 8 parejas, sortear, cargar los 12 resultados, armar llave recomendada, jugarla, terminar. Verificar podio + que `rk_torneos.fase = 'terminado'` y el ranking del gestor sumó.
3. **Offline**: con el torneo abierto, `browserContext.setOffline(true)` (Playwright), cargar 2-3 resultados → indicador "⚠ Sin conexión", los cambios se ven en la UI; `setOffline(false)` → en <35 s (reintento periódico) el indicador pasa a "✓" y `execute_sql` muestra los resultados en `data`. ESTE ES EL CRITERIO ESTRELLA.
4. **Seguridad**: repetir los curl anon de V2 (select 200 con visibles; insert 401/403). Además `update` anon → debe fallar.
5. **Suite**: `npm test` (85) + `npx tsc -b` + `npm run build` verdes.
6. Limpiar TODO lo de prueba: torneos E2E borrados desde el gestor (verifica el delete-sync), jugadores de prueba borrados, admin temporal eliminado. `select count(*) from rk_torneos;` → solo lo real de Brian (o 0 si aún no importó).

- [ ] **Step 2: Actualizar `GUIA-USO.md` de pickle-torneos** (repo `pickle-torneos`, commit propio allá): agregar al principio:
```markdown
> **⚠ Esta app quedó como RESPALDO.** El gestor oficial ahora vive en la web de VOLEA
> (volea.vercel.app → Admin → Torneos), con los datos en la nube y visible para el público.
> Esta copia local sigue funcionando por si algún día hace falta sin internet, pero lo nuevo
> se construye en la web.
```
Commit en pickle-torneos: `docs: la app local queda como respaldo; el gestor oficial es la web VOLEA`.

- [ ] **Step 3: Merge y deploy**

```bash
cd "C:/Users/Usuario/Desktop/CLAUDE/PAPRIKA CLAUDE/VOLEA"
git checkout master
git merge feat/torneos-online
npm test && npm run build
git branch -d feat/torneos-online
git push origin master
```
El push a master dispara el deploy de Vercel (proyecto `volea`). Esperar ~2 min y smoke de producción: abrir `https://volea.vercel.app/#/admin` con Playwright → la pestaña "Torneos" está en el sidebar (sin loguearse alcanza ver el tab si el sidebar es post-login: en ese caso verificar que la app carga sin errores de consola y que el bundle nuevo está desplegado — `view-source` contiene "AdminTorneosTab" o el chunk nuevo). Verificar también que la TIENDA sigue viva (home carga productos).

- [ ] **Step 4: Reporte final** con: resultados de los 6 criterios, SHAs, estado del deploy, y qué quedó para Etapa 2.

---

## Cierre

Al terminar V6: la Etapa 1 está entregada — Brian organiza desde la web con sync y puede importar sus torneos reales (si no lo hizo el e2e, guiarlo: Admin → Torneos → Importar con sus `.torneo.json`). La Etapa 2 (páginas públicas `/#/ranking` + `/#/torneos/:id` con polling) se planifica aparte con writing-plans cuando Brian confirme que la Etapa 1 le funciona en la práctica.


