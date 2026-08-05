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
