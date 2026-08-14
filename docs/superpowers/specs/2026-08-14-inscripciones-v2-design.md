# Inscripciones v2: pestaña admin, pareja por categoría, padrón único y deudores sin duplicar

**Fecha**: 2026-08-14 · **Aprobado por Brian** (chat, 2026-08-14)

## Contexto

La inscripción online (commit `fcef5c2`) ya funciona para el VOLEA Racket Roll (evt-racket-roll-2026,
22/8 en Carmelo, 16 categorías), pero:

1. En el admin la lista de inscriptos está escondida (Eventos → iconito por evento → modal) y no hay
   forma de enterarse de inscripciones nuevas.
2. El form tiene UN solo campo de pareja: quien juega Mixto + su categoría de género mete a los dos
   compañeros en el mismo campo ("Gaston Moirano y Valeria Morales") y después hay que adivinar.
3. Las inscripciones reales viven en una planilla (hojas DOBLES/SINGLES de `TORNEOS VOLEA.xlsx`),
   fuera de la web, con nombres repetidos/con-y-sin-tilde entre listas.
4. En la Caja, "¿Quién debe?" es texto libre → deudores duplicados ("Hernán" ≠ "Hernan").

Decisiones de Brian: pestaña Inscripciones con badge (sin aviso Telegram por ahora), vista doble
(recientes + por categoría), y el padrón del ranking (`rk_jugadores`) como registro único de jugadores.

## Pieza 1 — Form público: pareja por categoría

- Al elegir categorías, por **cada categoría de dobles** elegida (dobles = el nombre contiene
  «doble», case-insensitive — misma regla que el form actual) aparece un campo propio: «Tu pareja
  para Doble Mixto A», etc. Desaparece el campo único global. Con categoría de texto libre (evento
  sin `categorias`), si el texto contiene «doble» se muestra un único campo keyed por ese texto.
- **Datos**: columna nueva `parejas jsonb NOT NULL DEFAULT '{}'` en `inscripciones` — mapa
  `{"Doble Mixto A": "Valeria Morales"}`. La columna `pareja` (texto) queda para filas históricas y
  como fallback de lectura.
- **RPC** `inscribir_evento` suma `p_parejas jsonb DEFAULT '{}'` (validada: objeto plano string→string,
  claves ⊆ 400 chars, valores ≤ 120; total ≤ 2000 chars serializado). El default mantiene compatible
  el bundle viejo cacheado durante el deploy (regla aprendida del incidente `p_paid_by`).
  Al actualizar una inscripción existente (mismo celular), `parejas` se reemplaza entero.
- **Sugerencias de nombres**: `<datalist>` con los nombres del padrón (`rk_jugadores`, lectura pública
  ya permitida por RLS — el ranking ya muestra esos nombres) en los campos nombre y pareja. Texto
  libre sigue permitido; es solo para inducir la grafía canónica.

## Pieza 2 — Pestaña "Inscripciones" del admin + badge de nuevas

- Pestaña nueva `inscripciones` (lazy, `AdminInscripcionesTab.tsx`), entre Pedidos y Caja en el menú.
- **Selector de evento**: default el evento `upcoming` con `inscripcionesAbiertas` de fecha más
  próxima; se puede cambiar a cualquier evento con inscripciones.
- **Vista "Recientes"** (default): filas por persona, orden `created_at desc`. Cada fila: nombre,
  chips de categorías, parejas por categoría (de `parejas`, fallback al texto `pareja` viejo),
  celular como link de WhatsApp, email, DUPR, notas, fecha humanizada, chip de estado y acciones
  Confirmar / A pendiente / Dar de baja (misma semántica que el modal actual). Las inscripciones
  nuevas desde la última visita se marcan con un puntito/chip «nueva».
- **Vista "Por categoría"**: secciones derivadas de `event.categorias` **∪ categorías presentes en
  los datos** (resiliente a renombres), en el orden del evento primero. En cada sección, en dobles se
  arman **duplas por mención mutua**: dos inscriptos de la categoría cuyos `pareja(categoría)`
  normalizados apuntan al nombre del otro se muestran como una fila «A + B»; el resto sale solo con
  «con X (declarada)» o «pareja a confirmar». Singles: fila por jugador. Contador por sección y total.
  Bajas excluidas.
- **Badge "nuevas"**: `getInscripcionesNuevas(desdeISO)` — count (head, sin filas) de
  `inscripciones` con `created_at > desde`, global (la RPC ya impide inscribirse a eventos
  cerrados; RLS admin permite el SELECT). El "desde" vive en `localStorage volea_insc_vistas` (por navegador); al abrir la pestaña
  se actualiza a ahora. El badge (numérico, estilo píldora lima) aparece en el item del menú del
  admin y en la barra flotante de admin. Se consulta al montar AdminPage y al volver el foco
  (visibilitychange), con techo de lectura estándar.
- El botón «Ver inscriptos» de la pestaña Eventos pasa a **navegar a la pestaña** con ese evento
  preseleccionado (patrón `sessionStorage` como `volea_admin_tab`); `InscriptosModal` se elimina.

## Pieza 3 — Padrón único + import de la planilla

- `rk_jugadores` (id, nombre, alias jsonb) no cambia de estructura. Es seguro insertar server-side:
  el push de torneos de otro cliente solo borra ids que ese cliente tenía en su `jugadoresBase`
  (verificado en `useSyncTorneos.ts:252`).
- `normalizar` y `distancia` se mueven a `src/utils/nombres.ts`; `torneos/engine/padron.ts` los
  re-importa/re-exporta (motor y tests intactos) para que Caja e Inscripciones los usen sin depender
  del motor de torneos.
- **Import one-off** (script + SQL vía MCP, mismo patrón que los seeds de torneos):
  - 18 jugadores únicos de la planilla → match por nombre normalizado contra el padrón (44);
    exacto → se reusa el id (variante de tilde/mayúsculas se agrega como alias si aporta);
    sin match → jugador nuevo con id nuevo. «CONFIRMAR» no es un jugador.
  - Una fila de `inscripciones` por persona en evt-racket-roll-2026: `categorias` = lista de sus
    categorías (etiquetas canónicas del evento), `parejas` = mapa por categoría de dobles,
    `celular` = del sheet con 0 inicial restituido («93798607» → «093798607»; vacío si no hay),
    `estado` = pendiente (así está la planilla), `notas` = «importada de planilla 14/8» y
    «pareja a confirmar» donde corresponda.
  - Mapeo de niveles del sheet → categorías del evento: `MASC X` → `Doble Masculino X`,
    `FEM X` → `Doble Femenino X`, `MIXTO X` → `Doble Mixto X`, `SINGLE MASC X` → `Singles Masculino X`,
    `SINGLE FEM X` → `Singles Femenino X`. La planilla separa singles por género y el evento hoy no:
    el import usa las etiquetas con género y **se le propone a Brian** actualizar `categorias` del
    evento (decisión suya, editable en el admin; la vista por categoría muestra cualquier etiqueta
    presente en los datos igual).
  - Anomalía dupla 10 (Gastón «FEM B» + Brian «MASC A»): se importa como dupla **Doble Masculino A**
    de ambos — coincide con la inscripción online del propio Brian. Se le avisa.
  - La inscripción online existente de Brian se **actualiza** (merge por nombre normalizado dentro
    del evento): categorías canónicas + parejas por categoría, conservando celular/email/DUPR.
  - Verificación: conteos por categoría contra la planilla, y cero jugadores nuevos cuyo nombre
    normalizado matchee uno existente.

## Pieza 4 — Caja: deudores sin duplicar

- En VentaModal, al elegir «Debe»:
  - **Lista de deudores abiertos** (nombre + saldo, de `porCobrar.deudores` que AdminCajaTab ya
    calcula y pasa por prop) como chips tocables → setean el nombre EXACTO (la deuda acumula bien).
  - **Sugerencias mientras escribe** (dropdown bajo el input, máx ~6): candidatos = deudores
    abiertos ∪ nombres históricos de deudores del ledger ∪ padrón (`getJugadoresNombres()`:
    select nombre+alias, cache en memoria de la pestaña). Matching con `normalizar` +
    (prefijo/contiene o `distancia ≤ 2`), deudores abiertos primero con «ya debe $X».
  - Elegir sugerencia = usar ese texto tal cual. Texto libre sigue permitido (cliente nuevo).
- Lógica de sugerencias en helper puro `sugerirDeudores(candidatos, texto)` en `src/utils/nombres.ts`,
  con tests (tildes, typo de 1-2 letras, prioridad de abiertos, límite).

## Fuera de alcance (anotado, no ahora)

- Aviso por Telegram de inscripciones nuevas (Brian eligió solo badge).
- Vincular inscripciones a `jugador_id` en la DB y armar torneos desde inscripciones.
- Export DUPR/CSV desde la pestaña (espera el club DUPR).
- Pagos/montos de inscripción en la web (siguen en la planilla/Caja por ahora).

## Testing

- Unit: split de categorías dobles vs singles en el form; armado de duplas por mención mutua;
  `sugerirDeudores`; mapeo de niveles del import; normalización compartida sin regresión (suite
  actual: 181 tests, debe seguir verde).
- E2E manual con build real: inscribirse con Mixto + género → dos campos de pareja y jsonb correcto;
  pestaña con badge que se apaga al visitarla; venta «Debe» eligiendo deudor existente acumula en el
  mismo nombre.
- `npx tsc -b` y `npm run build` como gates (regla typecheck VOLEA).
