# Mercado Pago en la web VOLEA — guía de puesta en marcha

La web ya tiene todo el código listo (probado y commiteado). El botón "Pagar
online con Mercado Pago" del checkout aparece SOLO cuando las credenciales de
abajo estén cargadas en Vercel. Hasta entonces, la web sigue funcionando
exactamente igual que ahora (pedidos por WhatsApp).

Esta guía no requiere saber programar — son todos pasos de copiar y pegar
claves entre dos paneles (Mercado Pago y Vercel).

## 1. Conseguir las credenciales (una sola vez, ~10 min)

1. Entrá a https://www.mercadopago.com.uy/developers → **"Tus integraciones"**
   (arriba a la derecha), **con la MISMA cuenta con la que cobran hoy con el
   QR** — el checkout online tiene que depositar en esa misma cuenta.
2. **"Crear aplicación"**: nombre `volea-web`. Te va a preguntar cómo vas a
   cobrar → elegí **"Pagos online"** → tienda con desarrollo propio (no hace
   falta poner nada más ahí) → **"Checkouts"** → **"Checkout Pro"**. Aceptás
   términos y confirmás.
3. Apenas se crea la aplicación, Mercado Pago ya te da credenciales de
   PRUEBA automáticamente (no hay que activarlas ni crear nada aparte). Andá
   a **"Pruebas" → "Credenciales de prueba"** y copiá el **Access Token de
   prueba** (empieza con `TEST-`).
4. En el menú de la aplicación → **"Webhooks" → "Configurar notificaciones"**:
   pegá la URL `https://volea.vercel.app/api/mp/webhook` y tildá **únicamente
   el evento "Pagos"** (no hace falta ningún otro — nuestro sistema ignora
   todo lo que no sea un pago, así que tildar más eventos solo genera ruido).
   Al guardar, Mercado Pago te muestra una **clave secreta**: copiala, es la
   misma para pruebas y para producción (no hay que volver a tocar esto
   cuando pasemos a producción en el paso 4).

   **Nota sobre las pruebas:** con credenciales de PRUEBA, Mercado Pago a
   veces no manda la notificación del pago por la vía automática de la
   preferencia — es una limitación conocida del ambiente de sandbox, no un
   bug nuestro. El webhook que acabás de configurar acá (en el panel) es el
   camino confiable, y esa misma pantalla tiene un botón **"Simular"** para
   mandar una notificación de prueba y confirmar que la URL responde bien.
   Si en el paso 3 de abajo el pedido queda "MP en proceso" sin pasar a
   pagado, no asumas que está roto: probá primero el simulador.

## 2. Cargar en Vercel y redeploy

**Antes de cargar nada:** esto solo tiene efecto una vez que la web en
producción ya tiene la página `/#/pago/resultado` (a donde Mercado Pago manda
de vuelta al cliente después de pagar) — si no existe, el botón mandaría a
la gente a pagar y después a una pantalla rota. Si esta guía ya está en el
repo, ese deploy ya pasó y este párrafo es solo para que quede constancia;
no hace falta que lo verifiques.

En Vercel → proyecto `volea` → **Settings → Environment Variables**, cargá:

| Variable | Valor | ¿Obligatoria? |
|---|---|---|
| `MP_ACCESS_TOKEN` | el Access Token (primero el de PRUEBA `TEST-...`) | Sí |
| `MP_WEBHOOK_SECRET` | la clave secreta del paso 1.4 | Sí |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → proyecto `volea-web` → **Settings → API → service_role key** | Sí |
| `BASE_URL` | `https://volea.vercel.app` | No — ya es el valor por defecto; solo cargala si el dominio de la web cambia |

Después de cargarlas: **Deployments → ⋯ (en el último deploy) → Redeploy**.

## 3. Probar en sandbox (sin plata real)

Con el Access Token de PRUEBA cargado:

1. Abrí la web, armá un carrito y elegí **"Pagar online con Mercado Pago"**.
2. Pagá con una tarjeta de prueba uruguaya (están en Developers → Pruebas →
   "Tarjetas de prueba"):

   | Tarjeta | Número | CVV | Vencimiento |
   |---|---|---|---|
   | Mastercard crédito | 5031 7557 3453 0604 | 123 | 11/30 |
   | Visa crédito | 4509 9535 6623 3704 | 123 | 11/30 |

   Documento: cualquiera, por ejemplo `12345678`.
   - Nombre del titular **`APRO`** → el pago se aprueba.
   - Nombre del titular **`OTHE`** → el pago se rechaza (sirve para probar
     el camino de error).
3. Con `APRO`: la vuelta a la web tiene que mostrar "¡Pago recibido!", y en
   el admin (pestaña Pedidos) el pedido aparece con el badge
   "💳 Pagado (MP)".
4. Con `OTHE`: la vuelta tiene que mostrar "El pago no se completó" y el
   carrito seguir lleno (no se vacía en un rechazo).
5. **Apenas tengas el primer pago APRO aprobado, avisale a Claude.** Con eso
   va a poder ir a los logs de Vercel del webhook, agarrar una firma
   `x-signature` real de Mercado Pago y dejarla fijada como caso de prueba
   permanente (hay un TODO anotado para esto en `api/_lib/mp.ts`, así el test
   de la firma queda validado contra un dato real de MP y no solo contra la
   lógica que nosotros mismos escribimos).

## 4. Pasar a producción

1. En Mercado Pago → la misma aplicación → **"Credenciales de producción"**:
   la primera vez te va a pedir completar rubro del negocio, sitio web y
   aceptar términos (una sola vez, ~2 minutos). Copiá el **Access Token de
   producción** (empieza con `APP_USR-`).
2. En Vercel, reemplazá el valor de `MP_ACCESS_TOKEN` por ese token y
   redeploy. **Nada más cambia** — la clave del webhook (`MP_WEBHOOK_SECRET`)
   es la misma que ya cargaste en el paso 1.4, sirve para prueba y producción
   por igual.

⚠️ La comisión de Mercado Pago en Uruguay ronda 5-6% por venta. La opción de
coordinar por WhatsApp y pagar por transferencia o efectivo sigue estando
igual que siempre, para quien prefiera evitar esa comisión.
