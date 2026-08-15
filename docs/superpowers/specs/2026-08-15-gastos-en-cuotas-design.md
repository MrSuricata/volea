# Gastos en cuotas (Socios)

**Fecha**: 2026-08-15 · **Aprobado por Brian** (chat, 14-15/8: Socios como lugar, total÷cuotas, primera cuota el mes de la compra, "quién cargó" = quién pagó, que ya existe)

## Contexto

Las compras en cuotas del Excel histórico (VASOS, TEMU en 12) viven en `socio_moves` como una
fila por mes con fecha futura; `esCuotaFutura` (utils/socios.ts) ya las excluye del saldo
"Al día de hoy" y el export ya tiene columna "Cuota futura". Lo que NO existe es cómo cargar
una compra nueva en cuotas: el form de Socios crea una sola fila. La Caja no juega acá: una
cuota es deuda de tarjeta entre socios, no plata que sale de la caja física hoy.

## Diseño

### Helper puro `armarCuotas` (utils/socios.ts)

`armarCuotas(total, n, primeraISO)` → `{ monto, fecha }[]` con:
- Cuota = `Math.round(total/n a centésimos)`; la **última absorbe la diferencia** para que la
  suma dé exacto el total.
- Fechas: la primera es `primeraISO` (la fecha del form, default hoy); las siguientes, mismo
  día en meses sucesivos con **tope de fin de mes** (compra 31/8 → 30/9, 31/10, 30/11…; 31/1 →
  28/2). Sin `Date.now()` adentro: la fecha se inyecta (tests deterministas).
- `n = 1` devuelve una sola cuota = comportamiento actual.

### Form de Socios (AdminSociosSection, solo tipo Gasto)

- Campo **"Cuotas"** junto al monto: entero 1-36, default 1. El monto sigue siendo el TOTAL.
- Con n > 1: preview bajo el monto — «6 cuotas de $1.000 — ago-26 a ene-27», aclarando la
  última si difiere por centavos. Validación extra: `montoNum >= n * 0.01`.
- Al guardar: se arman n inputs — descripción `«X (cuota i/n)»`, fecha de su cuota, mismo
  `pagador`/area, impactos por cuota con `impactosGasto(montoCuota, pagador)` (cada fila cierra
  en 0, el CHECK de la DB sigue valiendo), y un `cuotaGrupo` compartido generado en el cliente
  (`cuo-<ts36>-<rand>`). El reparto que se muestra en el preview del form sigue siendo el del
  total.

### Datos y service

- Migración: `alter table socio_moves add column if not exists cuota_grupo text;` (nullable;
  RLS/CHECK intactos). `socio_moves` no está en supabase-schema.sql (nació por migración MCP) —
  se mantiene ese precedente.
- `SocioMove` y `SocioMoveInput` ganan `cuotaGrupo: string | null` (opcional en el input).
- `addSocioMove(input)` **se convierte en** `addSocioMoves(inputs: SocioMoveInput[])`: valida
  cada input (impactos cierran en 0, monto > 0) y hace UN solo `.insert(filas)` — atómico: o
  entran todas las cuotas o ninguna. Único call chain: App → AdminSociosTab → AdminSociosSection
  (verificado, sin otros usuarios). El alta simple pasa `[input]`.
- `deleteSocioMovesGrupo(grupo)`: `.delete().eq('cuota_grupo', grupo)`.
- `getSocioMoves` mapea `cuota_grupo` → `cuotaGrupo`.

### Lista y borrado

- Filas con `esCuotaFutura`: chip gris «vence sep-26» para distinguirlas de un vistazo.
- El tachito sobre una fila con `cuotaGrupo` ofrece **«Borrar solo esta cuota»** o **«Borrar la
  compra entera (N cuotas)»** (N contado en los moves cargados); sin grupo, el confirm actual.

### Sin cambios

Saldos hoy/total (`esCuotaFutura` ya lo resuelve), export Excel, Caja y liquidación (las cuotas
no pasan por la caja), bot, RPCs.

## Testing

- `armarCuotas`: reparto exacto, centavos en la última, fin de mes (31→30/28, cruce de año),
  n=1, secuencia de 12.
- Suite actual (231) sigue verde; `npx tsc -b` y `npm run build` como gates.
- E2E manual: cargar gasto 3 cuotas → 3 filas con fechas correctas, saldo "hoy" solo cuenta la
  primera, borrar la compra entera las saca a las 3.
