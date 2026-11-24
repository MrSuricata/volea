// Hoja imprimible de una liquidación de campeonato (se abre en una pestaña y se guarda como PDF
// desde el diálogo de impresión). Dos versiones: la del club (solo lo que se reparte con él) y
// la interna (además remeras, lo que falta cobrar, proveedores y el reparto entre socios).
import { baseDeLinea, calcularLiquidacion, montoGasto, type LiquidacionTorneo } from './liquidacionTorneo';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const plata = (n: number) => `${n < 0 ? '−' : ''}$ ${Math.abs(n).toLocaleString('es-UY', { maximumFractionDigits: 2 })}`;
const PAGADOR: Record<string, string> = { volea: 'VOLEA', club: 'El club' };

export function htmlLiquidacion(l: LiquidacionTorneo, para: 'club' | 'interno'): string {
  const r = calcularLiquidacion(l);
  const a = l.acuerdo;
  const club = esc(a.club || 'Club');
  const fila = (celdas: (string | number)[], clase = '') =>
    `<tr class="${clase}">${celdas.map((c, i) => `<td class="${i > 0 ? 'n' : ''}">${typeof c === 'number' ? plata(c) : c}</td>`).join('')}</tr>`;
  const saldoTexto = r.saldoClub >= 0 ? `VOLEA le paga a ${club}` : `${club} le paga a VOLEA`;

  const inscripciones = `
    <h2>Inscripciones</h2>
    <table>
      <thead><tr><th>Jugador</th><th class="n">Inscripción</th><th class="n">Parte que se reparte</th><th class="n">${club} (${a.pctClub} %)</th></tr></thead>
      <tbody>
        ${l.inscripciones.map((i) => {
          const b = baseDeLinea(i, a);
          return fila([esc(i.nombre) + (i.nota ? ` <small>· ${esc(i.nota)}</small>` : ''), i.total, b, Math.round(b * a.pctClub) / 100]);
        }).join('')}
        ${fila([`Total (${r.inscriptos} inscriptos)`, r.totalInscripciones, r.base, r.clubInscripciones], 'total')}
      </tbody>
    </table>
    <p class="nota">De cada inscripción de ${plata(a.precio)}, ${plata(a.baseInscripcion)} son de inscripción y se reparten ${a.pctClub} % ${club} / ${100 - a.pctClub} % VOLEA. El resto corresponde a la remera.</p>`;

  const gastos = l.gastos.length === 0 ? '' : `
    <h2>Gastos y premios compartidos</h2>
    <table>
      <thead><tr><th>Concepto</th><th class="n">Cantidad</th><th class="n">Total</th><th class="n">% ${club}</th><th class="n">${club}</th><th class="n">VOLEA</th><th>Lo pagó</th></tr></thead>
      <tbody>
        ${l.gastos.map((g) => {
          const m = montoGasto(g);
          const c = Math.round(m * g.pctClub) / 100;
          return `<tr><td>${esc(g.concepto)}</td><td class="n">${g.cantidad} × ${plata(g.unitario)}</td><td class="n">${plata(m)}</td><td class="n">${g.pctClub} %</td><td class="n">${plata(c)}</td><td class="n">${plata(m - c)}</td><td>${esc(PAGADOR[g.pagadoPor] ?? (para === 'club' ? 'VOLEA' : g.pagadoPor))}</td></tr>`;
        }).join('')}
        <tr class="total"><td>Total</td><td></td><td class="n">${plata(r.gastos)}</td><td></td><td class="n">${plata(r.clubGastos)}</td><td class="n">${plata(r.voleaGastos)}</td><td></td></tr>
      </tbody>
    </table>`;

  const resultadoClub = `
    <h2>Resultado para ${club}</h2>
    <table class="angosta">
      <tbody>
        ${fila([`${a.pctClub} % de las inscripciones`, r.clubInscripciones])}
        ${fila(['Su parte de gastos y premios', -r.clubGastos])}
        ${fila([`Neto de ${club}`, r.netoClub], 'total')}
        ${(r.gastosPagadosPor.club ?? 0) > 0 ? fila(['Gastos que pagó el club (se le devuelven)', r.gastosPagadosPor.club]) : ''}
        ${a.cobro === 'club' ? fila(['Inscripciones que cobró el club', -r.totalInscripciones]) : ''}
      </tbody>
    </table>
    <div class="saldo">
      <span>${saldoTexto}</span><b>${plata(Math.abs(r.saldoClub))}</b>
    </div>
    ${r.saldoClubPendiente !== 0 ? `<p class="nota">De ese total, ${plata(Math.abs(r.saldoClubPendiente))} corresponden a inscripciones todavía sin cobrar (${plata(r.porCobrar)}). Con lo cobrado hasta hoy: <b>${plata(Math.abs(r.saldoClubAhora))}</b>.</p>` : ''}`;

  const interno = para !== 'interno' ? '' : `
    <h2>Resultado para VOLEA</h2>
    <table class="angosta">
      <tbody>
        ${fila([`${100 - a.pctClub} % de las inscripciones`, r.base - r.clubInscripciones])}
        ${fila(['Remeras y resto de la inscripción (todo VOLEA)', r.remeras])}
        ${fila(['Su parte de gastos y premios', -r.voleaGastos])}
        ${fila(['Neto de VOLEA', r.netoVolea], 'total')}
      </tbody>
    </table>
    <h2>Entre socios</h2>
    <table class="angosta">
      <thead><tr><th>Socio</th><th class="n">Cuota</th><th class="n">Su parte</th><th class="n">Puso de su bolsillo</th><th class="n">Le toca</th></tr></thead>
      <tbody>${r.socios.map((s) => fila([esc(s.nombre), `${s.cuota * 100} %`, s.parte, s.puso, s.recibe])).join('')}</tbody>
    </table>
    ${r.deudores.length ? `<h2>Falta cobrar</h2><table class="angosta"><tbody>${r.deudores.map((d) => fila([esc(d.nombre), d.debe])).join('')}${fila(['Total', r.porCobrar], 'total')}</tbody></table>` : ''}
    ${r.aProveedores.length ? `<h2>Falta pagar a proveedores</h2><table class="angosta"><tbody>${r.aProveedores.map((p) => fila([`${esc(p.proveedor)} · ${esc(p.concepto)}`, p.monto])).join('')}</tbody></table>` : ''}
    ${l.notas ? `<h2>Notas</h2><p>${esc(l.notas)}</p>` : ''}`;

  const hoy = new Date().toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Liquidación ${esc(l.nombre)} · ${para === 'club' ? club : 'VOLEA'}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif; color: #111; margin: 0; padding: 28px; font-size: 13px; line-height: 1.4; }
  header { background: #001F3F; color: #fff; padding: 18px 22px; border-radius: 10px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
  header .marca { color: #CCFF00; font-weight: 900; font-size: 22px; letter-spacing: 0.04em; }
  header h1 { margin: 2px 0 0; font-size: 18px; text-transform: uppercase; }
  header .der { text-align: right; font-size: 12px; opacity: 0.85; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #001F3F; border-bottom: 2px solid #CCFF00; padding-bottom: 4px; margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  table.angosta { max-width: 460px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; color: #555; padding: 5px 8px; border-bottom: 1px solid #ccc; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; }
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.total td { font-weight: 800; border-top: 2px solid #001F3F; border-bottom: none; }
  small { color: #666; }
  .nota { color: #555; font-size: 12px; margin: 8px 0 0; }
  .saldo { margin-top: 14px; background: #001F3F; color: #fff; border-radius: 10px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; max-width: 460px; }
  .saldo b { color: #CCFF00; font-size: 22px; }
  .imprimir { margin: 0 0 16px; padding: 10px 18px; font-size: 14px; font-weight: 700; background: #001F3F; color: #fff; border: 0; border-radius: 8px; cursor: pointer; }
  @media print { body { padding: 0; } .imprimir { display: none; } header, .saldo { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<button class="imprimir" onclick="window.print()">Guardar como PDF / Imprimir</button>
<header>
  <div><div class="marca">VOLEA</div><h1>Liquidación · ${esc(l.nombre)}</h1></div>
  <div class="der">${para === 'club' ? `Para ${club}` : 'Uso interno'}<br>${l.fecha ? `Torneo: ${esc(l.fecha.split('-').reverse().join('/'))} · ` : ''}Emitida el ${hoy}</div>
</header>
${inscripciones}${gastos}${resultadoClub}${interno}
</body></html>`;
}

/** Abre la hoja en una pestaña nueva, lista para "Guardar como PDF". */
export function abrirLiquidacion(l: LiquidacionTorneo, para: 'club' | 'interno'): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(htmlLiquidacion(l, para));
  w.document.close();
  return true;
}
