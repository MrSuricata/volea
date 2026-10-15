import type { SocioName } from '../types';

// Caja VOLEA: la plata física de la caja, que es de los tres socios. Entra el efectivo que se
// liquida a la caja y los aportes; sale lo que se gasta desde la caja, los retiros y los repartos.
// El conteo ajusta el saldo a lo que hay de verdad (guarda la diferencia).

export interface CajaVoleaMov {
  id: string;
  createdAt: string;
  fecha: string;
  tipo: 'venta' | 'gasto' | 'conteo' | 'retiro' | 'aporte' | 'reparto';
  /** Con signo: + entra, − sale. En un conteo, la diferencia contra lo esperado. */
  monto: number;
  descripcion: string;
  socio: SocioName | null;
  /** Solo en conteos: cuánto había de verdad. */
  contado: number | null;
  reportedBy: string;
}

export const saldoCaja = (movs: CajaVoleaMov[]) => Math.round(movs.reduce((t, m) => t + m.monto, 0) * 100) / 100;

/** El último conteo y lo que entró y salió después. */
export function resumenCaja(movs: CajaVoleaMov[]) {
  const orden = [...movs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ultimo = [...orden].reverse().find((m) => m.tipo === 'conteo') ?? null;
  const despues = ultimo ? orden.filter((m) => m.createdAt > ultimo.createdAt) : orden;
  return {
    saldo: saldoCaja(movs),
    ultimoConteo: ultimo,
    entradas: despues.filter((m) => m.monto > 0 && m.tipo !== 'conteo').reduce((t, m) => t + m.monto, 0),
    salidas: -despues.filter((m) => m.monto < 0 && m.tipo !== 'conteo').reduce((t, m) => t + m.monto, 0),
  };
}

/** Reparto 50/25/25 de un monto (Gastón absorbe el redondeo, igual que en socios). */
export function partesReparto(monto: number): Record<SocioName, number> {
  const brian = Math.round(monto * 50) / 100;
  const paula = Math.round(monto * 25) / 100;
  return { brian, paula, gaston: Math.round((monto - brian - paula) * 100) / 100 };
}

export const TEXTO_TIPO: Record<CajaVoleaMov['tipo'], string> = {
  venta: 'Ventas', gasto: 'Gasto', conteo: 'Conteo', retiro: 'Retiro', aporte: 'Aporte', reparto: 'Reparto',
};
