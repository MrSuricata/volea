# Diseño: Mercado Pago (Checkout Pro) en la web VOLEA

**Fecha:** 2026-08-05
**Estado:** Aprobado por Brian (sesión 2026-08-05)
**Decisiones previas (sesión anterior):** Checkout Pro + funciones serverless de Vercel en este mismo repo. Sandbox primero, producción después.
**Decisiones de hoy:** el pago con MP es **opcional** junto al flujo WhatsApp actual; Brian todavía no tiene credenciales (la cuenta vendedor existe — venden con QR de MP — falta crear la aplicación en el panel de desarrolladores).

## Objetivo

Que el cliente pueda pagar online con Mercado Pago desde el checkout, sin romper ni cambiar el flujo actual de pedidos coordinados por WhatsApp. Si MP no está configurado (faltan credenciales, dev local), la web se comporta exactamente como hoy.

## Restricciones

- **No romper el checkout actual** (`orders` + WhatsApp): es la base y sigue siendo el camino por defecto.
- El ACCESS_TOKEN de MP y la service role key de Supabase viven SOLO en env vars de Vercel. Jamás en el frontend ni commiteadas.
- Los pedidos no descuentan stock (decisión existente); el pago tampoco. El stock se mueve solo con ventas del bot o edición manual.
- Comisión MP UY ~5-6%: por eso WhatsApp/transferencia sigue disponible.

## Flujo del cliente

1. En `/#/checkout`, además del botón actual de WhatsApp aparece **"Pagar con Mercado Pago"**. El botón solo se muestra si `GET /api/mp/disponible` responde `{disponible: true}` (si el fetch falla — dev local con Vite, credenciales sin cargar — no se muestra y nada más cambia).
2. Al elegir MP: se valida stock (igual que hoy), se inserta el pedido en `orders` (insert anónimo, como siempre) con `payment_status='iniciado'` y `payment_provider='mp'`, se llama a `POST /api/mp/preferencia` con el id del pedido y se redirige (`window.location.href`) al `init_point` de MP.
3. **El carrito NO se vacía antes de redirigir.** Vive en localStorage; se vacía recién al volver con pago aprobado o pendiente. Si el pago se rechaza o el cliente abandona, el carrito sigue intacto para reintentar o irse por WhatsApp.
4. MP redirige de vuelta a `GET /api/mp/retorno?...` (los `back_urls` no pueden apuntar directo a una ruta con `#` — el HashRouter y los query params de MP se pisan, mismo problema conocido de los magic links). Esa función mapea los parámetros y responde 302 a `/#/pago/resultado?estado=aprobado|pendiente|rechazado&pedido=VO-...`.
5. La página nueva `/#/pago/resultado` (lazy) muestra el resultado:
   - **aprobado**: "¡Pago recibido!" + botón "Coordinar entrega por WhatsApp" (mensaje pre-armado con la referencia del pedido). Vacía el carrito.
   - **pendiente** (efectivo/redes de cobranza, etc.): explica que queda pendiente de acreditación. Vacía el carrito.
   - **rechazado**: opciones de reintentar (vuelve al checkout con el carrito intacto) o coordinar por WhatsApp.
   - El estado que muestra esta página es informativo (viene por query param); la fuente de verdad del pago es el webhook.

## Serverless (`api/` en la raíz del repo)

Vercel sirve las funciones de `api/*.ts` junto a la SPA de Vite. Handlers finos + lógica en helpers puros testeables (`api/_lib/`). Sin SDK de MP: `fetch` directo a la API REST + `node:crypto` para la firma (menos dependencias). `@vercel/node` como devDependency para los tipos.

### `POST /api/mp/preferencia`
- Body: `{ orderId }`.
- Lee el pedido de `orders` vía Supabase con **service role key**. 404 si no existe; 409 si ya está pagado.
- **Seguridad de precios**: NO confía en los precios guardados por el cliente. Relee cada producto de `products` y arma los items de la preferencia con el precio real de la DB (si un producto ya no existe, error claro). El total pagable es el que dice la DB.
- Crea la preferencia (`POST https://api.mercadopago.com/checkout/preferences`, Bearer `MP_ACCESS_TOKEN`): items con `currency_id: 'UYU'`, `external_reference = orderId`, `back_urls` → `/api/mp/retorno`, `auto_return: 'approved'`, `notification_url` → `/api/mp/webhook`, `statement_descriptor: 'VOLEA'`.
- Guarda `mp_preference_id` en el pedido y responde `{ initPoint }`.
- 503 con mensaje claro si faltan env vars.

### `POST /api/mp/webhook`
- Valida la firma `x-signature` de MP: HMAC-SHA256 con `MP_WEBHOOK_SECRET` sobre el template `id:[data.id];request-id:[x-request-id];ts:[ts];` (no requiere raw body). Firma inválida → 401.
- Solo procesa `type=payment`. Consulta el pago real a la API de MP (`GET /v1/payments/:id`) — nunca confía en el payload de la notificación.
- Mapea estado MP → `payment_status`: `approved`→`aprobado`, `pending`/`in_process`/`authorized`→`pendiente`, `rejected`/`cancelled`→`rechazado`, `refunded`/`charged_back`→`devuelto`.
- Actualiza el pedido por `external_reference` con service role: `payment_status`, `mp_payment_id`, `paid_at`, `paid_amount`.
- **Idempotente**: procesar la misma notificación dos veces deja el mismo estado. Responde 200 rápido (MP reintenta ante no-200).
- No toca stock.

### `GET /api/mp/retorno`
- Sin secretos. Traduce los query params de MP (`status`, `external_reference`, `payment_id`) y responde 302 a la ruta hash de la SPA.

### `GET /api/mp/disponible`
- `{ disponible: boolean }` según presencia de las env vars necesarias. Es lo único que decide si el botón MP aparece en el checkout.

### `vercel.json`
- El rewrite de la SPA pasa de `/(.*)` a `/((?!api/).*)` para no capturar las funciones.

## Base de datos (migración en volea-web)

```sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_status TEXT,        -- null = flujo WhatsApp puro
  ADD COLUMN IF NOT EXISTS payment_provider TEXT,      -- 'mp'
  ADD COLUMN IF NOT EXISTS mp_preference_id TEXT,
  ADD COLUMN IF NOT EXISTS mp_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC;
```

- RLS no cambia: anon solo INSERT (los campos de pago iniciales entran en ese insert), admins todo, el webhook escribe con service role (bypassa RLS).
- **Guarda anti-fraude (agregada tras el review de implementación)**: como el INSERT anónimo es abierto, un trigger `BEFORE INSERT` clampa los campos de pago de cualquier insert que no venga del service role (`payment_status` a lo sumo `'iniciado'`; `mp_payment_id`/`paid_at`/`paid_amount` en NULL) + CHECK de valores válidos de `payment_status`. Sin esto, cualquiera podía fabricarse un pedido "ya pagado" por la API pública y el admin lo mostraría como 💳 Pagado. El webhook (UPDATE con service role) no se ve afectado.
- El DDL de `supabase-schema.sql` se actualiza en el mismo commit (lección pendiente de rk_*: el schema del repo tiene que reflejar la DB real).

## Frontend

- `types.ts`: `Order` suma opcionales `paymentStatus`, `paymentProvider`, `mpPaymentId`, `mpPreferenceId`, `paidAt`, `paidAmount`.
- `supabaseService.ts`: `orderToRow`/`getOrders` mapean las columnas nuevas.
- `CheckoutPage`: botón MP condicional + textos ajustados ("pagá online o coordiná por WhatsApp"). El camino WhatsApp queda byte a byte como está.
- Página nueva `/#/pago/resultado` (lazy, chica).
- Admin → Pedidos: badge de pago por pedido — 💳 "Pagado (MP)" (verde), "MP iniciado" (gris, útil para rescatar por WhatsApp al que abandonó el pago), "MP rechazado" (rojo), "MP pendiente" (amarillo), "Devuelto". Sin cambios de flujo de estados del pedido.

## Credenciales y configuración (tarea de Brian, con guía)

`docs/MERCADOPAGO.md` con el paso a paso:

1. Entrar a las herramientas de desarrollador de MP (mercadopago.com.uy → Tus integraciones) **con la misma cuenta del QR de ventas** — el checkout cobra a esa cuenta.
2. Crear aplicación (tipo: pagos online / CheckoutPro).
3. Copiar credenciales de **prueba** (Access Token de test) y probar con tarjetas de test; recién después cambiar al Access Token de producción.
4. Configurar el webhook en el panel de MP: URL `https://volea.vercel.app/api/mp/webhook`, evento `payments`, y copiar la **clave secreta** que muestra MP.
5. Cargar en Vercel (proyecto `volea` → Settings → Environment Variables):
   - `MP_ACCESS_TOKEN` (test primero, prod después)
   - `MP_WEBHOOK_SECRET`
   - `SUPABASE_SERVICE_ROLE_KEY` (Supabase volea-web → Settings → API keys)
   - `BASE_URL` = `https://volea.vercel.app`
6. Redeploy. El botón MP aparece solo cuando esto está cargado.

## Tests (vitest, mismo runner del repo)

Helpers puros en `api/_lib/` testeados sin red:

- Validación de firma del webhook (vectores conocidos: firma válida, inválida, ts viejo).
- Mapeo estado MP → `payment_status` (todos los estados).
- Armado de preferencia: precios tomados de la DB y no del pedido; producto inexistente → error.
- Mapeo de retorno → URL hash con estado y pedido.
- Idempotencia del update del webhook (mismo payload dos veces).

E2E sandbox: documentado en `docs/MERCADOPAGO.md`, se ejecuta cuando Brian cargue las credenciales de test. `npm test` + `npm run build` como gate antes de commitear.

## Fuera de alcance

- Descuento automático de stock al pagar (los pedidos no descuentan stock, decisión existente).
- Reflejar pagos MP del checkout en la Caja/bot de Telegram (la Caja es del bot; si algún día se quiere, es otra sesión).
- Cuotas, configuración fina de medios de pago, Checkout Bricks embebido.
- Emails de confirmación.

## Riesgos conocidos

- **HashRouter vs redirects externos**: resuelto con `/api/mp/retorno` como puente (no repetir el bug de los magic links).
- **Pedidos "iniciado" huérfanos** (cliente abandona el pago): quedan visibles en el admin como oportunidad de rescate por WhatsApp; no son error.
- **Supabase free pausado**: si la DB está pausada, `preferencia` falla con error claro y el cliente siempre tiene el camino WhatsApp.
- **Credenciales test vs prod**: una sola env var `MP_ACCESS_TOKEN`; el modo lo define qué token esté cargado. La guía lo deja explícito para no cobrar de verdad durante pruebas.
