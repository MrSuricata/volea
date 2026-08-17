# Cobro de inscripciones + buscador

**Fecha**: 2026-08-15 · **Dictado por Brian**: $1.200 incluye 3 categorías, +$200 por adicional;
botón "ya pagó" que confirma; calcular cuánto debe / cuánto paga / por dónde; lo pendiente queda
como **deuda con el nombre** (= el "Por cobrar" de la Caja); botón **free pass** (socios/invitados)
como forma de pago. Y un **buscador** de jugadores en la pestaña.

## Diseño

- **Tarifa por evento**: columna `events.tarifa jsonb` — `{"base":1200,"incluye":3,"extra":200}`
  seteada para el Racket Roll. Sin tarifa ⇒ la UI de cobro no aparece (eventos viejos igual).
  El upsert de eventos del admin no incluye la clave ⇒ no la pisa (PostgREST solo actualiza las
  columnas del payload).
- **Costo**: `costoInscripcion(nCats, tarifa) = base + max(0, n − incluye) × extra` (singles
  cuentan como categoría). Helper puro con tests en utils/inscripciones.
- **Registro de pago**: RPC `admin_pago_inscripcion(p_id, p_monto, p_metodo, p_reported_by)`
  (SECURITY DEFINER, is_admin, métodos `efectivo|mp|transferencia|freepass`), atómica:
  - Calcula el costo SERVER-SIDE (categorías de la fila + tarifa del evento; no confía en el cliente).
  - `freepass`: sin plata, sin filas de caja; marca la inscripción y la confirma.
  - Resto: `0 ≤ monto ≤ costo`. Inserta en `bot_ledger` una venta «Inscripción: NOMBRE» por lo
    pagado (mismo shape que admin_registrar_venta: qty 1, chat_id 0, reported_by) y, si queda
    saldo, una segunda fila con `payment_method='debe'` y `debtor_name=NOMBRE` («…(saldo)») —
    entra al **Por cobrar de la Caja** con cobro parcial FIFO, liquidación y export ya existentes.
  - Guarda el resumen en la inscripción (`pago_costo/pago_monto/pago_metodo/pago_deuda/pago_at`)
    y pasa `estado='confirmada'`. Rechaza doble registro (`pago_at` ya seteado); para deshacer:
    anular las filas en la Caja y limpiar `pago_*` por SQL (v1 sin botón de deshacer).
- **UI pestaña**: banner de tarifa; por fila: chip «a cobrar $X» + botón «$ Registrar pago» (abre
  PagoModal: desglose del costo, monto editable, chips de método, preview de deuda) → después
  chip verde «pagó $X · efectivo» / ámbar «pagó $X · debe $Y» / violeta «FREE PASS». Totales del
  evento: cobrado / en deuda / sin registrar. La deuda VIVA se mira en la Caja (acá queda la foto
  del acuerdo).
- **Buscador**: input arriba de las vistas; filtra por nombre y por parejas declaradas
  (normalizado, sin tildes); al escribir se fuerza la vista Recientes.

## Plan

1. Migración: `events.tarifa` + 5 columnas `pago_*` en inscripciones + seed tarifa Racket Roll +
   RPC (grants solo authenticated). 2. `costoInscripcion` TDD. 3. Types+service (tarifa, pago,
   `pagoInscripcion`). 4. UI (buscador, chips, PagoModal, totales). 5. Gates + deploy + E2E real
   (pago completo, parcial→deuda visible en Caja, freepass) + memoria.
