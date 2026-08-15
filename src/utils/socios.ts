import type { SocioMove, SocioName } from '../types';

export const SOCIOS: SocioName[] = ['brian', 'paula', 'gaston'];
export const NOMBRES_SOCIOS: Record<SocioName, string> = { brian: 'Brian', paula: 'Paula', gaston: 'Gastón' };

/**
 * Reparto estándar Brian 50% / Paula 25% / Gastón 25%. Las partes se redondean
 * a centésimos y la de Gastón absorbe el resto para que sumen exacto el monto;
 * al restarle el monto al pagador, los tres impactos cierran en cero.
 */
export function impactosGasto(monto: number, pagador: SocioName) {
  const pB = Math.round(monto * 50) / 100;
  const pP = Math.round(monto * 25) / 100;
  const pG = Math.round((monto - pB - pP) * 100) / 100;
  const imp: Record<SocioName, number> = { brian: pB, paula: pP, gaston: pG };
  imp[pagador] = Math.round((imp[pagador] - monto) * 100) / 100;
  return imp;
}

export function impactosPago(monto: number, de: SocioName, para: SocioName) {
  const imp: Record<SocioName, number> = { brian: 0, paula: 0, gaston: 0 };
  imp[de] = -Math.round(monto * 100) / 100;
  imp[para] = Math.round(monto * 100) / 100;
  return imp;
}

/** Venta cobrada por un socio: les debe a los otros su parte (50/25/25 del total). */
export function impactosVenta(monto: number, cobrador: SocioName) {
  const CUOTA: Record<SocioName, number> = { brian: 0.5, paula: 0.25, gaston: 0.25 };
  const imp: Record<SocioName, number> = { brian: 0, paula: 0, gaston: 0 };
  let debe = 0;
  for (const s of SOCIOS) {
    if (s === cobrador) continue;
    const parte = Math.round(monto * CUOTA[s] * 100) / 100;
    imp[s] = -parte; // queda a favor: el cobrador le debe su parte
    debe += parte;
  }
  imp[cobrador] = Math.round(debe * 100) / 100;
  return imp;
}

export interface Cuota { monto: number; fecha: string }

/**
 * Divide una compra en n cuotas mensuales. La cuota se redondea a centésimos y
 * la ÚLTIMA absorbe la diferencia (la suma da exacto el total). Fechas: mismo
 * día que la primera, con tope de fin de mes (31/8 → 30/9), como la tarjeta.
 * La fecha se inyecta (nada de Date.now() acá adentro): tests deterministas.
 */
export function armarCuotas(total: number, n: number, primeraISO: string): Cuota[] {
  const [y, m, d] = primeraISO.split('-').map(Number);
  const base = Math.round((total / n) * 100) / 100;
  const cuotas: Cuota[] = [];
  for (let i = 0; i < n; i++) {
    const mesIdx = (m - 1) + i;
    const yy = y + Math.floor(mesIdx / 12);
    const mm = (mesIdx % 12) + 1;
    const ultimoDia = new Date(yy, mm, 0).getDate();
    const dd = Math.min(d, ultimoDia);
    cuotas.push({ monto: base, fecha: `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` });
  }
  cuotas[n - 1] = { ...cuotas[n - 1], monto: Math.round((total - base * (n - 1)) * 100) / 100 };
  return cuotas;
}

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
/**
 * Ventas brutas del negocio a partir del libro de socios. Las filas importadas
 * del Excel guardan los REPARTOS (la parte que el que cobró les debe a los
 * otros): se agrupan por venta y se dividen por la fracción repartida (50% si
 * cobró Brian, 75% si cobró Paula o Gastón). Las ventas cargadas desde la web
 * ya guardan el monto bruto directo.
 */
export function ventasBrutasSocios(moves: SocioMove[]): number {
  let total = 0;
  const grupos = new Map<string, { shares: number; f: number }>();
  for (const m of moves) {
    if (m.tipo !== 'venta' || m.moneda !== 'UYU') continue;
    if (m.source.startsWith('excel')) {
      const f = m.para === 'brian' ? 0.5 : 0.75;
      const key = `${m.fecha || ''}|${(m.descripcion || '').trim().toUpperCase()}|${m.para}`;
      const g = grupos.get(key) || { shares: 0, f };
      g.shares += m.monto;
      grupos.set(key, g);
    } else {
      total += m.monto;
    }
  }
  for (const g of grupos.values()) total += g.shares / g.f;
  return total;
}

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
