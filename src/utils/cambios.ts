// Cambios de prendas: una vuelve al stock, otra sale, y la diferencia de plata se resuelve
// en el momento (paga, debe, se le devuelve, queda a favor o va sin cargo).

export type MetodoCambio = 'efectivo' | 'transferencia' | 'mp' | 'debe' | 'a_favor' | 'sin_cargo';

export interface Cambio {
  id: string;
  createdAt: string;
  cliente: string;
  orderId: string | null;
  devuelveNombre: string;
  devuelveVariant: string | null;
  devuelvePrecio: number;
  llevaNombre: string;
  llevaVariant: string | null;
  llevaPrecio: number;
  /** + lo paga el cliente; − es plata del cliente (devuelta o a favor); 0 sin cargo. */
  monto: number;
  metodo: MetodoCambio;
  nota: string | null;
  reportedBy: string;
  saldoUsadoEl: string | null;
}

export interface CambioInput {
  cliente: string;
  orderId: string | null;
  devuelveProductId: string;
  devuelveVariant: string;
  llevaProductId: string;
  llevaVariant: string;
  monto: number;
  metodo: MetodoCambio;
  nota: string;
}

/** Lo que tendría que poner el cliente: precio de la nueva menos la que devuelve. */
export const diferenciaSugerida = (precioDevuelve: number, precioLleva: number) =>
  Math.round((precioLleva || 0) - (precioDevuelve || 0));

/** Formas de resolver la diferencia según quién le debe a quién. */
export function metodosPara(monto: number): { valor: MetodoCambio; texto: string }[] {
  if (monto > 0) {
    return [
      { valor: 'efectivo', texto: 'Paga en efectivo' },
      { valor: 'transferencia', texto: 'Paga por transferencia' },
      { valor: 'mp', texto: 'Paga por Mercado Pago' },
      { valor: 'debe', texto: 'Queda debiendo' },
    ];
  }
  if (monto < 0) {
    return [
      { valor: 'a_favor', texto: 'Queda a favor' },
      { valor: 'efectivo', texto: 'Le devuelvo en efectivo' },
      { valor: 'transferencia', texto: 'Le devuelvo por transferencia' },
    ];
  }
  return [{ valor: 'sin_cargo', texto: 'Sin cargo' }];
}

/** El método elegido sigue valiendo para el monto nuevo; si no, el primero que corresponda. */
export function metodoValido(monto: number, actual: MetodoCambio | null): MetodoCambio {
  const ops = metodosPara(monto);
  return actual && ops.some((o) => o.valor === actual) ? actual : ops[0].valor;
}

/** Texto corto de cómo quedó la plata, para la lista. */
export function resumenPlata(c: Pick<Cambio, 'monto' | 'metodo' | 'saldoUsadoEl'>): string {
  const plata = (n: number) => `$ ${Math.abs(n).toLocaleString('es-UY')}`;
  if (c.metodo === 'sin_cargo' || c.monto === 0) return 'Sin cargo';
  if (c.metodo === 'a_favor') return `${plata(c.monto)} a favor${c.saldoUsadoEl ? ' (ya lo usó)' : ''}`;
  if (c.monto < 0) return `Se le devolvió ${plata(c.monto)} (${c.metodo === 'efectivo' ? 'efectivo' : c.metodo === 'mp' ? 'Mercado Pago' : 'transferencia'})`;
  if (c.metodo === 'debe') return `Debe ${plata(c.monto)}`;
  return `Pagó ${plata(c.monto)} (${c.metodo === 'efectivo' ? 'efectivo' : c.metodo === 'mp' ? 'Mercado Pago' : 'transferencia'})`;
}

/** Saldos a favor sin usar, agrupados por cliente. */
export function saldosAFavor(cambios: Cambio[]): { cliente: string; total: number; cambios: Cambio[] }[] {
  const por = new Map<string, Cambio[]>();
  for (const c of cambios) {
    if (c.metodo !== 'a_favor' || c.saldoUsadoEl || c.monto >= 0) continue;
    por.set(c.cliente, [...(por.get(c.cliente) ?? []), c]);
  }
  return [...por.entries()]
    .map(([cliente, cs]) => ({ cliente, cambios: cs, total: cs.reduce((s, c) => s - c.monto, 0) }))
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
}

/** Todas las variantes de un producto (las con 0 también: una prenda puede volver a un talle agotado). */
export function variantesDe(stockBySize: Record<string, number> | undefined): { key: string; stock: number }[] {
  return Object.entries(stockBySize ?? {}).map(([key, v]) => ({ key, stock: Math.max(0, Math.floor(Number(v)) || 0) }));
}
