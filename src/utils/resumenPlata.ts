// Resumen de la plata de VOLEA (Admin › Plata › Resumen): junta en una sola foto lo que está
// repartido entre la Caja, los fiados, lo que falta pagar, las cuentas entre socios y las
// liquidaciones de torneos. Lógica pura; la pantalla (admin/tabs/PlataResumenTab) solo dibuja.
import type { GastoPendiente, LedgerEntry, SocioMove, SocioName, Tenedor } from '../types';
import { diaMvd, estadisticasCaja, rangoDePeriodo } from './cajaReporte';
import { calcularLiquidacion, type LiquidacionTorneo } from './liquidacionTorneo';
import { esCuotaFutura, SOCIOS } from './socios';

const r2 = (n: number) => Math.round(n * 100) / 100;

export type ResumenPlata = {
  /** Lo que va del mes en la Caja. */
  mes: { ventas: number; gastos: number; balance: number; movimientos: number };
  /** Fiados sin cobrar, de siempre. */
  porCobrar: { total: number; personas: number; items: number; desde: string | null; mayores: { nombre: string; total: number }[] };
  /** Gastos anotados que todavía no se pagaron. */
  porPagar: { total: number; n: number; vencidos: number; proximo: { label: string; venceEl: string; amount: number } | null };
  /** Ventas y gastos de la Caja que todavía no pasaron a las cuentas entre socios. */
  sinLiquidar: { ventas: number; gastos: number; n: number; desde: string | null; gastosPor: { quien: Tenedor | null; monto: number }[] };
  /** Saldos entre socios al día de hoy, en pesos: + le debe al grupo · − el grupo le debe. */
  socios: { nombre: SocioName; saldo: number }[];
  /** Una fila por campeonato liquidado. */
  torneos: { id: string; nombre: string; saldoClub: number; porCobrar: number; netoVolea: number; club: string }[];
};

export function resumenPlata(
  ledger: LedgerEntry[],
  pendientes: GastoPendiente[],
  socioMoves: SocioMove[],
  liquidaciones: { id: string; liq: LiquidacionTorneo }[],
  hoy: string,
  ahora: Date = new Date(),
): ResumenPlata {
  const delMes = estadisticasCaja(ledger, rangoDePeriodo('mes', hoy));

  const deudores = new Map<string, number>();
  let cobrarTotal = 0; let cobrarItems = 0; let cobrarDesde: string | null = null;
  const sinLiquidar = { ventas: 0, gastos: 0, n: 0, desde: null as string | null };
  const gastosPor = new Map<Tenedor | null, number>();
  for (const e of ledger) {
    if (e.reverted) continue;
    const dia = diaMvd(e.createdAt) || null;
    if (e.kind === 'venta' && e.paymentMethod === 'debe' && !e.settledAt) {
      const nombre = e.debtorName || 'Sin nombre';
      deudores.set(nombre, (deudores.get(nombre) ?? 0) + e.amount);
      cobrarTotal += e.amount; cobrarItems += 1;
      if (dia && (!cobrarDesde || dia < cobrarDesde)) cobrarDesde = dia;
    }
    if (!e.socioSettledAt) {
      sinLiquidar.n += 1;
      if (dia && (!sinLiquidar.desde || dia < sinLiquidar.desde)) sinLiquidar.desde = dia;
      if (e.kind === 'venta') sinLiquidar.ventas += e.amount;
      else { sinLiquidar.gastos += e.amount; gastosPor.set(e.paidBy, (gastosPor.get(e.paidBy) ?? 0) + e.amount); }
    }
  }

  const abiertos = pendientes.filter((g) => g.pagadoAt === null);
  const conFecha = abiertos.filter((g) => g.venceEl).sort((a, b) => (a.venceEl as string).localeCompare(b.venceEl as string));

  const saldos: Record<SocioName, number> = { brian: 0, paula: 0, gaston: 0 };
  for (const m of socioMoves) {
    if (m.moneda !== 'UYU' || esCuotaFutura(m, ahora)) continue;
    saldos.brian += m.impBrian; saldos.paula += m.impPaula; saldos.gaston += m.impGaston;
  }

  return {
    mes: { ventas: delMes.ventas, gastos: delMes.gastos, balance: delMes.balance, movimientos: delMes.nVentas + delMes.nGastos },
    porCobrar: {
      total: r2(cobrarTotal), personas: deudores.size, items: cobrarItems, desde: cobrarDesde,
      mayores: Array.from(deudores, ([nombre, total]) => ({ nombre, total: r2(total) })).sort((a, b) => b.total - a.total).slice(0, 3),
    },
    porPagar: {
      total: r2(abiertos.reduce((t, g) => t + g.amount, 0)), n: abiertos.length,
      vencidos: abiertos.filter((g) => g.venceEl && g.venceEl < hoy).length,
      proximo: conFecha[0] ? { label: conFecha[0].label, venceEl: conFecha[0].venceEl as string, amount: conFecha[0].amount } : null,
    },
    sinLiquidar: {
      ventas: r2(sinLiquidar.ventas), gastos: r2(sinLiquidar.gastos), n: sinLiquidar.n, desde: sinLiquidar.desde,
      gastosPor: Array.from(gastosPor, ([quien, monto]) => ({ quien, monto: r2(monto) })).sort((a, b) => b.monto - a.monto),
    },
    socios: SOCIOS.map((nombre) => ({ nombre, saldo: r2(saldos[nombre]) })),
    torneos: liquidaciones.map(({ id, liq }) => {
      const r = calcularLiquidacion(liq);
      return { id, nombre: liq.nombre, saldoClub: r.saldoClub, porCobrar: r.porCobrar, netoVolea: r.netoVolea, club: liq.acuerdo.club };
    }),
  };
}
