import type { SocioMove } from '../types';

const MES_NUM: Record<string, number> = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
  JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
};

/**
 * Cuota de gasto que vence después del mes actual: no cuenta en el saldo
 * "al día de hoy", solo en el "total comprometido". Los períodos con nombre de
 * mes son del año 2026 (series del Excel histórico); los movimientos nuevos y
 * las cuotas de 2027 llevan fecha real.
 */
export function esCuotaFutura(m: SocioMove, hoy: Date = new Date()): boolean {
  if (m.tipo !== 'gasto') return false;
  const actual = hoy.getFullYear() * 100 + (hoy.getMonth() + 1);
  if (m.fecha) {
    const [y, mes] = m.fecha.split('-').map(Number);
    if (!y || !mes) return false;
    return y * 100 + mes > actual;
  }
  const mes = MES_NUM[(m.periodo || '').trim().toUpperCase()];
  if (!mes) return false; // etiquetas de evento (MIXTO B PCITY, etc.): ya ocurrieron
  return 202600 + mes > actual;
}
