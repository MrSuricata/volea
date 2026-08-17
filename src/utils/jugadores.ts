// Ficha del jugador: qué compró, qué debe y qué nombres de deudor todavía no
// están vinculados al padrón. Puro y testeable; la UI solo muestra.

import type { LedgerEntry } from '../types';
import type { JugadorPadron } from './dupr';
import { normalizar } from './nombres';

export interface HistorialJugador {
  movimientos: LedgerEntry[];
  /** Suma de todas sus compras (fiadas o pagas), sin las anuladas. */
  totalComprado: number;
  /** Fiados sin cobrar. */
  deudaAbierta: number;
}

/**
 * Movimientos de un jugador: los vinculados por `jugadorId` MÁS los viejos que
 * solo tienen `debtorName` con su nombre o alias (normalizado, sin tildes), así
 * la ficha sirve aunque todavía no se haya corrido la vinculación.
 */
export function historialDeJugador(jugador: JugadorPadron, ledger: LedgerEntry[]): HistorialJugador {
  const nombres = new Set([jugador.nombre, ...jugador.alias].map(normalizar));
  const movimientos = ledger
    .filter(e => e.kind === 'venta' && !e.reverted)
    .filter(e => e.jugadorId === jugador.id || (!!e.debtorName && nombres.has(normalizar(e.debtorName))))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  let totalComprado = 0;
  let deudaAbierta = 0;
  for (const m of movimientos) {
    totalComprado += m.amount;
    if (m.paymentMethod === 'debe' && !m.settledAt) deudaAbierta += m.amount;
  }
  return { movimientos, totalComprado, deudaAbierta };
}

export interface NombreSinVincular {
  nombre: string;
  movimientos: number;
  /** Lo que sigue debiendo con ese nombre. */
  saldo: number;
  desde: string;
}

/**
 * Nombres de deudor que todavía no apuntan a nadie del padrón, agrupados por
 * nombre EXACTO (que es como agrupa la Caja hoy). `ignorados` son los que Brian
 * marcó como "no es un jugador" (MADRE MATIAS, pickleball city…).
 */
export function nombresSinVincular(ledger: LedgerEntry[], ignorados: string[]): NombreSinVincular[] {
  const fuera = new Set(ignorados.map(normalizar));
  const porNombre = new Map<string, NombreSinVincular>();
  for (const e of ledger) {
    if (e.kind !== 'venta' || e.reverted || e.jugadorId) continue;
    const nombre = (e.debtorName || '').trim();
    if (nombre === '' || fuera.has(normalizar(nombre))) continue;
    const previo = porNombre.get(nombre) ?? { nombre, movimientos: 0, saldo: 0, desde: e.createdAt };
    previo.movimientos++;
    if (e.paymentMethod === 'debe' && !e.settledAt) previo.saldo += e.amount;
    if (e.createdAt < previo.desde) previo.desde = e.createdAt;
    porNombre.set(nombre, previo);
  }
  return [...porNombre.values()].sort((a, b) => b.saldo - a.saldo || b.movimientos - a.movimientos);
}
