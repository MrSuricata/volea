# Diseño: Caja amigable (restyle estilo Racket Point)

**Fecha:** 2026-08-06 · **Estado:** Aprobado por Brian · **Alcance:** SOLO visual/UX en `src/components/AdminCajaTab.tsx` (+ helper puro de fechas con tests). Cero cambios de funcionalidad: mismos props (`loadLedger`, `loadLedgerFull`, `revertEntry`, `loadSocioMoves`), misma RPC de anulación, mismo export, mismos filtros y derivaciones de datos.

## Referencia

La caja de Racket Point (`racket-point/src/pages/CajaPage.tsx` + `ui.tsx`), traducida del tema oscuro (ink/azul/lima/rosa) al claro de VOLEA (white/navy-700/lime-400 + tintes `-50`/`-100`).

## Secciones (top-to-bottom)

1. **Header**: igual que hoy (h1 `hidden lg:block` por consistencia con el resto del admin, botones Excel/Actualizar).
2. **Callout informativo**: el banner azul `border-l-4` pasa a callout suave `rounded-xl bg-navy-50 px-4 py-2.5 text-xs text-navy-600`, texto más corto.
3. **Totales** (grid 2/4): tarjetas `bg-white rounded-xl p-4 shadow-sm border border-gray-100` con label `text-xs font-semibold text-gray-500 uppercase`, valor `font-display text-2xl font-bold` (+color por tipo) y **subtexto de contexto** `text-[11px] text-gray-400` ("14 ventas", "3 gastos", "sobre N movimientos"). La 4ª tarjeta pasa de "Movimientos" a **"Por cobrar"** (ámbar: valor `text-amber-600`, subtexto "N fiados sin cobrar" o "nada pendiente").
4. **Deudores** (solo si hay fiado pendiente): sección con header `text-sm font-extrabold uppercase tracking-wide text-gray-500` ("Por cobrar (N personas)") y una fila por deudor: `flex items-center gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2.5`, avatar-inicial `h-9 w-9 rounded-full bg-amber-100 text-amber-700 font-extrabold`, nombre bold + "N ítems · desde <fecha corta>", monto a la derecha `font-bold tabular-nums text-amber-600`. Nota al pie de la sección: `text-[11px] text-gray-400` "Se cobra desde el bot: «cobré <nombre>»". (Los datos salen del mismo cálculo actual de `porCobrar`, extendido a agrupar por `debtorName` — derivación en el componente, sin tocar servicios.)
5. **Filtros como chips**: `rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors`; período activo `bg-navy-700 text-white`, tipo activo `bg-lime-400 text-navy-700`, inactivos `bg-gray-100 text-gray-500 hover:text-navy-700`. Misma lógica de estado.
6. **Movimientos como filas-card** (se elimina `<table>`): header de sección "Movimientos (N)". Cada fila: `flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2.5` (+`opacity-45` si anulada); chip icono `h-9 w-9 rounded-lg` — venta `bg-green-50 text-green-600` con `TrendingUp`, gasto `bg-red-50 text-red-500` con `TrendingDown`; cuerpo `min-w-0 flex-1` con título `truncate text-sm font-bold` (+`line-through` si anulada) y UNA línea de meta `mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400` con: fecha humanizada, badge de método (MP `bg-blue-50 text-blue-600`, Efectivo `bg-green-50 text-green-700`, Transferencia `bg-navy-50 text-navy-600`, Debe `bg-amber-50 text-amber-700` con nombre; cobrada → texto "debía · cobrado <método>"), badge `✓ liquidado` `bg-teal-50 text-teal-600` si `socioSettledAt`, "Anulada" `bg-gray-100 text-gray-500`, y "por <reportedBy>". Monto a la derecha `font-bold tabular-nums` verde/rojo por signo (gris tachado si anulada). Cantidad integrada al título ("×2") solo si >1. Botón anular = icono `Undo2` `rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-500`.
7. **Anulación en modal** (reemplaza la confirmación inline en celda): overlay `fixed inset-0 bg-black/60 z-50` + card centrada `bg-white rounded-2xl shadow-2xl max-w-sm p-6` con título "¿Anular este movimiento?", el label del movimiento, texto "Se anula y se repone el stock (igual que el deshacer del bot).", botones "Anular" (rojo `bg-red-500 hover:bg-red-600 text-white`) y "Cancelar" (borde). Llama la MISMA `revertEntry`; toasts iguales.
8. **Estados**: loading real en primer load (spinner `Loader2 animate-spin` en card punteada — hoy muestra "Sin movimientos" mientras carga, mentira conocida); vacío y error con estilo RP claro: `rounded-2xl border border-dashed border-gray-300 py-10 text-center` + icono 32 `text-gray-300`, título `text-sm font-bold text-gray-500`, sub `text-xs text-gray-400`.

## Helper puro con tests

`src/utils/fechas.ts`: `fechaHumana(iso: string, ahoraMs: number): string` → `"hoy 14:32"` / `"ayer 09:15"` / `"mar 5/8 · 14:32"` (día de semana es-UY corto, sin año; hora Montevideo como hace hoy `formatDateTime`). Tests vitest: hoy, ayer, semana pasada, cruce de medianoche.

## Fuera de alcance

Turnos/arqueo/retiros/conciliación de RP; alta de movimientos desde la UI; botón "Cobrar" en deudores; cambios en `cajaExcel`, servicios o RPCs; pestaña Socios.
