# Mercado Pago Checkout Pro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pago online opcional con Mercado Pago (Checkout Pro) en el checkout de VOLEA, sin tocar el flujo WhatsApp actual.

**Architecture:** Funciones serverless de Vercel en `api/` (mismo repo que la SPA de Vite): `preferencia` crea la preferencia con precios releídos de la DB, `webhook` valida firma HMAC y marca el pedido vía service role, `retorno` puentea la vuelta de MP hacia el HashRouter, `disponible` decide si el botón aparece. Lógica en helpers puros (`api/_lib/`) testeados con vitest.

**Tech Stack:** Vercel Functions (TS, `@vercel/node` types), `fetch` directo a la API REST de MP (sin SDK), `node:crypto` para HMAC, `@supabase/supabase-js` con service role key (solo server), vitest.

**Spec:** `docs/superpowers/specs/2026-08-05-mercadopago-checkout-design.md`

**Convenciones del repo que aplican acá:** comentarios y nombres en español rioplatense; tests al lado del código (`*.test.ts`); `npm test` + `npm run build` como gate antes de cada commit; NO usar env vars para la URL/anon key de Supabase en el frontend (incidente 2026-07-13) — el service role key en `api/` SÍ va por env var de Vercel porque nunca llega al browser.

---

### Task 1: Migración de `orders` en volea-web + DDL del repo

**Files:**
- Modify: `supabase-schema.sql` (bloque de `orders`, línea ~69)

- [ ] **Step 1: Aplicar la migración en Supabase volea-web** (proyecto `scftuxrtflfowohiewsc`), vía MCP `apply_migration` con nombre `orders_pago_mp`:

```sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_status TEXT,
  ADD COLUMN IF NOT EXISTS payment_provider TEXT,
  ADD COLUMN IF NOT EXISTS mp_preference_id TEXT,
  ADD COLUMN IF NOT EXISTS mp_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC;

COMMENT ON COLUMN orders.payment_status IS 'null = flujo WhatsApp puro; iniciado/aprobado/pendiente/rechazado/devuelto para MP';
```

- [ ] **Step 2: Verificar** con `execute_sql`: `SELECT column_name FROM information_schema.columns WHERE table_name='orders' ORDER BY ordinal_position;` — deben aparecer las 6 columnas nuevas.

- [ ] **Step 3: Actualizar el DDL del repo.** En `supabase-schema.sql`, dentro del `CREATE TABLE IF NOT EXISTS orders (...)`, agregar después de la columna `status` (mantener el estilo del archivo):

```sql
  -- Pago online con Mercado Pago (2026-08-05). null = flujo WhatsApp puro.
  payment_status TEXT,
  payment_provider TEXT,
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  paid_at TIMESTAMPTZ,
  paid_amount NUMERIC,
```

También reemplazar el comentario viejo de la tabla (`-- Tabla de pedidos (consultas por WhatsApp desde el checkout; los pagos online reales viven en Shopify)`) por:

```sql
-- Tabla de pedidos: checkout anónimo coordinado por WhatsApp y/o pagado online
-- con Mercado Pago (el webhook escribe payment_status con service role).
```

- [ ] **Step 4: Commit**

```bash
git add supabase-schema.sql
git commit -m "feat: columnas de pago MP en orders (migracion orders_pago_mp aplicada)"
```

---

### Task 1b: Defensa anti-fraude en la DB (hallazgo del review de Task 1)

El INSERT anónimo de `orders` (`WITH CHECK (true)`) dejaría a cualquiera fabricar un pedido con `payment_status='aprobado'` y `paid_amount` inventado, que el admin mostraría como "💳 Pagado (MP)". Se cierra en la DB, invisible para la UX.

**Files:**
- Modify: `supabase-schema.sql` (bloque nuevo después de las policies de orders + CHECK de source actualizado)

- [ ] **Step 1: Migración `orders_pago_guardas`** en volea-web vía MCP `apply_migration`:

```sql
-- Valores válidos de payment_status (existentes son NULL: la constraint valida igual)
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IS NULL OR payment_status IN ('iniciado','aprobado','pendiente','rechazado','devuelto'));

-- Nadie que no sea el service role (webhook) puede insertar un pedido "ya pagado":
-- a los inserts de anon/authenticated se les clampa el estado a lo sumo 'iniciado'
-- y se les anulan los campos de acreditación.
CREATE OR REPLACE FUNCTION orders_clamp_pago() RETURNS trigger AS $$
BEGIN
  IF coalesce(auth.role(), 'anon') <> 'service_role' THEN
    IF NEW.payment_status IS NOT NULL THEN
      NEW.payment_status := 'iniciado';
    END IF;
    NEW.mp_payment_id := NULL;
    NEW.paid_at := NULL;
    NEW.paid_amount := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER orders_clamp_pago_insert
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_clamp_pago();
```

(El webhook hace UPDATE, no INSERT, así que el trigger no lo toca; el upsert del admin no manda columnas de pago, así que tampoco. Solo bloquea pedidos fabricados.)

- [ ] **Step 2: Verificar**: insertar por SQL `SET ROLE` no hace falta — alcanza con `execute_sql`:
  - `SELECT conname FROM pg_constraint WHERE conrelid='orders'::regclass AND conname='orders_payment_status_check';` → 1 fila.
  - `SELECT tgname FROM pg_trigger WHERE tgrelid='orders'::regclass AND tgname='orders_clamp_pago_insert';` → 1 fila.

- [ ] **Step 3: `supabase-schema.sql`**: agregar el mismo bloque (constraint + función + trigger) después de las policies de orders, con los mismos comentarios. Aprovechar y corregir el drift preexistente del CHECK de source en el DDL: `CHECK (source IN ('whatsapp', 'shopify', 'web'))` → `CHECK (source IN ('whatsapp', 'shopify', 'web', 'telegram'))` (la DB viva ya incluye 'telegram' desde el bot).

- [ ] **Step 4: Commit**

```bash
git add supabase-schema.sql
git commit -m "feat: guardas anti-fraude de pago en orders (clamp de insert anonimo + CHECK)"
```

---

### Task 2: Helpers puros de MP con TDD

**Files:**
- Create: `api/_lib/mp.ts`
- Test: `api/_lib/mp.test.ts`

Vitest los levanta solo (el include por defecto cubre `api/**/*.test.ts` desde la raíz; `test.environment` ya es `node`).

- [ ] **Step 1: Escribir los tests que fallan** — `api/_lib/mp.test.ts` completo:

```ts
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  armarItemsPreferencia,
  armarUrlRetorno,
  mapearEstadoMP,
  mpConfigurado,
  totalItems,
  validarFirmaWebhook,
} from './mp';

describe('mapearEstadoMP', () => {
  it('mapea todos los estados conocidos de MP', () => {
    expect(mapearEstadoMP('approved')).toBe('aprobado');
    expect(mapearEstadoMP('pending')).toBe('pendiente');
    expect(mapearEstadoMP('in_process')).toBe('pendiente');
    expect(mapearEstadoMP('authorized')).toBe('pendiente');
    expect(mapearEstadoMP('rejected')).toBe('rechazado');
    expect(mapearEstadoMP('cancelled')).toBe('rechazado');
    expect(mapearEstadoMP('refunded')).toBe('devuelto');
    expect(mapearEstadoMP('charged_back')).toBe('devuelto');
  });
  it('devuelve null ante estados desconocidos o vacíos', () => {
    expect(mapearEstadoMP('banana')).toBeNull();
    expect(mapearEstadoMP('')).toBeNull();
    expect(mapearEstadoMP(undefined)).toBeNull();
  });
});

describe('validarFirmaWebhook', () => {
  const SECRETO = 'secreto-de-prueba';
  // Arma una x-signature válida igual que MP: HMAC-SHA256 del manifest
  // `id:<data.id en minúscula>;request-id:<x-request-id>;ts:<ts>;`
  const firmar = (dataId: string, requestId: string, tsSeg: number) => {
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${tsSeg};`;
    const v1 = createHmac('sha256', SECRETO).update(manifest).digest('hex');
    return `ts=${tsSeg},v1=${v1}`;
  };

  it('acepta una firma válida', () => {
    const ts = 1754400000; // seg
    const r = validarFirmaWebhook({
      xSignature: firmar('12345', 'req-1', ts),
      xRequestId: 'req-1',
      dataId: '12345',
      secreto: SECRETO,
      ahoraMs: ts * 1000 + 60_000,
    });
    expect(r.ok).toBe(true);
  });

  it('acepta ts en milisegundos (MP manda ambos formatos según el caso)', () => {
    const tsMs = 1754400000000;
    const manifest = `id:12345;request-id:req-1;ts:${tsMs};`;
    const v1 = createHmac('sha256', SECRETO).update(manifest).digest('hex');
    const r = validarFirmaWebhook({
      xSignature: `ts=${tsMs},v1=${v1}`,
      xRequestId: 'req-1',
      dataId: '12345',
      secreto: SECRETO,
      ahoraMs: tsMs + 60_000,
    });
    expect(r.ok).toBe(true);
  });

  it('rechaza firma alterada', () => {
    const ts = 1754400000;
    const r = validarFirmaWebhook({
      xSignature: firmar('12345', 'req-1', ts).replace(/.$/, '0'),
      xRequestId: 'req-1',
      dataId: '12345',
      secreto: SECRETO,
      ahoraMs: ts * 1000,
    });
    expect(r.ok).toBe(false);
  });

  it('rechaza ts fuera de la ventana de tolerancia', () => {
    const ts = 1754400000;
    const r = validarFirmaWebhook({
      xSignature: firmar('12345', 'req-1', ts),
      xRequestId: 'req-1',
      dataId: '12345',
      secreto: SECRETO,
      ahoraMs: ts * 1000 + 11 * 60_000, // 11 min después (tolerancia: 10)
    });
    expect(r.ok).toBe(false);
  });

  it('rechaza cabeceras faltantes o malformadas', () => {
    expect(validarFirmaWebhook({ xSignature: undefined, xRequestId: 'r', dataId: '1', secreto: SECRETO }).ok).toBe(false);
    expect(validarFirmaWebhook({ xSignature: 'sin-formato', xRequestId: 'r', dataId: '1', secreto: SECRETO }).ok).toBe(false);
    expect(validarFirmaWebhook({ xSignature: 'ts=1,v1=abc', xRequestId: undefined, dataId: '1', secreto: SECRETO }).ok).toBe(false);
  });
});

describe('armarItemsPreferencia', () => {
  const catalogo = [
    { id: 'p1', name: 'Remera Classic', price: 990 },
    { id: 'p2', name: 'Gorro VOLEA', price: 550 },
  ];

  it('usa SIEMPRE el precio del catálogo, no el del pedido', () => {
    const items = armarItemsPreferencia(
      [{ product: { id: 'p1', name: 'Remera Classic', price: 1 } as never, quantity: 2, selectedSize: 'M', selectedColor: 'Fucsia' }],
      catalogo,
    );
    expect(items).toEqual([
      { id: 'p1', title: 'Remera Classic (M/Fucsia)', quantity: 2, unit_price: 990, currency_id: 'UYU' },
    ]);
  });

  it('arma el título sin variante cuando no hay talle/color', () => {
    const items = armarItemsPreferencia([{ product: { id: 'p2' } as never, quantity: 1 }], catalogo);
    expect(items[0].title).toBe('Gorro VOLEA');
  });

  it('explota claro si el producto ya no existe en el catálogo', () => {
    expect(() => armarItemsPreferencia([{ product: { id: 'nope' } as never, quantity: 1 }], catalogo))
      .toThrow(/no existe/);
  });

  it('explota ante cantidades inválidas', () => {
    expect(() => armarItemsPreferencia([{ product: { id: 'p1' } as never, quantity: 0 }], catalogo)).toThrow();
    expect(() => armarItemsPreferencia([{ product: { id: 'p1' } as never, quantity: -2 }], catalogo)).toThrow();
  });

  it('totalItems suma precio×cantidad', () => {
    const items = armarItemsPreferencia(
      [
        { product: { id: 'p1' } as never, quantity: 2 },
        { product: { id: 'p2' } as never, quantity: 1 },
      ],
      catalogo,
    );
    expect(totalItems(items)).toBe(990 * 2 + 550);
  });
});

describe('armarUrlRetorno', () => {
  const BASE = 'https://volea.vercel.app';
  it('mapea approved → aprobado con pedido y pago', () => {
    expect(armarUrlRetorno(BASE, { status: 'approved', external_reference: 'VO-ABC', payment_id: '99' }))
      .toBe('https://volea.vercel.app/#/pago/resultado?estado=aprobado&pedido=VO-ABC&pago=99');
  });
  it('mapea pending/in_process → pendiente', () => {
    expect(armarUrlRetorno(BASE, { status: 'pending', external_reference: 'VO-ABC' })).toContain('estado=pendiente');
    expect(armarUrlRetorno(BASE, { status: 'in_process', external_reference: 'VO-ABC' })).toContain('estado=pendiente');
  });
  it('mapea rejected → rechazado y usa collection_status como fallback', () => {
    expect(armarUrlRetorno(BASE, { status: 'rejected' })).toContain('estado=rechazado');
    expect(armarUrlRetorno(BASE, { collection_status: 'approved' })).toContain('estado=aprobado');
  });
  it('sin datos → desconocido, sin params extra', () => {
    expect(armarUrlRetorno(BASE, {})).toBe('https://volea.vercel.app/#/pago/resultado?estado=desconocido');
  });
});

describe('mpConfigurado', () => {
  it('true solo con las tres env vars presentes', () => {
    expect(mpConfigurado({ MP_ACCESS_TOKEN: 'a', MP_WEBHOOK_SECRET: 'b', SUPABASE_SERVICE_ROLE_KEY: 'c' })).toBe(true);
    expect(mpConfigurado({ MP_ACCESS_TOKEN: 'a', MP_WEBHOOK_SECRET: 'b' })).toBe(false);
    expect(mpConfigurado({})).toBe(false);
  });
});
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `npm test -- api/_lib/mp.test.ts`
Expected: FAIL — `Cannot find module './mp'` (o equivalente).

- [ ] **Step 3: Implementar `api/_lib/mp.ts`** completo:

```ts
// Helpers puros de la integración con Mercado Pago (Checkout Pro).
// Sin red ni entorno: todo lo inyectan los handlers, así se testean solos.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type EstadoPago = 'aprobado' | 'pendiente' | 'rechazado' | 'devuelto';

export function mapearEstadoMP(status: string | null | undefined): EstadoPago | null {
  switch ((status || '').toLowerCase()) {
    case 'approved': return 'aprobado';
    case 'pending':
    case 'in_process':
    case 'authorized': return 'pendiente';
    case 'rejected':
    case 'cancelled': return 'rechazado';
    case 'refunded':
    case 'charged_back': return 'devuelto';
    default: return null;
  }
}

export interface FirmaInput {
  xSignature: string | undefined;  // cabecera x-signature: "ts=...,v1=..."
  xRequestId: string | undefined;  // cabecera x-request-id
  dataId: string | undefined;      // query param data.id de la notificación
  secreto: string;                 // MP_WEBHOOK_SECRET
  ahoraMs?: number;                // inyectable en tests
  toleranciaMs?: number;           // default 10 minutos
}

// Validación de firma según el esquema de MP: HMAC-SHA256 en hex del manifest
// `id:<data.id en minúscula>;request-id:<x-request-id>;ts:<ts>;`. No usa el
// body crudo. El ts puede venir en segundos o milisegundos según la versión.
export function validarFirmaWebhook(i: FirmaInput): { ok: boolean; motivo?: string } {
  if (!i.xSignature || !i.xRequestId || !i.dataId) return { ok: false, motivo: 'faltan cabeceras' };
  const partes: Record<string, string> = {};
  for (const trozo of i.xSignature.split(',')) {
    const idx = trozo.indexOf('=');
    if (idx > 0) partes[trozo.slice(0, idx).trim()] = trozo.slice(idx + 1).trim();
  }
  const ts = partes['ts'];
  const v1 = partes['v1'];
  if (!ts || !v1) return { ok: false, motivo: 'x-signature malformada' };

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return { ok: false, motivo: 'ts no numérico' };
  const tsMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
  const ahora = i.ahoraMs ?? Date.now();
  const tolerancia = i.toleranciaMs ?? 10 * 60 * 1000;
  if (Math.abs(ahora - tsMs) > tolerancia) return { ok: false, motivo: 'ts fuera de ventana' };

  const manifest = `id:${i.dataId.toLowerCase()};request-id:${i.xRequestId};ts:${ts};`;
  const esperado = createHmac('sha256', i.secreto).update(manifest).digest('hex');
  const a = Buffer.from(esperado);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, motivo: 'firma no coincide' };
  return { ok: true };
}

// Item de pedido tal como vive en orders.items (CartItem serializado: el
// product viene embebido del cliente y NO es confiable para precios).
export interface ItemPedidoRow {
  product: { id: string; name?: string };
  quantity: number;
  selectedSize?: string;
  selectedColor?: string;
}

export interface ProductoCatalogo { id: string; name: string; price: number; }

export interface ItemPreferencia {
  id: string;
  title: string;
  quantity: number;
  unit_price: number;
  currency_id: 'UYU';
}

// Los precios salen SIEMPRE del catálogo (tabla products), jamás del pedido:
// el pedido lo insertó el cliente anónimo y podría traer precios editados.
export function armarItemsPreferencia(
  items: ItemPedidoRow[],
  catalogo: ProductoCatalogo[],
): ItemPreferencia[] {
  if (!items.length) throw new Error('El pedido no tiene items');
  return items.map(it => {
    const prod = catalogo.find(p => p.id === it.product?.id);
    if (!prod) throw new Error(`El producto ${it.product?.id ?? '(sin id)'} ya no existe en el catálogo`);
    const cantidad = Math.floor(it.quantity);
    if (!Number.isFinite(cantidad) || cantidad < 1) {
      throw new Error(`Cantidad inválida para ${prod.name}`);
    }
    const variante = [it.selectedSize, it.selectedColor].filter(Boolean).join('/');
    return {
      id: prod.id,
      title: variante ? `${prod.name} (${variante})` : prod.name,
      quantity: cantidad,
      unit_price: prod.price,
      currency_id: 'UYU' as const,
    };
  });
}

export const totalItems = (items: ItemPreferencia[]) =>
  items.reduce((s, i) => s + i.unit_price * i.quantity, 0);

export interface ParamsRetornoMP {
  status?: string;
  collection_status?: string;
  external_reference?: string;
  payment_id?: string;
}

// La vuelta de MP no puede aterrizar directo en una ruta con `#` (los query
// params y el HashRouter se pisan — mismo drama que los magic links), así que
// el handler de retorno traduce a la URL hash final con esta función.
export function armarUrlRetorno(baseUrl: string, p: ParamsRetornoMP): string {
  const st = (p.status || p.collection_status || '').toLowerCase();
  const estado =
    st === 'approved' ? 'aprobado'
    : st === 'pending' || st === 'in_process' ? 'pendiente'
    : st === 'rejected' ? 'rechazado'
    : 'desconocido';
  const q = new URLSearchParams({ estado });
  if (p.external_reference) q.set('pedido', p.external_reference);
  if (p.payment_id) q.set('pago', p.payment_id);
  return `${baseUrl}/#/pago/resultado?${q.toString()}`;
}

export function mpConfigurado(env: Record<string, string | undefined>): boolean {
  return Boolean(env.MP_ACCESS_TOKEN && env.MP_WEBHOOK_SECRET && env.SUPABASE_SERVICE_ROLE_KEY);
}
```

- [ ] **Step 4: Correr los tests y verlos pasar**

Run: `npm test -- api/_lib/mp.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Correr la suite entera** — `npm test` — Expected: PASS (las 130+ existentes + nuevas).

- [ ] **Step 6: Commit**

```bash
git add api/_lib/mp.ts api/_lib/mp.test.ts
git commit -m "feat: helpers puros de Mercado Pago (firma webhook, estados, preferencia, retorno)"
```

---

### Task 3: Handlers serverless + vercel.json + tipos de Vercel

**Files:**
- Create: `api/_lib/supabaseAdmin.ts`
- Create: `api/mp/disponible.ts`
- Create: `api/mp/preferencia.ts`
- Create: `api/mp/webhook.ts`
- Create: `api/mp/retorno.ts`
- Modify: `vercel.json`
- Modify: `package.json` (devDependency)

Los handlers son finos: parsean request, llaman helpers, responden. La lógica testeable ya quedó en `_lib`.

- [ ] **Step 1: Instalar tipos de Vercel**

Run: `npm install -D @vercel/node`
Expected: agrega `@vercel/node` a devDependencies sin vulnerabilidades nuevas.

- [ ] **Step 2: `api/_lib/supabaseAdmin.ts`**:

```ts
// Cliente Supabase con service role para las funciones serverless.
// La URL va hardcodeada a propósito (mismo criterio que src/services/
// supabaseClient.ts tras el incidente de env vars de 2026-07-13); la service
// role key SÍ viene de env porque solo existe en el runtime de Vercel.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://scftuxrtflfowohiewsc.supabase.co';

export function clienteAdmin(serviceRoleKey: string) {
  return createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 3: `api/mp/disponible.ts`**:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { mpConfigurado } from '../_lib/mp';

// Le dice al checkout si mostrar el botón de Mercado Pago. Sin credenciales
// cargadas en Vercel (o en dev local), responde false y la web queda como antes.
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ disponible: mpConfigurado(process.env) });
}
```

- [ ] **Step 4: `api/mp/preferencia.ts`**:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { armarItemsPreferencia, mpConfigurado } from '../_lib/mp';
import { clienteAdmin } from '../_lib/supabaseAdmin';

const baseUrl = () => process.env.BASE_URL || 'https://volea.vercel.app';

// Crea la preferencia de Checkout Pro para un pedido ya insertado en orders.
// Los precios se releen de products: acá no se confía en nada del cliente.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!mpConfigurado(process.env)) return res.status(503).json({ error: 'Mercado Pago no está configurado' });

  const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId : '';
  if (!orderId) return res.status(400).json({ error: 'Falta orderId' });

  const db = clienteAdmin(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: pedido, error } = await db
    .from('orders')
    .select('id, items, payment_status')
    .eq('id', orderId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'No se pudo leer el pedido' });
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (pedido.payment_status === 'aprobado') return res.status(409).json({ error: 'Este pedido ya está pagado' });

  const ids = [...new Set((pedido.items ?? []).map((i: { product?: { id?: string } }) => i.product?.id).filter(Boolean))];
  const { data: catalogo, error: errCat } = await db.from('products').select('id, name, price').in('id', ids as string[]);
  if (errCat || !catalogo) return res.status(500).json({ error: 'No se pudo leer el catálogo' });

  let items;
  try {
    items = armarItemsPreferencia(pedido.items ?? [], catalogo);
  } catch (e) {
    return res.status(422).json({ error: e instanceof Error ? e.message : 'Pedido inválido' });
  }

  const respMP = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items,
      external_reference: pedido.id,
      back_urls: {
        success: `${baseUrl()}/api/mp/retorno`,
        pending: `${baseUrl()}/api/mp/retorno`,
        failure: `${baseUrl()}/api/mp/retorno`,
      },
      auto_return: 'approved',
      notification_url: `${baseUrl()}/api/mp/webhook`,
      statement_descriptor: 'VOLEA',
    }),
  });
  if (!respMP.ok) {
    console.error('MP rechazó la preferencia:', respMP.status, await respMP.text());
    return res.status(502).json({ error: 'Mercado Pago rechazó la preferencia' });
  }
  const pref = await respMP.json();

  await db
    .from('orders')
    .update({ mp_preference_id: pref.id, payment_provider: 'mp', payment_status: pedido.payment_status ?? 'iniciado' })
    .eq('id', pedido.id);

  return res.status(200).json({ initPoint: pref.init_point });
}
```

- [ ] **Step 5: `api/mp/webhook.ts`**:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { mapearEstadoMP, mpConfigurado, validarFirmaWebhook } from '../_lib/mp';
import { clienteAdmin } from '../_lib/supabaseAdmin';

// Notificaciones de pago de MP. Valida la firma, consulta el pago REAL a la
// API (nunca confía en el payload) y marca el pedido. Idempotente: la misma
// notificación dos veces escribe lo mismo. Ante error responde no-200 y MP
// reintenta solo.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!mpConfigurado(process.env)) return res.status(503).end();

  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const dataId = uno(req.query['data.id'] as string | string[] | undefined)
    ?? (typeof req.body?.data?.id !== 'undefined' ? String(req.body.data.id) : '');
  const tipo = uno(req.query['type'] as string | string[] | undefined) ?? String(req.body?.type ?? '');

  const firma = validarFirmaWebhook({
    xSignature: req.headers['x-signature'] as string | undefined,
    xRequestId: req.headers['x-request-id'] as string | undefined,
    dataId: dataId || undefined,
    secreto: process.env.MP_WEBHOOK_SECRET!,
  });
  if (!firma.ok) {
    console.warn('Webhook MP con firma inválida:', firma.motivo);
    return res.status(401).end();
  }
  if (tipo !== 'payment' || !dataId) return res.status(200).json({ ignorado: true });

  const respMP = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
  });
  if (!respMP.ok) return res.status(502).end();
  const pago = await respMP.json();

  const estado = mapearEstadoMP(pago.status);
  const orderId: string | undefined = pago.external_reference;
  if (!estado || !orderId) return res.status(200).json({ ignorado: true });

  const patch: Record<string, unknown> = {
    payment_status: estado,
    payment_provider: 'mp',
    mp_payment_id: String(pago.id),
  };
  if (estado === 'aprobado') {
    patch.paid_at = pago.date_approved ?? new Date().toISOString();
    patch.paid_amount = pago.transaction_amount ?? null;
  }

  const db = clienteAdmin(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { error } = await db.from('orders').update(patch).eq('id', orderId);
  if (error) {
    console.error('Webhook MP: no se pudo actualizar el pedido', orderId, error.message);
    return res.status(500).end();
  }
  return res.status(200).json({ ok: true });
}
```

- [ ] **Step 6: `api/mp/retorno.ts`**:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { armarUrlRetorno } from '../_lib/mp';

// Puente entre la vuelta de Checkout Pro y el HashRouter de la SPA.
export default function handler(req: VercelRequest, res: VercelResponse) {
  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = req.query as Record<string, string | string[] | undefined>;
  res.redirect(302, armarUrlRetorno(process.env.BASE_URL || 'https://volea.vercel.app', {
    status: uno(q.status),
    collection_status: uno(q.collection_status),
    external_reference: uno(q.external_reference),
    payment_id: uno(q.payment_id),
  }));
}
```

- [ ] **Step 7: `vercel.json`** — que el rewrite de la SPA no capture `/api/`:

```json
{
  "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

- [ ] **Step 8: Gate** — `npm test` (PASS) y `npm run build` (PASS; el build no toca `api/`, pero confirma que nada del frontend se rompió).

- [ ] **Step 9: Commit**

```bash
git add api/ vercel.json package.json package-lock.json
git commit -m "feat: funciones serverless de Mercado Pago (preferencia, webhook, retorno, disponible)"
```

---

### Task 4: Tipos + mapeo en supabaseService + addOrder awaitable

**Files:**
- Modify: `src/types.ts` (interface `Order`, línea ~152)
- Modify: `src/services/supabaseService.ts` (`orderToRow` línea ~6, `getOrders` ~406, `addOrder` ~431)
- Modify: `src/App.tsx` (store: `addOrder` línea ~516, tipo del contexto línea ~227)

- [ ] **Step 1: `src/types.ts`** — reemplazar la interface `Order` por:

```ts
export type PaymentStatus = 'iniciado' | 'aprobado' | 'pendiente' | 'rechazado' | 'devuelto';

export interface Order {
  id: string;
  items: CartItem[];
  customer: CustomerInfo;
  total: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered';
  createdAt: string;
  /** Pago online (Mercado Pago). Ausente/null = flujo WhatsApp puro. */
  paymentStatus?: PaymentStatus | null;
  paymentProvider?: 'mp' | null;
  mpPreferenceId?: string | null;
  mpPaymentId?: string | null;
  paidAt?: string | null;
  paidAmount?: number | null;
}
```

- [ ] **Step 2: `supabaseService.ts` — `getOrders`** mapea las columnas nuevas. En el objeto que arma cada fila (después de `status:` y antes de `createdAt:`), agregar:

```ts
      paymentStatus: row.payment_status ?? null,
      paymentProvider: row.payment_provider ?? null,
      mpPreferenceId: row.mp_preference_id ?? null,
      mpPaymentId: row.mp_payment_id ?? null,
      paidAt: row.paid_at ?? null,
      paidAmount: row.paid_amount ?? null,
```

- [ ] **Step 3: `supabaseService.ts` — `addOrder`** pasa a devolver `boolean` (el flujo MP necesita saber que el insert aterrizó antes de mandar al cliente a pagar) y escribe los campos de pago SOLO en el insert:

```ts
  // Insert plano para el checkout anónimo. RLS permite INSERT a cualquiera,
  // pero rechaza el upsert (ON CONFLICT DO UPDATE) porque el brazo UPDATE
  // exige is_admin(). No usar upsert acá.
  // Devuelve true si el insert llegó a Supabase: el flujo de Mercado Pago
  // NO manda al cliente a pagar si el pedido no quedó en la DB.
  async addOrder(o: Order): Promise<boolean> {
    if (!supabase) return false;
    const row: Record<string, unknown> = orderToRow(o);
    // Los campos de pago se escriben SOLO acá (insert del checkout). El
    // upsert del admin (setOrders/orderToRow) no los incluye a propósito:
    // así nunca pisa lo que el webhook de MP escribió con service role.
    if (o.paymentStatus) {
      row.payment_status = o.paymentStatus;
      row.payment_provider = o.paymentProvider ?? 'mp';
      // 'web' y no 'web-mp': el CHECK orders_source_check de la DB viva solo
      // admite whatsapp/shopify/web/telegram. El pago se distingue por
      // payment_provider, no por source.
      row.source = 'web';
    }
    const { error } = await supabase.from('orders').insert(row);
    if (error) { console.error('Error inserting order:', error); return false; }
    return true;
  },
```

**Importante:** NO tocar `orderToRow` (no debe incluir columnas de pago — ver comentario de arriba). `getOrders` sí las lee; el round-trip del admin no las pisa porque el upsert no las manda.

- [ ] **Step 4: `App.tsx` — store.** El `addOrder` del store devuelve la promesa del insert (el camino WhatsApp la ignora, igual que hoy):

En el tipo del contexto (línea ~227): `addOrder: (o: Order) => Promise<boolean>;`

```ts
  // Alta de pedido desde el checkout (anónimo): insert plano, no upsert.
  // Devuelve la promesa del insert: el flujo MP la espera, WhatsApp no.
  const addOrder = useCallback((order: Order) => {
    _setOrders(prev => {
      const next = [...prev, order];
      StorageService.setOrders(next);
      return next;
    });
    return SupabaseService.addOrder(order);
  }, []);
```

(Chequear con grep si `addOrder` se usa en `AdminOrderModal`/bot flows — el único otro consumidor es el modal del admin en la pestaña Pedidos, que ignora el retorno: sigue compilando sin cambios.)

- [ ] **Step 5: Gate** — `npm test` y `npm run build`: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/services/supabaseService.ts src/App.tsx
git commit -m "feat: campos de pago MP en Order + addOrder awaitable sin pisar al webhook"
```

---

### Task 5: CheckoutPage — botón "Pagar con Mercado Pago"

**Files:**
- Modify: `src/App.tsx` — `CheckoutPage` (línea ~2381: estados, handler y botones)

- [ ] **Step 1: Estados nuevos + detección de disponibilidad.** Dentro de `CheckoutPage`, después de `const [success, setSuccess] = useState(false);`:

```tsx
  // El botón de MP aparece solo si el server dice que hay credenciales
  // cargadas. En dev local (Vite, sin /api) el fetch falla y queda oculto.
  const [mpDisponible, setMpDisponible] = useState(false);
  const [pagandoMP, setPagandoMP] = useState(false);
  useEffect(() => {
    fetch('/api/mp/disponible')
      .then(r => r.json())
      .then(d => setMpDisponible(Boolean(d?.disponible)))
      .catch(() => setMpDisponible(false));
  }, []);
```

- [ ] **Step 2: Extraer la construcción del pedido** (DRY con el camino WhatsApp). Reemplazar el comienzo de `handleSubmitWhatsApp` (chequeo de stock + armado de `order`) por un helper compartido dentro del componente:

```tsx
  // Chequeo de stock + armado del pedido, compartido por ambos caminos de pago.
  const construirPedido = (): Order | null => {
    const shortItem = cart.find(i => {
      const key = i.selectedColor ? `${i.selectedSize}|${i.selectedColor}` : i.selectedSize;
      return (i.product.stockBySize[key] || 0) < i.quantity;
    });
    if (shortItem) {
      toast.error(`No queda stock suficiente de ${shortItem.product.name} — ajustá la cantidad en el carrito.`);
      return null;
    }
    return {
      id: `VO-${Date.now().toString(36).toUpperCase()}`,
      items: cart,
      customer,
      total,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  };
```

`handleSubmitWhatsApp` queda igual que hoy pero arrancando con:

```tsx
  const handleSubmitWhatsApp = (e: React.FormEvent) => {
    e.preventDefault();
    const order = construirPedido();
    if (!order) return;
    addOrder(order); // fire-and-forget, como siempre en este camino
    // ... (armado del mensaje y window.open IGUAL que hoy, usando order.id en Ref)
```

(El resto del cuerpo no cambia; solo reemplazar `orderId` por `order.id` en el template del mensaje.)

- [ ] **Step 3: El camino MP.** Agregar el handler:

```tsx
  const pagarConMP = async () => {
    const order = construirPedido();
    if (!order) return;
    order.paymentStatus = 'iniciado';
    order.paymentProvider = 'mp';
    setPagandoMP(true);
    try {
      // Sin el pedido en la DB no hay preferencia: la función lo relee de ahí.
      const inserto = await addOrder(order);
      if (!inserto) throw new Error('No pudimos registrar el pedido (¿problemas de conexión?)');
      const resp = await fetch('/api/mp/preferencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.initPoint) throw new Error(data.error || 'No se pudo iniciar el pago');
      // OJO: el carrito NO se vacía acá. Se vacía en /pago/resultado si el
      // pago salió aprobado/pendiente; si el cliente abandona o MP rechaza,
      // el carrito lo espera intacto.
      window.location.href = data.initPoint;
    } catch (err) {
      toast.error(`${err instanceof Error ? err.message : 'Error al iniciar el pago'} — también podés coordinar por WhatsApp.`);
      setPagandoMP(false);
    }
  };
```

- [ ] **Step 4: Los botones.** Reemplazar el botón submit único (línea ~2616) por el par (MP primero si está disponible, WhatsApp siempre):

```tsx
            {mpDisponible && (
              <button
                type="button"
                onClick={() => {
                  const form = document.querySelector<HTMLFormElement>('form');
                  if (form && !form.reportValidity()) return; // valida los required
                  pagarConMP();
                }}
                disabled={pagandoMP}
                className="w-full bg-[#009EE3] hover:bg-[#0088c9] disabled:opacity-60 text-white font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <CreditCard size={20} /> {pagandoMP ? 'Conectando con Mercado Pago…' : 'Pagar online con Mercado Pago'}
              </button>
            )}
            <button
              type="submit"
              disabled={pagandoMP}
              className="pulse-glow w-full bg-lime-400 hover:bg-lime-500 disabled:opacity-60 text-navy-700 font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <MessageCircle size={20} /> {mpDisponible ? 'O coordinar por WhatsApp' : 'Enviar pedido por WhatsApp'}
            </button>
```

`CreditCard` ya se importa de `lucide-react` en App.tsx (verificar con grep; si no está, sumarlo al import existente).

**Nota anti-frágil:** el `document.querySelector('form')` alcanza porque `CheckoutPage` tiene un único form; si molesta, usar un `ref` al form (`const formRef = useRef<HTMLFormElement>(null)` + `<form ref={formRef} ...>` + `formRef.current?.reportValidity()`). Preferir el ref.

- [ ] **Step 5: Texto del panel "Compra coordinada por WhatsApp"** (línea ~2521): si `mpDisponible`, el título pasa a "Pagá online o coordiná por WhatsApp" y el párrafo a:

```
Podés pagar ahora con Mercado Pago (tarjeta, débito o dinero en cuenta) o
mandarnos el pedido por WhatsApp y coordinar transferencia o efectivo.
Como prefieras.
```

Si no está disponible, queda el texto actual tal cual.

- [ ] **Step 6: Gate** — `npm test` y `npm run build`: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: boton Pagar con Mercado Pago en el checkout (opcional junto a WhatsApp)"
```

---

### Task 6: Página `/#/pago/resultado`

**Files:**
- Create: `src/pago/ResultadoPagoPage.tsx`
- Modify: `src/App.tsx` (lazy import junto a los otros ~línea 57-65, ruta en `<Routes>` ~línea 4756)

- [ ] **Step 1: Crear `src/pago/ResultadoPagoPage.tsx`**:

```tsx
// Aterrizaje de la vuelta de Mercado Pago (via /api/mp/retorno → 302 acá).
// El estado que muestra es informativo (viene por query param); la fuente de
// verdad del pago la escribe el webhook en orders.
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Clock, MessageCircle, XCircle } from 'lucide-react';
import { useStore } from '../App';
import { WHATSAPP_NUMBER } from '../constants';
import { usePageMeta } from '../hooks/usePageMeta';

export default function ResultadoPagoPage() {
  const [params] = useSearchParams();
  const estado = params.get('estado') || 'desconocido';
  const pedido = params.get('pedido') || '';
  const { clearCart } = useStore();
  usePageMeta({ title: 'Resultado del pago', description: 'Resultado de tu pago con Mercado Pago.' });

  // El carrito recién se vacía cuando el pago salió bien (o quedó en proceso).
  // Si fue rechazado, el cliente vuelve al checkout con todo como estaba.
  const pagoOk = estado === 'aprobado' || estado === 'pendiente';
  useEffect(() => {
    if (pagoOk) clearCart();
  }, [pagoOk, clearCart]);

  const msgWhatsApp = encodeURIComponent(
    `¡Hola! Acabo de pagar el pedido ${pedido} con Mercado Pago. ¿Coordinamos la entrega?`,
  );

  if (estado === 'aprobado') {
    return (
      <div className="fade-in max-w-7xl mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <Check size={40} className="text-green-500" />
        </div>
        <h1 className="font-display text-3xl font-bold text-navy-700 mb-4">¡Pago recibido!</h1>
        <p className="text-gray-500 mb-2 max-w-md mx-auto">
          Tu pedido {pedido && <strong>{pedido}</strong>} quedó pago con Mercado Pago.
        </p>
        <p className="text-gray-500 mb-8 max-w-md mx-auto">
          Escribinos por WhatsApp para coordinar la entrega — o esperanos, que te escribimos nosotros.
        </p>
        <a
          href={`https://wa.me/${WHATSAPP_NUMBER}?text=${msgWhatsApp}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors"
        >
          <MessageCircle size={20} /> Coordinar entrega por WhatsApp
        </a>
      </div>
    );
  }

  if (estado === 'pendiente') {
    return (
      <div className="fade-in max-w-7xl mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <Clock size={40} className="text-yellow-500" />
        </div>
        <h1 className="font-display text-3xl font-bold text-navy-700 mb-4">Pago en proceso</h1>
        <p className="text-gray-500 mb-8 max-w-md mx-auto">
          Mercado Pago todavía está procesando tu pago{pedido && <> del pedido <strong>{pedido}</strong></>}.
          Apenas se acredite te contactamos por WhatsApp para coordinar la entrega.
        </p>
        <Link to="/" className="inline-flex items-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors">
          Volver al inicio
        </Link>
      </div>
    );
  }

  // rechazado o desconocido
  return (
    <div className="fade-in max-w-7xl mx-auto px-4 py-20 text-center">
      <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <XCircle size={40} className="text-red-500" />
      </div>
      <h1 className="font-display text-3xl font-bold text-navy-700 mb-4">El pago no se completó</h1>
      <p className="text-gray-500 mb-8 max-w-md mx-auto">
        No te preocupes: tu carrito sigue intacto. Podés intentar de nuevo con
        otro medio de pago o coordinar por WhatsApp como siempre.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link to="/checkout" className="inline-flex items-center justify-center gap-2 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors">
          Reintentar el pago
        </Link>
        <a
          href={`https://wa.me/${WHATSAPP_NUMBER}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 border-2 border-navy-700 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors hover:bg-navy-700 hover:text-white"
        >
          <MessageCircle size={20} /> Coordinar por WhatsApp
        </a>
      </div>
    </div>
  );
}
```

**Antes de escribirlo, verificar con grep** (ajustar imports si difieren):
- `useStore` se exporta desde `App.tsx` (`grep -n "export.*useStore" src/App.tsx`) — si el hook vive en otro módulo, importar de ahí. Si `useStore` NO se exporta desde App (riesgo de import circular), replicar el patrón que use `src/galeria/GaleriaPage.tsx` para acceder al store/clearCart — esa página lazy ya resolvió este mismo problema.
- `usePageMeta` (`grep -rn "usePageMeta" src/hooks/`).

- [ ] **Step 2: Registrar lazy + ruta en `App.tsx`.** Junto a los otros lazy (~línea 65):

```tsx
const ResultadoPagoPageLazy = lazy(() => import('./pago/ResultadoPagoPage'));
```

Copiar el patrón de wrapper `Suspense` que usan `GaleriaRoute`/`RankingRoute` (grep `function GaleriaRoute` para el fallback exacto) y crear `ResultadoPagoRoute` igual. En `<Routes>` (línea ~4756), después de `/checkout`:

```tsx
      <Route path="/pago/resultado" element={<PageTransition><ResultadoPagoRoute /></PageTransition>} />
```

- [ ] **Step 3: Gate** — `npm test` y `npm run build`: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pago/ResultadoPagoPage.tsx src/App.tsx
git commit -m "feat: pagina de resultado del pago MP (aprobado/pendiente/rechazado)"
```

---

### Task 7: Badges de pago en Admin → Pedidos

**Files:**
- Modify: `src/App.tsx` — lista de pedidos del admin (fila línea ~3479, detalle expandido ~3500)

- [ ] **Step 1: Helper de badge** (cerca de `AdminPage`, ~línea 2865):

```tsx
// Badge del estado de pago online de un pedido (null = flujo WhatsApp puro).
function BadgePagoMP({ order }: { order: Order }) {
  if (!order.paymentStatus) return null;
  const cfg: Record<string, { texto: string; clases: string }> = {
    aprobado:  { texto: '💳 Pagado (MP)',  clases: 'bg-green-100 text-green-700' },
    pendiente: { texto: 'MP en proceso',   clases: 'bg-yellow-100 text-yellow-700' },
    iniciado:  { texto: 'MP sin terminar', clases: 'bg-gray-100 text-gray-500' },
    rechazado: { texto: 'MP rechazado',    clases: 'bg-red-100 text-red-600' },
    devuelto:  { texto: 'MP devuelto',     clases: 'bg-orange-100 text-orange-600' },
  };
  const c = cfg[order.paymentStatus];
  if (!c) return null;
  return (
    <span className={`text-xs font-semibold rounded-full px-2 py-1 whitespace-nowrap ${c.clases}`}>
      {c.texto}
    </span>
  );
}
```

- [ ] **Step 2: Usarlo en la fila** — en el `div` de acciones de cada pedido (línea ~3479, `flex items-center gap-3 md:gap-6`), antes del `<select>` de estado:

```tsx
                          <BadgePagoMP order={order} />
```

- [ ] **Step 3: Detalle expandido** — en la sección expandida (después del bloque "Cliente", ~línea 3510), si hay pago, mostrar la ficha:

```tsx
                            {order.paymentStatus && (
                              <div>
                                <h4 className="font-display font-semibold text-navy-700 mb-2">Pago online</h4>
                                <div className="space-y-1 text-sm text-gray-600">
                                  <p><strong>Estado:</strong> <BadgePagoMP order={order} /></p>
                                  {order.mpPaymentId && <p><strong>ID de pago MP:</strong> {order.mpPaymentId}</p>}
                                  {order.paidAt && <p><strong>Pagado:</strong> {new Date(order.paidAt).toLocaleString('es-UY')}</p>}
                                  {order.paidAmount != null && <p><strong>Monto acreditado:</strong> {formatPrice(order.paidAmount)}</p>}
                                </div>
                              </div>
                            )}
```

(Encajarlo dentro del grid existente `grid md:grid-cols-2 gap-6` como celda extra.)

- [ ] **Step 4: Gate** — `npm test` y `npm run build`: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: estado de pago MP visible en Admin > Pedidos"
```

---

### Task 8: Guía `docs/MERCADOPAGO.md` para Brian

**Files:**
- Create: `docs/MERCADOPAGO.md`

- [ ] **Step 1: Escribir la guía** con este contenido (ajustar si el flujo del panel de MP cambió — verificar contra la doc oficial de MP con context7/WebSearch al ejecutar):

```markdown
# Mercado Pago en la web VOLEA — guía de puesta en marcha

La web ya tiene todo el código listo. El botón "Pagar online con Mercado Pago"
del checkout aparece SOLO cuando estas credenciales estén cargadas en Vercel.
Hasta entonces, la web funciona igual que siempre (pedidos por WhatsApp).

## 1. Conseguir las credenciales (una sola vez, ~10 min)

1. Entrá a https://www.mercadopago.com.uy/developers → "Tus integraciones",
   **con la MISMA cuenta con la que cobran con el QR** (el checkout online
   deposita en esa misma cuenta).
2. "Crear aplicación": nombre `volea-web`, producto **CheckoutPro** (pagos
   online). Los demás campos, como vengan.
3. Dentro de la aplicación → **Credenciales de prueba**: copiá el
   **Access Token de prueba** (empieza con `TEST-`).
4. Ahí mismo → **Webhooks / Notificaciones**: configurá la URL
   `https://volea.vercel.app/api/mp/webhook`, evento **Pagos**, y copiá la
   **clave secreta** que te muestra.

## 2. Cargar en Vercel (proyecto `volea` → Settings → Environment Variables)

| Variable | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | el Access Token (primero el de PRUEBA `TEST-...`) |
| `MP_WEBHOOK_SECRET` | la clave secreta del webhook |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase volea-web → Settings → API → `service_role` |
| `BASE_URL` | `https://volea.vercel.app` |

Después de cargarlas: **Redeploy** (Deployments → ⋯ → Redeploy).

## 3. Probar en sandbox (sin plata real)

Con el Access Token de PRUEBA cargado:
1. Abrí la web, armá un carrito y elegí "Pagar online con Mercado Pago".
2. Pagá con una tarjeta de prueba (Developers → Credenciales de prueba →
   "Tarjetas de prueba"; ej. Mastercard 5031 7557 3453 0604, CVV 123,
   vencimiento futuro, nombre `APRO` para que apruebe).
3. Verificá: la vuelta cae en "¡Pago recibido!", y en el admin el pedido
   aparece con el badge "💳 Pagado (MP)".
4. Probá también un rechazo (nombre del titular `OTHE`): la vuelta debe decir
   "El pago no se completó" y el carrito seguir lleno.

## 4. Pasar a producción

Cuando el sandbox ande: reemplazá `MP_ACCESS_TOKEN` por el **Access Token de
producción** (empieza con `APP_USR-`) y redeploy. Nada más.

⚠️ La comisión de MP en Uruguay ronda 5-6% por venta. La opción WhatsApp +
transferencia sigue estando para quien quiera evitarla.
```

- [ ] **Step 2: Commit**

```bash
git add docs/MERCADOPAGO.md
git commit -m "docs: guia de credenciales y puesta en marcha de Mercado Pago"
```

---

### Task 9: Verificación final de la sesión

- [ ] **Step 1:** `npm test` — PASS completo (suite vieja + helpers MP).
- [ ] **Step 2:** `npm run build` — PASS.
- [ ] **Step 3:** Smoke local del frontend: `npm run dev` + abrir `http://localhost:3001/#/checkout` con un item en el carrito → el botón MP NO aparece (no hay /api en dev), el flujo WhatsApp funciona igual que siempre. Abrir `http://localhost:3001/#/pago/resultado?estado=aprobado&pedido=VO-TEST` → se ve la pantalla de éxito (y el carrito se vacía). Verificar también `estado=rechazado`.
- [ ] **Step 4:** Revisar `git log --oneline` — un commit por task, mensajes claros.
- [ ] **Step 5:** Push a master (deploy automático de Vercel). Sin credenciales cargadas el deploy es inocuo: `/api/mp/disponible` responde `{disponible:false}` y la web queda idéntica para el público.
- [ ] **Step 6:** E2E sandbox: BLOQUEADO hasta que Brian cargue credenciales (guía en `docs/MERCADOPAGO.md`). Dejarlo anotado como pendiente en la memoria del proyecto.
```
