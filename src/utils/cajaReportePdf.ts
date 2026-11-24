// Hoja imprimible del reporte de la Caja para un rango de fechas (se abre en una pestaña y
// se guarda como PDF desde el diálogo de impresión). Mismo formato que la liquidación de
// campeonatos: resumen arriba, tablas después y el detalle de movimientos al final.
import type { LedgerEntry } from '../types';
import { NOMBRES_TENEDOR } from './socios';
import {
  diaLargo, diaMvd, enRango, estadisticasCaja, metodoDe, NOMBRE_METODO, textoRango, variacion,
  type EstadisticasCaja, type RangoDias,
} from './cajaReporte';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const plata = (n: number) => `${n < 0 ? '−' : ''}$ ${Math.abs(n).toLocaleString('es-UY', { maximumFractionDigits: 2 })}`;
const hora = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t - 3 * 60 * 60 * 1000).toISOString().slice(11, 16);
};
const dmy = (ymd: string) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '—');
const TOPE = 15;

export function htmlReporteCaja(entries: LedgerEntry[], rango: RangoDias, anterior: EstadisticasCaja | null): string {
  const s = estadisticasCaja(entries, rango);
  const movimientos = entries.filter((e) => enRango(e.createdAt, rango)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const fila = (celdas: (string | number)[], clase = '') =>
    `<tr class="${clase}">${celdas.map((c, i) => `<td class="${i > 0 ? 'n' : ''}">${typeof c === 'number' ? plata(c) : c}</td>`).join('')}</tr>`;
  const cambio = (ahora: number, antes: number | undefined) => {
    const v = antes === undefined ? null : variacion(ahora, antes);
    return v === null ? '' : `<small>${v >= 0 ? '+' : '−'}${Math.abs(v)} % contra el período anterior</small>`;
  };
  const dato = (rotulo: string, valor: string, detalle = '') =>
    `<div class="dato"><span>${rotulo}</span><b>${valor}</b>${detalle}</div>`;
  const tabla = (titulo: string, cabeza: string[], filas: string[], pie = '') => (filas.length === 0 ? '' : `
    <section><h2>${titulo}</h2>
    <table><thead><tr>${cabeza.map((c, i) => `<th class="${i > 0 ? 'n' : ''}">${c}</th>`).join('')}</tr></thead>
    <tbody>${filas.join('')}${pie}</tbody></table></section>`);
  const resto = <T extends { monto: number }>(lista: T[]) => {
    const otros = lista.slice(TOPE);
    return otros.length ? { n: otros.length, monto: otros.reduce((t, x) => t + x.monto, 0) } : null;
  };

  const restoProd = resto(s.productos);
  const restoGasto = resto(s.gastosPorConcepto);
  const hoy = new Date().toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric' });
  const titulo = textoRango(rango);

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Caja VOLEA · ${esc(titulo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif; color: #111; margin: 0; padding: 28px; font-size: 13px; line-height: 1.4; }
  header { background: #001F3F; color: #fff; padding: 18px 22px; border-radius: 10px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
  header .marca { color: #CCFF00; font-weight: 900; font-size: 22px; letter-spacing: 0.04em; }
  header h1 { margin: 2px 0 0; font-size: 18px; text-transform: uppercase; }
  header .der { text-align: right; font-size: 12px; opacity: 0.85; }
  .datos { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 16px; }
  .dato { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; }
  .dato span { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #555; }
  .dato b { display: block; font-size: 18px; margin-top: 2px; color: #001F3F; }
  .dato small { display: block; margin-top: 2px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
  section { break-inside: avoid; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #001F3F; border-bottom: 2px solid #CCFF00; padding-bottom: 4px; margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; color: #555; padding: 5px 8px; border-bottom: 1px solid #ccc; }
  td { padding: 4px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.total td { font-weight: 800; border-top: 2px solid #001F3F; border-bottom: none; }
  tr.anulado td { color: #999; text-decoration: line-through; }
  small { color: #666; }
  .nota { color: #555; font-size: 12px; margin: 8px 0 0; }
  .imprimir { margin: 0 0 16px; padding: 10px 18px; font-size: 14px; font-weight: 700; background: #001F3F; color: #fff; border: 0; border-radius: 8px; cursor: pointer; }
  @media print { body { padding: 0; } .imprimir { display: none; } header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } thead { display: table-header-group; } }
  @media (max-width: 640px) { .datos, .cols { grid-template-columns: 1fr 1fr; } .cols { grid-template-columns: 1fr; } }
</style></head><body>
<button class="imprimir" onclick="window.print()">Guardar como PDF / Imprimir</button>
<header>
  <div><div class="marca">VOLEA</div><h1>Caja · ${esc(titulo)}</h1></div>
  <div class="der">${s.dias ? `${s.dias} ${s.dias === 1 ? 'día' : 'días'} · ` : ''}${s.nVentas + s.nGastos} movimientos<br>Emitido el ${hoy}</div>
</header>
<div class="datos">
  ${dato('Ventas', plata(s.ventas), cambio(s.ventas, anterior?.ventas))}
  ${dato('Gastos', plata(s.gastos), cambio(s.gastos, anterior?.gastos))}
  ${dato('Balance', plata(s.balance), anterior ? `<small>antes ${plata(anterior.balance)}</small>` : '')}
  ${dato('Ticket promedio', plata(Math.round(s.ticketPromedio)), `<small>${s.nVentas} ventas</small>`)}
  ${dato('Ventas por día', plata(Math.round(s.ventasPorDia)), `<small>${s.diasConVentas} de ${s.dias} días con ventas</small>`)}
  ${dato('Mejor día', s.mejorDia ? plata(s.mejorDia.ventas) : '—', s.mejorDia ? `<small>${esc(diaLargo(s.mejorDia.dia))}</small>` : '')}
  ${dato('Sin liquidar a socios', plata(s.sinLiquidar.ventas - s.sinLiquidar.gastos), `<small>${s.sinLiquidar.n} movimientos</small>`)}
  ${dato('Anulados', String(s.anulados.n), s.anulados.n ? `<small>${plata(s.anulados.monto)} (no cuentan)</small>` : '')}
</div>
<div class="cols">
  ${tabla('Cómo pagaron', ['Método', 'Ventas', 'Monto'], s.porMetodo.map((m) => fila([NOMBRE_METODO[m.metodo], String(m.n), m.monto])), fila(['Total', String(s.nVentas), s.ventas], 'total'))}
  ${tabla('Qué se vendió', ['Tipo', 'Ventas', 'Monto'], [fila(['Productos del catálogo', String(s.catalogo.n), s.catalogo.monto]), fila(['Ítems sueltos', String(s.sueltos.n), s.sueltos.monto])])}
  ${tabla('Gastos: quién puso la plata', ['Quién', 'Gastos', 'Monto'], s.gastosPorPagador.map((g) => fila([g.quien ? NOMBRES_TENEDOR[g.quien] : 'Sin anotar', String(g.n), g.monto])))}
  ${tabla('Quién registró', ['Persona', 'Ventas', 'Gastos'], s.porPersona.map((p) => fila([esc(p.nombre), p.ventas, p.gastos])))}
</div>
${tabla('Lo más vendido', ['Producto', 'Unidades', 'Ventas', 'Monto'],
    s.productos.slice(0, TOPE).map((p) => fila([esc(p.nombre) + (p.catalogo ? '' : ' <small>· suelto</small>'), String(p.unidades), String(p.n), p.monto])),
    restoProd ? fila([`Otros ${restoProd.n}`, '', '', restoProd.monto]) : '')}
${tabla('En qué se gastó', ['Concepto', 'Veces', 'Monto'],
    s.gastosPorConcepto.slice(0, TOPE).map((g) => fila([esc(g.nombre), String(g.n), g.monto])),
    (restoGasto ? fila([`Otros ${restoGasto.n}`, '', restoGasto.monto]) : '') + fila(['Total', String(s.nGastos), s.gastos], 'total'))}
${tabla(s.granularidad === 'dia' ? 'Día por día' : s.granularidad === 'semana' ? 'Semana por semana (desde el lunes)' : 'Mes por mes',
    [s.granularidad === 'dia' ? 'Día' : s.granularidad === 'semana' ? 'Semana del' : 'Mes', 'Ventas', 'Gastos', 'Balance'],
    s.serie.filter((t) => t.ventas || t.gastos).map((t) => fila([t.etiqueta, t.ventas, t.gastos, t.ventas - t.gastos])),
    fila(['Total', s.ventas, s.gastos, s.balance], 'total'))}
${movimientos.length === 0 ? '<p class="nota">No hay movimientos en estas fechas.</p>' : `
<h2>Movimientos (${movimientos.length})</h2>
<table>
  <thead><tr><th>Fecha</th><th>Detalle</th><th>Pago</th><th>Registró</th><th class="n">Monto</th></tr></thead>
  <tbody>
    ${movimientos.map((e) => `<tr class="${e.reverted ? 'anulado' : ''}"><td>${dmy(diaMvd(e.createdAt))} ${hora(e.createdAt)}</td><td>${esc(e.label)}${e.qty > 1 ? ` ×${e.qty}` : ''}${e.variantKey ? ` <small>· ${esc(e.variantKey.split('|').filter(Boolean).join(' · '))}</small>` : ''}${e.reverted ? ' <small>(anulado)</small>' : ''}</td><td>${e.kind === 'venta' ? esc(NOMBRE_METODO[metodoDe(e)]) + (e.debtorName ? ` <small>· ${esc(e.debtorName)}</small>` : '') : e.paidBy ? `pagó ${esc(NOMBRES_TENEDOR[e.paidBy])}` : ''}</td><td>${esc(e.reportedBy)}</td><td class="n">${plata(e.kind === 'venta' ? e.amount : -e.amount)}</td></tr>`).join('')}
  </tbody>
</table>`}
</body></html>`;
}

/** Abre el reporte en una pestaña nueva, listo para "Guardar como PDF". */
export function abrirReporteCaja(entries: LedgerEntry[], rango: RangoDias, anterior: EstadisticasCaja | null): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(htmlReporteCaja(entries, rango, anterior));
  w.document.close();
  return true;
}
