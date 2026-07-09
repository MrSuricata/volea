# VOLEA — Deploy & Sync Guide

Stack: React 19 + Vite + Tailwind + Supabase (opcional) + Shopify (headless).

---

## Arquitectura

- **Productos, stock y checkout**: Shopify Admin (`volea-6996.myshopify.com`) es la fuente de verdad.
- **Web**: consume un snapshot del catálogo (`src/data/shopify-catalog.json`) generado al sincronizar. El botón "Pagar ahora" redirige al checkout real de Shopify vía cart permalinks.
- **Eventos, clubes, anuncios, pedidos consulta**: Supabase (si está conectado) con fallback automático a localStorage.

---

## 1. Desarrollo local

```powershell
npm install
npm run dev
# http://localhost:3001
```

Si no querés tocar nada, la app arranca con el catálogo de Shopify ya sincronizado y `localStorage` para el resto.

---

## 2. Sincronizar catálogo desde Shopify

El catálogo se regenera en dos pasos:

1. **Dump**: bajar todos los productos de la Shopify Admin API (GraphQL) a
   `src/data/products-full.json`. La query exacta está documentada en el header
   de `scripts/build-catalog.mjs`. Lo más fácil: pedirle al asistente (Claude,
   con el MCP de Shopify conectado) que "sincronice el catálogo de VOLEA".
2. **Build**: `node scripts/build-catalog.mjs` → regenera `src/data/shopify-catalog.json`
   con categorías, detección de color/talle/sexo y alertas de datos (productos sin
   foto, precios en $0).

Después: commit + push, y Vercel rebuilea automáticamente.

---

## 3. Deploy a Vercel

### Opción A — CLI (rápido)
```powershell
npm i -g vercel
npx vercel             # primer deploy (preview)
npx vercel --prod      # producción
```

### Opción B — GitHub → Vercel
1. Subir el repo a GitHub.
2. [vercel.com](https://vercel.com) → New Project → importar.
3. Framework: **Vite** · Build: `npm run build` · Output: `dist`.
4. Variables de entorno (opcionales — ver `.env.example`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_ADMIN_PASSWORD`
5. Deploy.

### Dominio
Vercel → Settings → Domains → Add `volea.uy` (o el que tengas).

`vercel.json` ya incluye:
- Rewrites SPA (todo a `/index.html`)
- Headers de seguridad (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`)

---

## 4. Panel de Admin

- URL: `https://<tu-dominio>/#/admin` (con el router actual: `/admin`)
- **Login**: magic link por email (Supabase Auth). Solo emails en la tabla `admins`:
  - `brianridv@gmail.com` (owner)
  - `bridvanovich@twf.uy` (owner)
  - `somosvolea@gmail.com` (admin)
  - Para agregar a Gastón/Paula/Valeria: `INSERT INTO admins (email, name, role) VALUES ('email', 'Nombre', 'admin');` en el SQL Editor de Supabase.
- El fallback por password (`adminvolea` / `VITE_ADMIN_PASSWORD`) solo aplica si Supabase está caído.
- Pestañas:
  - **Dashboard**: KPIs y alertas de stock
  - **Stock & Alertas**: detalle por variante, filtros, link a Shopify para editar
  - **Productos**: vista read-only con link directo a cada producto en Shopify (Shopify es la fuente)
  - **Eventos / Clubes / Anuncios**: editables, persisten en Supabase
  - **Pedidos**: consultas por WhatsApp con estados pendiente/confirmado/enviado/entregado (los pagos online viven en Shopify → admin.shopify.com/store/volea-6996/orders)

---

## 5. Supabase

Proyecto: **volea-web** (`scftuxrtflfowohiewsc`, región São Paulo). Schema documentado en `supabase-schema.sql` (v3: admins, events, clubs, announcements, orders + RLS con `is_admin()`).

El cliente hace health-check al inicio. Si el proyecto está pausado o falla DNS, cae a localStorage en silencio (la tienda y el checkout de Shopify siguen funcionando; se pierde persistencia central de pedidos/eventos).

⚠ **Plan free de Supabase**: el proyecto se pausa tras ~1 semana sin uso. Si el admin deja de persistir, revisar en el dashboard de Supabase que el proyecto esté activo y restaurarlo.

Env vars (ya configuradas en Vercel y `.env.local`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

---

## 6. WhatsApp Business
Los pedidos "consulta antes de pagar" se envían por WhatsApp al `+598 99 511 196`. El pago real va por el checkout de Shopify donde tenés configurado Mercado Pago, transferencia, etc.

---

## 7. Recursos

- Shopify admin: https://admin.shopify.com/store/volea-6996
- Logo: `/public/logo.png` y `/public/logo-white.png`
- Imágenes de productos: vienen del CDN de Shopify (`cdn.shopify.com`)
- Imágenes de lifestyle / hero: `/public/products/`
