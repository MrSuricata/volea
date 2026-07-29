import type { LedgerEntry, SocioMove, SocioName } from '../types';
import { esCuotaFutura, ventasBrutasSocios } from './socios';

const TZ = 'America/Montevideo';
const NAVY = 'FF1F3557';
const GRIS = 'FFF2F2F2';
const MONEY = '#,##0.00;[Red]-#,##0.00';
const NOMBRES: Record<SocioName, string> = { brian: 'Brian', paula: 'Paula', gaston: 'Gastón' };
const AREA_LBL: Record<SocioMove['area'], string> = {
  marca: 'Marca', showroom: 'Showroom', cafeteria: 'Cafetería',
  crp: 'Estadía CRP', argentinos: 'Viaje Bs.As. (ARS)', otros: 'Otros',
};
const TIPO_LBL: Record<SocioMove['tipo'], string> = {
  gasto: 'Gasto', pago: 'Pago entre socios', venta: 'Reparto de venta', ajuste: 'Ajuste',
};
const METODO_LBL: Record<string, string> = {
  mp: 'Mercado Pago', efectivo: 'Efectivo', transferencia: 'Transferencia', debe: 'Fiado',
};

const fmtFechaHora = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-UY', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

/** "2026-07-28" → "28/07/2026" (fecha sin hora, no depende de zona horaria) */
const fmtFecha = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return d && m && y ? `${d}/${m}/${y}` : ymd;
};

const cuandoSocio = (m: SocioMove) => (m.fecha ? fmtFecha(m.fecha) : (m.periodo || '—'));

const quienSocio = (m: SocioMove) => {
  if (m.tipo === 'gasto') return m.pagador ? `Pagó ${NOMBRES[m.pagador]}` : 'Pagaron varios';
  if (m.tipo === 'pago') return m.de && m.para ? `${NOMBRES[m.de]} → ${NOMBRES[m.para]}` : '';
  if (m.tipo === 'venta') {
    if (!m.para) return '';
    return m.de ? `Cobró ${NOMBRES[m.para]} · parte de ${NOMBRES[m.de]}` : `Cobró ${NOMBRES[m.para]}`;
  }
  return '';
};

type Sheet = import('exceljs').Worksheet;

function styleHeader(ws: Sheet) {
  const row = ws.getRow(1);
  row.eachCell(cell => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  row.height = 22;
}

function baseFont(ws: Sheet) {
  ws.eachRow(row => row.eachCell(cell => {
    if (!cell.font) cell.font = { name: 'Arial', size: 10 };
    else cell.font = { name: 'Arial', size: 10, ...cell.font };
  }));
}

/**
 * Genera y descarga el reporte Excel de la Caja: movimientos del bot con quién
 * los registró, gastos y ventas por persona, y las cuentas entre socios.
 */
export async function exportCajaExcel(entries: LedgerEntry[], socios: SocioMove[] | null): Promise<void> {
  const ExcelJS = await import('exceljs').then(m => (m as { default?: typeof import('exceljs') }).default ?? m);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VOLEA Admin';
  const activos = entries.filter(e => !e.reverted);
  const hoy = new Date();

  // ── Resumen ──────────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Resumen');
    ws.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 40 }];
    const title = ws.addRow([`CAJA VOLEA — reporte generado el ${fmtFechaHora(hoy.toISOString())}`]);
    title.getCell(1).font = { name: 'Arial', size: 14, bold: true, color: { argb: NAVY } };
    ws.addRow([]);

    const ventas = activos.filter(e => e.kind === 'venta').reduce((s, e) => s + e.amount, 0);
    const gastos = activos.filter(e => e.kind === 'gasto').reduce((s, e) => s + e.amount, 0);
    const fiado = activos
      .filter(e => e.kind === 'venta' && e.paymentMethod === 'debe' && !e.settledAt)
      .reduce((s, e) => s + e.amount, 0);
    const totRow = ws.addRow(['Movimientos del bot (sin anulados)', 'Ventas ($)', 'Gastos ($)', 'Balance ($)', 'Por cobrar ($)']);
    totRow.eachCell(c => { c.font = { name: 'Arial', size: 10, bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } }; });
    const vals = ws.addRow(['', ventas, gastos, ventas - gastos, fiado]);
    for (let i = 2; i <= 5; i++) vals.getCell(i).numFmt = MONEY;

    ws.addRow([]);
    const perHead = ws.addRow(['Por persona (bot)', 'Ventas ($)', 'Gastos ($)', 'Neto ($)', 'Movimientos']);
    perHead.eachCell(c => { c.font = { name: 'Arial', size: 10, bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } }; });
    const personas = Array.from(new Set(activos.map(e => e.reportedBy || '—'))).sort();
    for (const p of personas) {
      const de = activos.filter(e => (e.reportedBy || '—') === p);
      const v = de.filter(e => e.kind === 'venta').reduce((s, e) => s + e.amount, 0);
      const g = de.filter(e => e.kind === 'gasto').reduce((s, e) => s + e.amount, 0);
      const row = ws.addRow([p, v, g, v - g, de.length]);
      for (let i = 2; i <= 4; i++) row.getCell(i).numFmt = MONEY;
    }

    if (socios && socios.length > 0) {
      ws.addRow([]);
      const uyu = socios.filter(m => m.moneda === 'UYU');
      const sHead = ws.addRow(['Cuentas entre socios (UYU)', 'Al día de hoy ($)', 'Cuotas futuras ($)', 'Total ($)', '', 'positivo = debe al grupo · negativo = a favor']);
      sHead.eachCell(c => { c.font = { name: 'Arial', size: 10, bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } }; });
      const ceros = () => ({ brian: 0, paula: 0, gaston: 0 } as Record<SocioName, number>);
      const alDia = ceros(), futuras = ceros();
      let futMonto = 0, futN = 0, invHoy = 0, invTotal = 0;
      for (const m of uyu) {
        const esFutura = esCuotaFutura(m, hoy);
        const dest = esFutura ? futuras : alDia;
        dest.brian += m.impBrian; dest.paula += m.impPaula; dest.gaston += m.impGaston;
        if (esFutura) { futMonto += m.monto; futN++; }
        if (m.tipo === 'gasto') {
          invTotal += m.monto;
          if (!esFutura) invHoy += m.monto;
        }
      }
      (Object.keys(alDia) as SocioName[]).forEach(k => {
        const total = alDia[k] + futuras[k];
        const row = ws.addRow([NOMBRES[k],
          Math.round(alDia[k] * 100) / 100,
          Math.round(futuras[k] * 100) / 100,
          Math.round(total * 100) / 100, '',
          total > 0.5 ? 'le debe al grupo' : total < -0.5 ? 'el grupo le debe' : 'al día']);
        for (let i = 2; i <= 4; i++) row.getCell(i).numFmt = MONEY;
        row.getCell(1).font = { name: 'Arial', size: 10, bold: true };
        row.getCell(4).font = { name: 'Arial', size: 10, bold: true };
      });
      if (futN > 0) {
        ws.addRow([`"Cuotas futuras" = ${futN} cuotas por $ ${futMonto.toLocaleString('es-UY', { minimumFractionDigits: 2 })} que vencen después de este mes.`]);
      }

      ws.addRow([]);
      const ventasNegocio = ventasBrutasSocios(socios);
      const nHead = ws.addRow(['Números del negocio', 'Ventas ($)', 'Invertido ($)', 'Balance ($)', '', 'balance = ventas − gastos, sin descontar stock']);
      nHead.eachCell(c => { c.font = { name: 'Arial', size: 10, bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } }; });
      for (const [lbl, inv] of [['Al día de hoy', invHoy], ['Total comprometido', invTotal]] as const) {
        const row = ws.addRow([lbl, Math.round(ventasNegocio * 100) / 100, Math.round(inv * 100) / 100,
          Math.round((ventasNegocio - inv) * 100) / 100, '', '']);
        for (let i = 2; i <= 4; i++) row.getCell(i).numFmt = MONEY;
      }
      ws.addRow(['Ventas = reconstruidas de los repartos entre socios + ventas cargadas en la web. No incluye ventas del bot sin repartir.']);
      const ars = socios.filter(m => m.moneda === 'ARS');
      if (ars.length > 0) {
        const arsB = ars.reduce((s, m) => s + m.impBrian, 0);
        const arsP = ars.reduce((s, m) => s + m.impPaula, 0);
        const arsG = ars.reduce((s, m) => s + m.impGaston, 0);
        ws.addRow([`Aparte en ARS (viaje Bs.As.): Brian ${arsB >= 0 ? 'debe' : 'a favor'} ${Math.abs(arsB).toLocaleString('es-UY')} · ` +
          `Paula ${arsP >= 0 ? 'debe' : 'a favor'} ${Math.abs(arsP).toLocaleString('es-UY')} · ` +
          `Gastón ${arsG >= 0 ? 'debe' : 'a favor'} ${Math.abs(arsG).toLocaleString('es-UY')}`]);
      }
    }
    baseFont(ws);
  }

  // ── Movimientos bot ──────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Movimientos bot', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Fecha', width: 17 }, { header: 'Tipo', width: 8 },
      { header: 'Detalle', width: 38 }, { header: 'Variante', width: 18 },
      { header: 'Cant.', width: 7 }, { header: 'Monto ($)', width: 12 },
      { header: 'Método', width: 14 }, { header: 'Debe / cobrado', width: 22 },
      { header: 'Registró', width: 12 }, { header: 'Anulado', width: 9 },
      { header: 'Liquidado a socios', width: 15 },
    ];
    for (const e of entries) {
      const debeInfo = e.paymentMethod === 'debe'
        ? (e.settledAt
          ? `Debía ${e.debtorName || '—'} · cobrado${e.settledMethod ? ` (${METODO_LBL[e.settledMethod]})` : ''}`
          : `Debe ${e.debtorName || '—'}`)
        : '';
      const row = ws.addRow([
        fmtFechaHora(e.createdAt), e.kind === 'venta' ? 'Venta' : 'Gasto', e.label,
        e.variantKey ? e.variantKey.split('|').filter(Boolean).join(' · ') : '',
        e.qty, e.kind === 'venta' ? e.amount : -e.amount,
        e.paymentMethod ? (METODO_LBL[e.paymentMethod] || e.paymentMethod) : '',
        debeInfo, e.reportedBy, e.reverted ? 'Sí' : '',
        e.socioSettledAt ? 'Sí' : '',
      ]);
      row.getCell(6).numFmt = MONEY;
      if (e.reverted) row.eachCell(c => { c.font = { name: 'Arial', size: 10, strike: true, color: { argb: 'FF999999' } }; });
    }
    ws.autoFilter = { from: 'A1', to: `K${entries.length + 1}` };
    styleHeader(ws);
    baseFont(ws);
  }

  // ── Gastos por persona (bot) ─────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Gastos por persona');
    ws.columns = [
      { header: 'Registró', width: 14 }, { header: 'Fecha', width: 17 },
      { header: 'Detalle', width: 44 }, { header: 'Monto ($)', width: 13 },
    ];
    const gastos = activos.filter(e => e.kind === 'gasto');
    const personas = Array.from(new Set(gastos.map(e => e.reportedBy || '—'))).sort();
    for (const p of personas) {
      const de = gastos.filter(e => (e.reportedBy || '—') === p)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const e of de) {
        const row = ws.addRow([p, fmtFechaHora(e.createdAt), e.label, e.amount]);
        row.getCell(4).numFmt = MONEY;
      }
      const sub = ws.addRow([`Total ${p}`, '', `${de.length} gasto${de.length === 1 ? '' : 's'}`,
        de.reduce((s, e) => s + e.amount, 0)]);
      sub.eachCell(c => { c.font = { name: 'Arial', size: 10, bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } }; });
      sub.getCell(4).numFmt = MONEY;
    }
    const tot = ws.addRow(['TOTAL GASTOS (bot)', '', `${gastos.length} gastos`, gastos.reduce((s, e) => s + e.amount, 0)]);
    tot.eachCell(c => { c.font = { name: 'Arial', size: 10, bold: true }; });
    tot.getCell(4).numFmt = MONEY;
    styleHeader(ws);
    baseFont(ws);
  }

  // ── Ventas por persona y método ──────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Ventas por persona');
    const metodos = ['mp', 'efectivo', 'transferencia', 'debe-pendiente', 'debe-cobrado', 'sin-metodo'];
    ws.columns = [
      { header: 'Registró', width: 14 }, { header: 'Mercado Pago', width: 14 },
      { header: 'Efectivo', width: 12 }, { header: 'Transferencia', width: 14 },
      { header: 'Fiado pendiente', width: 15 }, { header: 'Fiado cobrado', width: 14 },
      { header: 'Sin método', width: 12 }, { header: 'Total ($)', width: 13 },
    ];
    const ventas = activos.filter(e => e.kind === 'venta');
    const metodoDe = (e: LedgerEntry) => {
      if (e.paymentMethod === 'debe') return e.settledAt ? 'debe-cobrado' : 'debe-pendiente';
      return e.paymentMethod || 'sin-metodo';
    };
    const personas = Array.from(new Set(ventas.map(e => e.reportedBy || '—'))).sort();
    for (const p of personas) {
      const de = ventas.filter(e => (e.reportedBy || '—') === p);
      const porMetodo = metodos.map(m => de.filter(e => metodoDe(e) === m).reduce((s, e) => s + e.amount, 0));
      const row = ws.addRow([p, ...porMetodo, de.reduce((s, e) => s + e.amount, 0)]);
      for (let i = 2; i <= 8; i++) row.getCell(i).numFmt = MONEY;
    }
    const porMetodoTot = metodos.map(m => ventas.filter(e => metodoDe(e) === m).reduce((s, e) => s + e.amount, 0));
    const tot = ws.addRow(['TOTAL', ...porMetodoTot, ventas.reduce((s, e) => s + e.amount, 0)]);
    tot.eachCell(c => { c.font = { name: 'Arial', size: 10, bold: true }; });
    for (let i = 2; i <= 8; i++) tot.getCell(i).numFmt = MONEY;
    styleHeader(ws);
    baseFont(ws);
  }

  // ── Cuentas socios ───────────────────────────────────────────────────────
  if (socios && socios.length > 0) {
    const ws = wb.addWorksheet('Cuentas socios', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Cuándo', width: 13 }, { header: 'Área', width: 13 },
      { header: 'Tipo', width: 17 }, { header: 'Descripción', width: 40 },
      { header: 'Quién', width: 26 }, { header: 'Moneda', width: 8 },
      { header: 'Monto', width: 12 }, { header: 'Imp. Brian', width: 12 },
      { header: 'Imp. Paula', width: 12 }, { header: 'Imp. Gastón', width: 12 },
      { header: 'Cuota futura', width: 11 },
    ];
    for (const m of socios) {
      const row = ws.addRow([
        cuandoSocio(m), AREA_LBL[m.area] || m.area, TIPO_LBL[m.tipo] || m.tipo,
        m.descripcion, quienSocio(m), m.moneda, m.monto,
        Math.round(m.impBrian * 100) / 100, Math.round(m.impPaula * 100) / 100, Math.round(m.impGaston * 100) / 100,
        esCuotaFutura(m, hoy) ? 'Sí' : '',
      ]);
      for (let i = 7; i <= 10; i++) row.getCell(i).numFmt = MONEY;
    }
    ws.autoFilter = { from: 'A1', to: `K${socios.length + 1}` };
    styleHeader(ws);
    baseFont(ws);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const y = hoy.getFullYear();
  const mo = String(hoy.getMonth() + 1).padStart(2, '0');
  const d = String(hoy.getDate()).padStart(2, '0');
  a.href = url;
  a.download = `caja-volea-${y}-${mo}-${d}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
