// Tests de los handlers de MP con una base y un Mercado Pago falsos: verifican
// el cableado (qué status devuelve cada caso, qué se escribe, a qué se llama),
// que los tests de mp.test.ts no cubren. Vive en _lib/ y no en mp/ a propósito:
// Vercel publica como función todo archivo de api/ salvo los que empiezan con _.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Base falsa ──────────────────────────────────────────────────────────────
interface Consulta {
  tabla: string;
  op: 'select' | 'update';
  cols?: string;
  patch?: Record<string, unknown>;
  filtros: [string, ...unknown[]][];
}
type Resultado = { data?: unknown; error?: { code?: string; message: string } | null };

const base = vi.hoisted(() => ({
  responder: (_c: Consulta): Resultado => ({ data: null, error: null }),
  rpc: (_nombre: string, _args: unknown): Resultado => ({ data: null, error: null }),
  consultas: [] as Consulta[],
  rpcs: [] as { nombre: string; args: unknown }[],
}));

vi.mock('./supabaseAdmin.js', () => ({
  clienteAdmin: () => ({
    from(tabla: string) {
      const c: Consulta = { tabla, op: 'select', filtros: [] };
      const correr = () => {
        base.consultas.push(c);
        return Promise.resolve({ data: null, error: null, ...base.responder(c) });
      };
      const q = {
        select(cols: string) { c.cols = cols; return q; },
        update(patch: Record<string, unknown>) { c.op = 'update'; c.patch = patch; return q; },
        eq(...a: unknown[]) { c.filtros.push(['eq', ...a]); return q; },
        in(...a: unknown[]) { c.filtros.push(['in', ...a]); return q; },
        is(...a: unknown[]) { c.filtros.push(['is', ...a]); return q; },
        not(...a: unknown[]) { c.filtros.push(['not', ...a]); return q; },
        or(...a: unknown[]) { c.filtros.push(['or', ...a]); return q; },
        maybeSingle: correr,
        then(ok: (r: Resultado) => unknown, mal?: (e: unknown) => unknown) { return correr().then(ok, mal); },
      };
      return q;
    },
    rpc(nombre: string, args: unknown) {
      base.rpcs.push({ nombre, args });
      return Promise.resolve({ data: null, error: null, ...base.rpc(nombre, args) });
    },
  }),
}));

import preferencia from '../mp/preferencia.js';

// ── Request/response falsos ─────────────────────────────────────────────────
function respuesta() {
  const r = { codigo: 0, cuerpo: undefined as unknown };
  const res = {
    status(c: number) { r.codigo = c; return res; },
    json(b: unknown) { r.cuerpo = b; return res; },
    end() { return res; },
  };
  return { r, res: res as unknown as VercelResponse };
}
const post = (body: unknown, extra: Partial<VercelRequest> = {}) =>
  ({ method: 'POST', body, query: {}, headers: {}, ...extra }) as unknown as VercelRequest;

const ENV = { MP_ACCESS_TOKEN: 'TEST-token', MP_WEBHOOK_SECRET: 'secreto', SUPABASE_SERVICE_ROLE_KEY: 'srk' };
let fetchMP: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.assign(process.env, ENV);
  base.consultas = [];
  base.rpcs = [];
  fetchMP = vi.fn();
  vi.stubGlobal('fetch', fetchMP);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── /api/mp/preferencia ─────────────────────────────────────────────────────
describe('POST /api/mp/preferencia', () => {
  const hace5min = () => new Date(Date.now() - 5 * 60_000).toISOString();
  const pedidoMP = () => ({
    id: 'VO-ABC123',
    items: [{ product: { id: 'p1', name: 'Remera', price: 1 }, quantity: 2, selectedSize: 'M', selectedColor: 'Negro' }],
    payment_status: 'iniciado',
    payment_provider: 'mp',
    source: 'web',
    created_at: hace5min(),
  });
  const catalogo = [{ id: 'p1', name: 'Remera Classic', price: 990, active: true, stock_by_size: { 'M|Negro': 2 } }];

  const armarBase = (pedido: unknown, cat: unknown = catalogo, promos: unknown[] = [], errUpdate?: (p: Record<string, unknown>) => Resultado['error']) => {
    base.responder = (c) => {
      if (c.tabla === 'orders' && c.op === 'select') return { data: pedido };
      if (c.tabla === 'products') return { data: cat };
      if (c.tabla === 'promos') return { data: promos };
      if (c.tabla === 'orders' && c.op === 'update') return { error: errUpdate?.(c.patch!) ?? null };
      return {};
    };
  };
  const mpOk = () => fetchMP.mockResolvedValue(new Response(JSON.stringify({ id: 'pref-1', init_point: 'https://mp/checkout' }), { status: 200 }));

  it('pedido válido: 200 y precio del catálogo', async () => {
    armarBase(pedidoMP());
    mpOk();
    const { r, res } = respuesta();
    await preferencia(post({ orderId: 'VO-ABC123' }), res);
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toEqual({ initPoint: 'https://mp/checkout' });
    const enviado = JSON.parse(fetchMP.mock.calls[0][1].body);
    expect(enviado.items[0]).toMatchObject({ unit_price: 990, quantity: 2 });
  });

  // Todos los casos "no se puede pagar" responden EXACTAMENTE lo mismo: probar
  // ids no tiene que revelar si un pedido existe o está pago.
  it.each([
    ['inexistente', null],
    ['de WhatsApp', { ...pedidoMP(), source: 'whatsapp', payment_provider: null, payment_status: null }],
    ['viejo (3 horas)', { ...pedidoMP(), created_at: new Date(Date.now() - 3 * 3600_000).toISOString() }],
    ['ya pagado', { ...pedidoMP(), payment_status: 'aprobado' }],
    ['con items no-array', { ...pedidoMP(), items: { length: 1 } }],
    ['con items vacíos', { ...pedidoMP(), items: [] }],
  ])('pedido %s: 404 genérico, sin tocar la base ni MP', async (_caso, pedido) => {
    armarBase(pedido);
    const { r, res } = respuesta();
    await preferencia(post({ orderId: 'VO-ABC123' }), res);
    expect(r.codigo).toBe(404);
    expect(r.cuerpo).toEqual({ error: 'Pedido no encontrado' });
    expect(fetchMP).not.toHaveBeenCalled();
    expect(base.consultas.filter(c => c.op === 'update')).toEqual([]);
  });

  it('un orderId con formato imposible responde el mismo 404 sin ir a la base', async () => {
    const { r, res } = respuesta();
    await preferencia(post({ orderId: 'VO-1;drop table' }), res);
    expect(r.codigo).toBe(404);
    expect(r.cuerpo).toEqual({ error: 'Pedido no encontrado' });
    expect(base.consultas).toEqual([]);
  });

  it.each([
    ['producto inactivo', [{ ...catalogo[0], active: false }], /ya no está disponible/],
    ['producto inexistente', [], /ya no está disponible/],
    ['variante inexistente', [{ ...catalogo[0], stock_by_size: { 'L|Negro': 5 } }], /no viene en M\/Negro/],
    ['sin stock suficiente', [{ ...catalogo[0], stock_by_size: { 'M|Negro': 1 } }], /quedan 1/],
  ])('%s: 400 con mensaje para el cliente y NO se crea la preferencia', async (_caso, cat, mensaje) => {
    armarBase(pedidoMP(), cat);
    const { r, res } = respuesta();
    await preferencia(post({ orderId: 'VO-ABC123' }), res);
    expect(r.codigo).toBe(400);
    expect((r.cuerpo as { error: string }).error).toMatch(mensaje);
    expect(fetchMP).not.toHaveBeenCalled();
  });

  it('el catálogo se lee con active y stock_by_size, y solo con ids string', async () => {
    const pedido = { ...pedidoMP(), items: [...pedidoMP().items, { product: { id: { raro: 1 } }, quantity: 1 }] };
    armarBase(pedido);
    const { res } = respuesta();
    await preferencia(post({ orderId: 'VO-ABC123' }), res);
    const lectura = base.consultas.find(c => c.tabla === 'products')!;
    expect(lectura.cols).toContain('active');
    expect(lectura.cols).toContain('stock_by_size');
    expect(lectura.filtros).toContainEqual(['in', 'id', ['p1']]);
  });
});
