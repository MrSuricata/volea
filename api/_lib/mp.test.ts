import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  armarItemsPreferencia,
  armarUrlRetorno,
  claveStock,
  columnaInexistente,
  funcionInexistente,
  hoyMontevideo,
  mapearEstadoMP,
  motivoPedidoNoPagable,
  mpConfigurado,
  planificarWebhook,
  precioConPromo,
  problemaImportePago,
  promoVigenteHoy,
  totalItems,
  validarDisponibilidad,
  validarFirmaWebhook,
  VENTANA_PEDIDO_MP_MS,
} from './mp';

describe('promoVigenteHoy', () => {
  const fila = { id: 'promo-racket-roll-2026', percent: 10, starts_on: '2026-08-17', ends_on: '2026-08-20', active: true };

  it('vigente solo dentro de la ventana, inclusive en ambas puntas (igual que el cliente)', () => {
    expect(promoVigenteHoy([fila], '2026-08-16')).toBeNull();
    expect(promoVigenteHoy([fila], '2026-08-17')).toBe(fila);
    expect(promoVigenteHoy([fila], '2026-08-20')).toBe(fila);
    expect(promoVigenteHoy([fila], '2026-08-21')).toBeNull();
  });

  it('inactiva o con percent inválido no aplica', () => {
    expect(promoVigenteHoy([{ ...fila, active: false }], '2026-08-18')).toBeNull();
    expect(promoVigenteHoy([{ ...fila, percent: 0 }], '2026-08-18')).toBeNull();
    expect(promoVigenteHoy([{ ...fila, percent: 100 }], '2026-08-18')).toBeNull();
    expect(promoVigenteHoy([{ ...fila, percent: NaN }], '2026-08-18')).toBeNull();
  });
});

describe('hoyMontevideo', () => {
  it('devuelve el día local aunque UTC ya haya cambiado de fecha', () => {
    expect(hoyMontevideo(new Date('2026-08-18T01:30:00Z'))).toBe('2026-08-17');
  });
});

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
    });
    expect(r.ok).toBe(false);
  });

  // Reintentos de MP: 15 min, 30 min, 6 h, 48 h, 96 h después. Si el reintento
  // conserva el ts original, una ventana corta los rechazaba a todos (401 para
  // siempre) y el pago aprobado no se acreditaba nunca.
  it('acepta un reintento con ts de hace días (sin ventana de tiempo)', () => {
    const ts = 1754400000;
    const r = validarFirmaWebhook({
      xSignature: firmar('12345', 'req-1', ts),
      xRequestId: 'req-1',
      dataId: '12345',
      secreto: SECRETO,
    });
    expect(r.ok).toBe(true);
    // Mismo reintento con ts en milisegundos (MP manda ambos formatos).
    const tsMs = 1754400000000;
    const v1 = createHmac('sha256', SECRETO).update(`id:12345;request-id:req-1;ts:${tsMs};`).digest('hex');
    expect(validarFirmaWebhook({ xSignature: `ts=${tsMs},v1=${v1}`, xRequestId: 'req-1', dataId: '12345', secreto: SECRETO }).ok).toBe(true);
  });

  it('un ts viejo NO habilita reusar la firma con otro pago', () => {
    const ts = 1754400000;
    const r = validarFirmaWebhook({
      xSignature: firmar('12345', 'req-1', ts),
      xRequestId: 'req-1',
      dataId: '99999', // la firma era para el pago 12345
      secreto: SECRETO,
    });
    expect(r.ok).toBe(false);
  });

  it('rechaza un ts que no es un entero', () => {
    const v1 = createHmac('sha256', SECRETO).update('id:12345;request-id:req-1;ts:1e9;').digest('hex');
    expect(validarFirmaWebhook({ xSignature: `ts=1e9,v1=${v1}`, xRequestId: 'req-1', dataId: '12345', secreto: SECRETO }))
      .toEqual({ ok: false, motivo: 'ts no numérico' });
  });

  it('rechaza cabeceras faltantes o malformadas', () => {
    expect(validarFirmaWebhook({ xSignature: undefined, xRequestId: 'r', dataId: '1', secreto: SECRETO }).ok).toBe(false);
    expect(validarFirmaWebhook({ xSignature: 'sin-formato', xRequestId: 'r', dataId: '1', secreto: SECRETO }).ok).toBe(false);
    expect(validarFirmaWebhook({ xSignature: 'ts=1,v1=abc', xRequestId: undefined, dataId: '1', secreto: SECRETO }).ok).toBe(false);
  });

  it('rechaza v1 vacío', () => {
    const ts = 1754400000;
    const r = validarFirmaWebhook({
      xSignature: `ts=${ts},v1=`,
      xRequestId: 'req-1',
      dataId: '12345',
      secreto: SECRETO,
    });
    expect(r.ok).toBe(false);
  });

  it('acepta un data.id alfanumérico en mayúsculas (se compara en minúscula)', () => {
    const ts = 1754400000;
    const manifest = `id:ord01abc;request-id:req-1;ts:${ts};`;
    const v1 = createHmac('sha256', SECRETO).update(manifest).digest('hex');
    const r = validarFirmaWebhook({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: 'req-1',
      dataId: 'ORD01ABC',
      secreto: SECRETO,
    });
    expect(r.ok).toBe(true);
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

  it('con promo aplica el descuento sobre el precio del CATÁLOGO, redondeado por unidad', () => {
    const items = armarItemsPreferencia(
      [
        { product: { id: 'p1', name: 'x', price: 1 } as never, quantity: 2 }, // precio del pedido: ignorado
        { product: { id: 'p2' } as never, quantity: 1 },
      ],
      catalogo,
      10,
    );
    expect(items[0].unit_price).toBe(891); // 990 × 0.9
    expect(items[1].unit_price).toBe(495); // 550 × 0.9
  });

  // ⚠ Valores FIJADOS en espejo con src/utils/promo.test.ts: el carrito muestra
  // estos números y esta capa es la que cobra. Si difieren, se paga distinto de
  // lo que se ve.
  it('paridad de redondeo con el cliente (Math.round por unidad)', () => {
    expect(precioConPromo(1000, 10)).toBe(900);
    expect(precioConPromo(1290, 10)).toBe(1161);
    expect(precioConPromo(995, 10)).toBe(896);   // 895.5 → 896
    expect(precioConPromo(85, 10)).toBe(77);     // 76.5 → 77
    expect(precioConPromo(333, 15)).toBe(283);
  });

  it('un percent absurdo (100 o más) no puede colar una preferencia de $0', () => {
    // armarItemsPreferencia ignora percks fuera de (0,100)…
    const sinDesc = armarItemsPreferencia([{ product: { id: 'p2' } as never, quantity: 1 }], catalogo, 100);
    expect(sinDesc[0].unit_price).toBe(550);
    // …y si un percent válido deja el precio en 0 (precio chico + 99%), corta.
    expect(() =>
      armarItemsPreferencia([{ product: { id: 'p3' } as never, quantity: 1 }], [{ id: 'p3', name: 'Sticker', price: 1 }], 99),
    ).toThrow(/descuento/i);
  });

  it('explota claro si el producto ya no existe en el catálogo', () => {
    expect(() => armarItemsPreferencia([{ product: { id: 'nope' } as never, quantity: 1 }], catalogo))
      .toThrow(/no existe/);
  });

  it('explota ante cantidades inválidas', () => {
    expect(() => armarItemsPreferencia([{ product: { id: 'p1' } as never, quantity: 0 }], catalogo)).toThrow();
    expect(() => armarItemsPreferencia([{ product: { id: 'p1' } as never, quantity: -2 }], catalogo)).toThrow();
  });

  it('explota ante cantidad fraccionaria (no trunca, rechaza)', () => {
    expect(() => armarItemsPreferencia([{ product: { id: 'p1' } as never, quantity: 1.5 }], catalogo)).toThrow();
  });

  it('explota si el pedido no trae items', () => {
    expect(() => armarItemsPreferencia([], catalogo)).toThrow();
  });

  it('explota si el precio del catálogo es inválido (típico: admin dejó 0)', () => {
    const catalogoMalo = [{ id: 'p1', name: 'Remera Classic', price: 0 }];
    expect(() => armarItemsPreferencia([{ product: { id: 'p1' } as never, quantity: 1 }], catalogoMalo))
      .toThrow(/[Pp]recio inválido/);
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

describe('motivoPedidoNoPagable', () => {
  const AHORA = Date.parse('2026-09-23T15:00:00Z');
  // Tal cual lo deja el checkout de MP: addOrder + triggers de la base.
  const pedidoMP = {
    items: [{ product: { id: 'p1' }, quantity: 1, selectedSize: 'M', selectedColor: 'Negro' }],
    payment_status: 'iniciado',
    payment_provider: 'mp',
    source: 'web',
    created_at: '2026-09-23T14:55:00Z',
  };

  it('acepta un pedido web de MP recién creado', () => {
    expect(motivoPedidoNoPagable(pedidoMP, AHORA)).toBeNull();
  });

  it('rechaza un pedido inexistente', () => {
    expect(motivoPedidoNoPagable(null, AHORA)).toBe('no existe');
  });

  it('rechaza pedidos de WhatsApp (no les pone payment_provider mp)', () => {
    expect(motivoPedidoNoPagable({ ...pedidoMP, source: 'whatsapp', payment_provider: null, payment_status: null }, AHORA)).not.toBeNull();
    expect(motivoPedidoNoPagable({ ...pedidoMP, payment_provider: null }, AHORA)).not.toBeNull();
    expect(motivoPedidoNoPagable({ ...pedidoMP, source: 'telegram' }, AHORA)).not.toBeNull();
  });

  it('rechaza un pedido viejo (más de 2 horas): los ids VO- se adivinan', () => {
    const haceDosHoras = new Date(AHORA - VENTANA_PEDIDO_MP_MS).toISOString();
    expect(motivoPedidoNoPagable({ ...pedidoMP, created_at: haceDosHoras }, AHORA)).toBeNull(); // justo en el borde
    const viejo = new Date(AHORA - VENTANA_PEDIDO_MP_MS - 60_000).toISOString();
    expect(motivoPedidoNoPagable({ ...pedidoMP, created_at: viejo }, AHORA)).toMatch(/2 horas/);
  });

  it('rechaza created_at vacío, ilegible o en el futuro', () => {
    expect(motivoPedidoNoPagable({ ...pedidoMP, created_at: null }, AHORA)).not.toBeNull();
    expect(motivoPedidoNoPagable({ ...pedidoMP, created_at: 'ayer' }, AHORA)).not.toBeNull();
    expect(motivoPedidoNoPagable({ ...pedidoMP, created_at: '2026-09-23T16:00:00Z' }, AHORA)).not.toBeNull();
  });

  it('rechaza items que no son un array con datos (antes reventaba con 500)', () => {
    for (const items of [{ length: 1 }, 'x', null, 5, []]) {
      expect(motivoPedidoNoPagable({ ...pedidoMP, items }, AHORA)).toMatch(/items/);
    }
  });

  it('rechaza pedidos pagos, devueltos o con un pago en curso; admite reintentar un rechazado', () => {
    expect(motivoPedidoNoPagable({ ...pedidoMP, payment_status: 'aprobado' }, AHORA)).not.toBeNull();
    expect(motivoPedidoNoPagable({ ...pedidoMP, payment_status: 'devuelto' }, AHORA)).not.toBeNull();
    expect(motivoPedidoNoPagable({ ...pedidoMP, payment_status: 'pendiente' }, AHORA)).not.toBeNull();
    expect(motivoPedidoNoPagable({ ...pedidoMP, payment_status: 'rechazado' }, AHORA)).toBeNull();
    expect(motivoPedidoNoPagable({ ...pedidoMP, payment_status: null }, AHORA)).toBeNull();
  });
});

describe('claveStock', () => {
  it('arma la clave igual que el carrito: "talle|color", o solo el talle si no hay color', () => {
    expect(claveStock({ selectedSize: 'M', selectedColor: 'Negro' })).toBe('M|Negro');
    expect(claveStock({ selectedSize: 'Único', selectedColor: '' })).toBe('Único');
    expect(claveStock({ selectedSize: 'Único' })).toBe('Único');
  });
});

describe('validarDisponibilidad', () => {
  const catalogo = [
    { id: 'p1', name: 'Remera Classic', price: 990, active: true, stock_by_size: { 'M|Fucsia': 2, 'L|Fucsia': 0 } },
    { id: 'p2', name: 'Gorro VOLEA', price: 550, active: false, stock_by_size: { 'Único|Navy': 5 } },
    { id: 'p3', name: 'Visera', price: 450, active: null, stock_by_size: { 'Único': 3 } },
  ];
  const item = (id: string, quantity: number, selectedSize?: string, selectedColor?: string) =>
    ({ product: { id, name: `nombre del cliente ${id}` }, quantity, selectedSize, selectedColor });

  it('deja pasar un pedido con stock (active null cuenta como visible, como en el front)', () => {
    expect(() => validarDisponibilidad([item('p1', 2, 'M', 'Fucsia'), item('p3', 3, 'Único', '')], catalogo)).not.toThrow();
  });

  it('rechaza un producto inactivo (oculto en la tienda) con su nombre del catálogo', () => {
    expect(() => validarDisponibilidad([item('p2', 1, 'Único', 'Navy')], catalogo))
      .toThrow('«Gorro VOLEA» ya no está disponible en la tienda');
  });

  it('rechaza un producto que ya no existe', () => {
    expect(() => validarDisponibilidad([item('borrado', 1, 'M', 'Negro')], catalogo)).toThrow(/ya no está disponible/);
    expect(() => validarDisponibilidad([{ product: { id: 'x' }, quantity: 1 } as never], catalogo))
      .toThrow('Uno de los productos del carrito ya no está disponible');
  });

  it('rechaza una variante que el producto no tiene', () => {
    expect(() => validarDisponibilidad([item('p1', 1, 'XL', 'Fucsia')], catalogo)).toThrow('no viene en XL/Fucsia');
    expect(() => validarDisponibilidad([item('p1', 1, 'M', '')], catalogo)).toThrow('no viene en M.');
  });

  it('rechaza una cantidad mayor al stock (dos compran la última unidad)', () => {
    expect(() => validarDisponibilidad([item('p1', 3, 'M', 'Fucsia')], catalogo)).toThrow(/quedan 2/);
    expect(() => validarDisponibilidad([item('p1', 1, 'L', 'Fucsia')], catalogo)).toThrow(/Ya no queda stock/);
  });

  it('suma renglones repetidos de la misma variante (el pedido lo arma el cliente)', () => {
    expect(() => validarDisponibilidad([item('p1', 1, 'M', 'Fucsia'), item('p1', 2, 'M', 'Fucsia')], catalogo)).toThrow(/quedan 2/);
  });

  it('rechaza cantidades inválidas antes de mirar el stock', () => {
    expect(() => validarDisponibilidad([item('p1', 1.5, 'M', 'Fucsia')], catalogo)).toThrow(/Cantidad inválida/);
    expect(() => validarDisponibilidad([item('p1', NaN, 'M', 'Fucsia')], catalogo)).toThrow(/Cantidad inválida/);
  });

  it('un stock ilegible o negativo cuenta como sin stock', () => {
    const raro = [{ id: 'p9', name: 'Raro', price: 10, stock_by_size: { M: 'muchos', L: -2 } }];
    expect(() => validarDisponibilidad([item('p9', 1, 'M')], raro)).toThrow(/stock/);
    expect(() => validarDisponibilidad([item('p9', 1, 'L')], raro)).toThrow(/stock/);
  });
});

describe('problemaImportePago', () => {
  const pago = { id: 1, status: 'approved', transaction_amount: 1980, currency_id: 'UYU' };

  it('acepta monto y moneda iguales a lo esperado', () => {
    expect(problemaImportePago(pago, { id: 'VO-1', mp_monto_esperado: 1980, total: 1980 })).toBeNull();
    // PostgREST puede devolver numeric como string.
    expect(problemaImportePago(pago, { id: 'VO-1', mp_monto_esperado: '1980' })).toBeNull();
  });

  it('rechaza un monto distinto', () => {
    expect(problemaImportePago({ ...pago, transaction_amount: 10 }, { id: 'VO-1', mp_monto_esperado: 1980 })).toMatch(/monto 10 UYU en vez de 1980/);
  });

  it('rechaza otra moneda aunque el número coincida', () => {
    expect(problemaImportePago({ ...pago, currency_id: 'USD' }, { id: 'VO-1', mp_monto_esperado: 1980 })).toMatch(/moneda USD/);
    expect(problemaImportePago({ ...pago, currency_id: null }, { id: 'VO-1', mp_monto_esperado: 1980 })).toMatch(/moneda/);
  });

  it('mp_monto_esperado manda sobre total (total lo escribe el cliente)', () => {
    expect(problemaImportePago(pago, { id: 'VO-1', mp_monto_esperado: 1980, total: 1 })).toBeNull();
    expect(problemaImportePago({ ...pago, transaction_amount: 1 }, { id: 'VO-1', mp_monto_esperado: 1980, total: 1 })).not.toBeNull();
  });

  it('sin mp_monto_esperado (migración v24 sin aplicar) compara contra total', () => {
    expect(problemaImportePago(pago, { id: 'VO-1', total: 1980 })).toBeNull();
    expect(problemaImportePago(pago, { id: 'VO-1', mp_monto_esperado: null, total: 2000 })).toMatch(/monto/);
  });

  it('sin ningún monto de referencia válido no da por bueno el pago', () => {
    expect(problemaImportePago(pago, { id: 'VO-1', total: 0 })).toMatch(/monto esperado/);
    expect(problemaImportePago(pago, { id: 'VO-1' })).toMatch(/monto esperado/);
    expect(problemaImportePago({ ...pago, transaction_amount: null }, { id: 'VO-1', total: 1980 })).toMatch(/no trae monto/);
  });
});

describe('planificarWebhook', () => {
  const AHORA = '2026-09-23T15:00:00.000Z';
  const pedido = { id: 'VO-1', total: 1980, mp_monto_esperado: 1980, payment_status: 'iniciado', mp_payment_id: null };
  const aprobado = { id: 555, status: 'approved', external_reference: 'VO-1', transaction_amount: 1980, currency_id: 'UYU', date_approved: '2026-09-23T14:59:00Z' };

  it('pago aprobado y correcto: marca aprobado y pide descontar stock', () => {
    expect(planificarWebhook(aprobado, pedido, AHORA)).toEqual({
      patch: { payment_provider: 'mp', mp_payment_id: '555', payment_status: 'aprobado', paid_at: '2026-09-23T14:59:00Z', paid_amount: 1980 },
      soloSiNoCerrado: false,
      descontarStock: true,
      revision: null,
    });
  });

  it('el mismo pago aprobado otra vez (reintento) vuelve a pedir el descuento: la RPC es idempotente', () => {
    const plan = planificarWebhook(aprobado, { ...pedido, payment_status: 'aprobado', mp_payment_id: '555' }, AHORA);
    expect(plan?.patch.payment_status).toBe('aprobado');
    expect(plan?.descontarStock).toBe(true);
  });

  it('monto distinto: NO marca aprobado ni descuenta stock, queda para revisión', () => {
    const plan = planificarWebhook({ ...aprobado, transaction_amount: 100 }, pedido, AHORA)!;
    expect(plan.patch.payment_status).toBe('pendiente');
    expect(plan.patch.paid_amount).toBe(100);
    expect(plan.patch).not.toHaveProperty('paid_at');
    expect(plan.patch.requiere_revision).toMatch(/monto 100 UYU en vez de 1980/);
    expect(plan.revision).toBe(plan.patch.requiere_revision);
    expect(plan.descontarStock).toBe(false);
    expect(plan.soloSiNoCerrado).toBe(true); // no degrada un pedido ya aprobado
  });

  it('moneda distinta: NO marca aprobado, queda para revisión', () => {
    const plan = planificarWebhook({ ...aprobado, currency_id: 'USD' }, pedido, AHORA)!;
    expect(plan.patch.payment_status).toBe('pendiente');
    expect(plan.revision).toMatch(/moneda USD/);
    expect(plan.descontarStock).toBe(false);
  });

  it('otro pago aprobado para un pedido ya pagado: no toca el estado, avisa posible doble cobro', () => {
    const plan = planificarWebhook({ ...aprobado, id: 777 }, { ...pedido, payment_status: 'aprobado', mp_payment_id: '555' }, AHORA)!;
    expect(plan.patch).toEqual({ requiere_revision: expect.stringMatching(/777.*555.*doble cobro/) });
    expect(plan.descontarStock).toBe(false);
  });

  it('un rechazo de otro pago sobre un pedido ya pagado no escribe nada', () => {
    expect(planificarWebhook({ ...aprobado, id: 777, status: 'rejected' }, { ...pedido, payment_status: 'aprobado', mp_payment_id: '555' }, AHORA)).toBeNull();
  });

  it('pendiente y rechazado no pisan un pedido cerrado (filtro en la escritura)', () => {
    expect(planificarWebhook({ ...aprobado, status: 'rejected' }, pedido, AHORA)).toEqual({
      patch: { payment_provider: 'mp', mp_payment_id: '555', payment_status: 'rechazado' },
      soloSiNoCerrado: true,
      descontarStock: false,
      revision: null,
    });
    expect(planificarWebhook({ ...aprobado, status: 'in_process' }, pedido, AHORA)?.soloSiNoCerrado).toBe(true);
  });

  it('devuelto se escribe siempre (no hay estado que proteger de un reembolso)', () => {
    const plan = planificarWebhook({ ...aprobado, status: 'refunded' }, { ...pedido, payment_status: 'aprobado', mp_payment_id: '555' }, AHORA)!;
    expect(plan.patch.payment_status).toBe('devuelto');
    expect(plan.soloSiNoCerrado).toBe(false);
  });

  it('estado desconocido: nada que escribir', () => {
    expect(planificarWebhook({ ...aprobado, status: 'banana' }, pedido, AHORA)).toBeNull();
  });

  it('sin date_approved usa la hora actual', () => {
    expect(planificarWebhook({ ...aprobado, date_approved: null }, pedido, AHORA)?.patch.paid_at).toBe(AHORA);
  });
});

describe('errores de migración pendiente', () => {
  it('columnaInexistente reconoce PGRST204 (body) y 42703 (select)', () => {
    expect(columnaInexistente({ code: 'PGRST204' })).toBe(true);
    expect(columnaInexistente({ code: '42703' })).toBe(true);
    expect(columnaInexistente({ code: '23514' })).toBe(false);
    expect(columnaInexistente(null)).toBe(false);
  });
  it('funcionInexistente reconoce PGRST202 y 42883', () => {
    expect(funcionInexistente({ code: 'PGRST202' })).toBe(true);
    expect(funcionInexistente({ code: '42883' })).toBe(true);
    expect(funcionInexistente({ code: '40001' })).toBe(false);
    expect(funcionInexistente(undefined)).toBe(false);
  });
});

describe('armarUrlRetorno', () => {
  const BASE = 'https://volea.vercel.app';
  it('mapea approved → aprobado con pedido y pago', () => {
    expect(armarUrlRetorno(BASE, { status: 'approved', external_reference: 'VO-ABC', payment_id: '99' }))
      .toBe('https://volea.vercel.app/pago/resultado?estado=aprobado&pedido=VO-ABC&pago=99');
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
    expect(armarUrlRetorno(BASE, {})).toBe('https://volea.vercel.app/pago/resultado?estado=desconocido');
  });

  it('escapa external_reference para que no inyecte params extra', () => {
    const url = armarUrlRetorno(BASE, { status: 'approved', external_reference: 'VO-1&estado=aprobado' });
    const veces = url.match(/estado=/g) || [];
    expect(veces.length).toBe(1);
  });
});

describe('mpConfigurado', () => {
  it('true solo con las tres env vars presentes', () => {
    expect(mpConfigurado({ MP_ACCESS_TOKEN: 'a', MP_WEBHOOK_SECRET: 'b', SUPABASE_SERVICE_ROLE_KEY: 'c' })).toBe(true);
    expect(mpConfigurado({ MP_ACCESS_TOKEN: 'a', MP_WEBHOOK_SECRET: 'b' })).toBe(false);
    expect(mpConfigurado({})).toBe(false);
  });
});
