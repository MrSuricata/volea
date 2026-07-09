# VOLEA — Deploy & Sync Guide

Stack: React 19 + Vite + Tailwind + Supabase (nativo, sin Shopify).

---

## Arquitectura (v2 nativa — julio 2026)

- **TODO vive en Supabase** (`volea-web`): productos, stock, fotos (Storage), categorías, pedidos, blog, clasificación, eventos, clubes, anuncios.
- **Ventas**: el cliente arma el carrito y envía el pedido → queda en la tabla `orders` y se abre WhatsApp con el detalle. El pago y la entrega se coordinan por WhatsApp (transferencia/efectivo).
- **Gestión**: todo desde `/#/admin` — crear/editar productos con fotos, talles, colores y stock por talle×color; pedidos con estados; blog; clasificación al Mundial.
- **Shopify**: quedó FUERA del flujo. `src/data/shopify-catalog.json` sobrevive solo como fallback de emergencia si Supabase está caído (catálogo de solo lectura congelado a julio 2026).

---

## 1. Desarrollo local

```powershell
npm install
npm run dev
# http://localhost:3001
```

La app carga todo desde Supabase (productos, blog, clasificación, pedidos). Sin Supabase cae al snapshot legacy + localStorage.

---

## 2. Gestionar el catálogo

Ya NO hay sincronización con Shopify. Los productos se gestionan desde el panel:

1. Entrá a `/#/admin` → pestaña **Productos** → "Nuevo producto" o el lápiz para editar.
2. Cargá nombre, precio, categoría, descripción, **fotos** (se suben a Supabase
   Storage), **talles**, **colores** y el **stock por combinación talle×color**.
3. Guardá — los cambios son instantáneos en la web, sin rebuild ni deploy.

> Migración histórica: los 30 productos y 35 fotos de Shopify se migraron el
> 2026-07-09 con `scripts/migrate-to-native.mjs` (one-shot, no volver a correr).

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
  - **Stock & Alertas**: detalle por talle×color con filtros y edición directa
  - **Productos**: CRUD completo — fotos, talles, colores, stock, destacado/oferta/activo
  - **Pedidos**: pedidos de la web con estados pendiente/confirmado/enviado/entregado
  - **Blog**: publicaciones con portada, borradores y publicación
  - **Clasificación**: ranking "Camino al Mundial" (visible en /clasificacion)
  - **Eventos / Categorías / Clubes / Anuncios**: editables, persisten en Supabase

---

## 5. Supabase

Proyecto: **volea-web** (`scftuxrtflfowohiewsc`, región São Paulo). Schema documentado en `supabase-schema.sql` (v3: admins, events, clubs, announcements, orders + RLS con `is_admin()`).

El cliente hace health-check al inicio. Si el proyecto está pausado o falla DNS, cae al snapshot legacy + localStorage en silencio (la tienda se ve pero desactualizada, y los pedidos solo quedan en el navegador). Mantener el proyecto activo es importante.

⚠ **Plan free de Supabase**: el proyecto se pausa tras ~1 semana sin uso. Si el admin deja de persistir, revisar en el dashboard de Supabase que el proyecto esté activo y restaurarlo.

Env vars (ya configuradas en Vercel y `.env.local`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

---

## 6. WhatsApp Business
Todos los pedidos se envían por WhatsApp al `+598 99 511 196` y quedan registrados en la tabla `orders` (visibles en el admin). El pago se coordina por WhatsApp: transferencia, efectivo o lo que acuerden.

---

## 7. Recursos

- Logo: `/public/logo.png` y `/public/logo-white.png`
- Imágenes de productos: Supabase Storage (bucket `product-images`), se suben desde el admin
- Imágenes de lifestyle / hero: `/public/products/`
