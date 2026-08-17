# Ficha del jugador: deudas vinculadas + historial de compras

**Fecha**: 2026-08-17 · **Aprobado por Brian**: marcar comprador en TODAS las ventas (opcional),
vinculación ASISTIDA de los nombres viejos, y ficha del jugador en pestaña propia.

## Problema

`bot_ledger.debtor_name` es texto libre: hoy hay **36 nombres distintos** para ~25 personas
(`Luis / Luis B / luis b / Luis Conde / Luis conde`, `Brian / brian / Braian`, `Paulisegu`,
`TROYA`…), y las deudas se agrupan por nombre EXACTO, así que la misma persona aparece partida.
Además solo 59 de 213 ventas tienen nombre (las fiadas): no hay forma de ver qué compró alguien
que pagó en el momento.

## Diseño

### Dato

- `bot_ledger.jugador_id text references rk_jugadores(id) on delete set null` (nullable).
  Es el **comprador**, sirva o no de deudor. `debtor_name` NO cambia de semántica (sigue siendo
  "quién debe", solo para fiados) — así `admin_cobrar_deudor`, la liquidación a socios y el bot
  de Telegram siguen intactos.
- **Al vincular se canoniza**: las filas de ese deudor pasan a tener `jugador_id` Y
  `debtor_name` = nombre del padrón. Las deudas partidas se juntan solas con la lógica que ya
  existe, sin capas de indirección.

### RPCs

- `admin_vincular_deudor(p_nombre text, p_jugador_id text)`: todas las filas con ese
  `debtor_name` (comparado normalizado) reciben `jugador_id` y el nombre canónico. Devuelve
  cuántas tocó. Solo admins.
- `admin_registrar_venta` gana `p_jugador_id text default null` (default obligatorio: PostgREST
  resuelve por nombre de argumento y un bundle viejo cacheado debe seguir andando — lección
  `p_paid_by`). Si hay jugador y el método es `debe`, el `debtor_name` se guarda canónico.

### UI

1. **Nueva venta** (Caja): campo *"¿Quién compró?"* opcional SIEMPRE (no solo en Debe), con el
   buscador de jugadores del padrón. Vacío = venta anónima, igual de rápida que hoy. Con método
   `debe` sigue siendo obligatorio identificar a alguien.
2. **Vincular deudores** (Caja): modal que lista los `debtor_name` sin vincular con su saldo y
   cantidad de movimientos, con la sugerencia del padrón al lado (`sugerirDeudores`); Brian
   confirma, corrige o marca *"no es un jugador"* (MADRE MATIAS, pickleball city) — eso último
   se recuerda en `localStorage` para no volver a ofrecerlo.
3. **Pestaña "Jugadores"** (nueva): buscador sobre el padrón (nombre, alias, DUPR) con chips de
   deuda; al elegir uno, su ficha: DUPR ID (editable), deuda abierta, total comprado, historial
   de movimientos (fecha, detalle, monto, método, si quedó fiado o se cobró) y sus inscripciones
   por evento. El historial arma con `jugador_id` **∪** `debtor_name` normalizado (así las viejas
   sin vincular igual aparecen).

## Sin cambios

Cobro de deudas (FIFO), liquidación a socios, export de Caja, bot de Telegram, ranking.

## Testing

Unit: `historialDeJugador` (une por id y por nombre, excluye anuladas, suma comprado y deuda) y
`nombresSinVincular`. E2E: venta con comprador → aparece en su ficha; vincular "Luis conde" →
las 5 variantes se juntan; ficha muestra deuda igual a la de la Caja. Gates: `npx tsc -b`,
`npm run build`, suite verde.
