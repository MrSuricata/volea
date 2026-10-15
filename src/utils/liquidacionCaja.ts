import type { LedgerEntry, SocioName } from '../types';

// Ventas de la caja al liquidar: cada una con QUIÉN TIENE LA PLATA. Antes se elegía un solo
// cobrador por método (todo el efectivo a una persona), y si el efectivo lo habían cobrado
// dos socios distintos no había forma de repartirlo.

const METODO_LBL: Record<string, string> = { mp: 'Mercado Pago', efectivo: 'Efectivo', transferencia: 'Transferencia' };

/**
 * Nombre de quien registró → socio, solo si es claramente una persona. Las cuentas
 * compartidas ("VOLEA Team"), la web y el bot devuelven null: ahí hay que elegir.
 */
export function socioPorNombre(nombre: string | null | undefined): SocioName | null {
  const n = (nombre ?? '').trim().toLowerCase();
  if (n.startsWith('brian')) return 'brian';
  if (n.startsWith('paul')) return 'paula';
  if (n.startsWith('gast')) return 'gaston';
  return null;
}

export interface VentaALiquidar {
  id: string;
  label: string;
  monto: number;
  createdAt: string;
  /** Grupo por cómo entró la plata ("Efectivo", "Fiados cobrados (Efectivo)"…). */
  grupo: string;
  cobrador: SocioName | null;
  /** De dónde salió el cobrador: elegido al cobrar, deducido de quien registró, o falta. */
  origen: 'cobro' | 'registro' | 'falta';
}

export function ventaALiquidar(e: LedgerEntry): VentaALiquidar {
  const fiado = e.paymentMethod === 'debe';
  const grupo = fiado
    ? `Fiados cobrados (${e.settledMethod ? METODO_LBL[e.settledMethod] : '—'})`
    : (e.paymentMethod ? METODO_LBL[e.paymentMethod] : 'Sin método');
  // En ventas, paidBy = quién recibió la plata (lo elige quien cobra la deuda, v33).
  if (e.paidBy) return { id: e.id, label: e.label, monto: e.amount, createdAt: e.createdAt, grupo, cobrador: e.paidBy, origen: 'cobro' };
  // Un fiado lo registra quien vendió, no quien cobró después: no se adivina.
  const porNombre = fiado ? null : socioPorNombre(e.reportedBy);
  return { id: e.id, label: e.label, monto: e.amount, createdAt: e.createdAt, grupo, cobrador: porNombre, origen: porNombre ? 'registro' : 'falta' };
}

/** Un movimiento por grupo y socio: así la cuenta de socios queda legible. */
export function agruparPorCobrador(ventas: VentaALiquidar[]): { grupo: string; cobrador: SocioName; ids: string[]; total: number }[] {
  const m = new Map<string, { grupo: string; cobrador: SocioName; ids: string[]; total: number }>();
  for (const v of ventas) {
    if (!v.cobrador) continue;
    const k = `${v.grupo}|${v.cobrador}`;
    const g = m.get(k) ?? { grupo: v.grupo, cobrador: v.cobrador, ids: [], total: 0 };
    g.ids.push(v.id);
    g.total += v.monto;
    m.set(k, g);
  }
  return [...m.values()];
}
