// Export de inscripciones con el FORMATO DE LA PLANILLA de Brian (hojas
// DOBLES/SINGLES, duplas numeradas de a 2 filas, "CONFIRMAR" para pareja
// pendiente). El armado de filas es puro y testeable; exceljs entra por
// import() dinámico para no engordar el bundle (patrón cajaExcel — ojo DEV:
// el primer click puede recargar por el optimize de Vite; en prod no pasa).

import type { Event, Inscripcion, TarifaEvento } from '../types';
import { armarSeccionesCategoria, categoriasDe, costoInscripcion, parejaDe } from './inscripciones';

/** "Doble Masculino A" → "MASC A" · "Singles Femenino B" → "SINGLE FEM B". */
export function nivelSheet(categoria: string): string {
  const GEN: Record<string, string> = { masculino: 'MASC', femenino: 'FEM', mixto: 'MIXTO' };
  const doble = categoria.match(/^Doble (Masculino|Femenino|Mixto) (.+)$/i);
  if (doble) return `${GEN[doble[1].toLowerCase()]} ${doble[2].toUpperCase()}`;
  const single = categoria.match(/^Singles (Masculino|Femenino) (.+)$/i);
  if (single) return `SINGLE ${GEN[single[1].toLowerCase()]} ${single[2].toUpperCase()}`;
  return categoria;
}

const estadoPago = (i: Inscripcion) => (i.estado === 'confirmada' ? 'Pagado' : 'Pendiente');

/**
 * Filas de la planilla: DOBLES con numeración global de duplas (mutuas → los
 * dos inscriptos; declaradas → inscripto + su pareja externa; sin pareja →
 * inscripto + "CONFIRMAR") y SINGLES una fila por jugador. Bajas excluidas.
 */
export function armarFilasPlanilla(
  inscripciones: Inscripcion[],
  categoriasEvento: string[],
): { dobles: string[][]; singles: string[][] } {
  const activos = inscripciones.filter(i => i.estado !== 'baja');
  const secciones = armarSeccionesCategoria(activos, categoriasEvento);
  const porId = new Map(activos.map(i => [i.id, i]));
  const dobles: string[][] = [];
  const singles: string[][] = [];
  let nDupla = 0;
  let nSingle = 0;
  for (const sec of secciones) {
    const nivel = nivelSheet(sec.categoria);
    if (sec.categoria.toLowerCase().includes('doble')) {
      for (const [aId, bId] of sec.duplas) {
        const a = porId.get(aId);
        const b = porId.get(bId);
        if (!a || !b) continue;
        nDupla++;
        dobles.push([String(nDupla), a.nombre, a.celular, nivel, estadoPago(a)]);
        dobles.push(['', b.nombre, b.celular, nivel, estadoPago(b)]);
      }
      for (const id of sec.sueltos) {
        const i = porId.get(id);
        if (!i) continue;
        nDupla++;
        dobles.push([String(nDupla), i.nombre, i.celular, nivel, estadoPago(i)]);
        dobles.push(['', parejaDe(i, sec.categoria) || 'CONFIRMAR', '', nivel, '']);
      }
    } else {
      for (const id of sec.sueltos) {
        const i = porId.get(id);
        if (!i) continue;
        nSingle++;
        singles.push([String(nSingle), i.nombre, i.celular, nivel, estadoPago(i)]);
      }
    }
  }
  return { dobles, singles };
}

const HEADER = ['#', 'Participante', 'Telefono contacto', 'Nivel', 'Estado Pago', 'Forma de pago', 'MONTO', 'RACKET POINT', 'VOLEA'];
const NAVY = 'FF1F3557';

const METODO_XLS: Record<string, string> = {
  mp: 'Mercado Pago', efectivo: 'Efectivo', transferencia: 'Transferencia', freepass: 'Free pass',
};

/** "2026-08-23T14:05:00Z" → "23/08". */
const fechaCorta = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const HEADER_PAGOS = ['Participante', 'Cant. categorías', 'Categorías', 'Debería pagar', 'Estado', 'Pagó', 'Debe', 'Forma de pago', 'Fecha pago'];

/**
 * Hoja PAGOS: una fila por inscripto (nombre único, alfabético, bajas afuera)
 * con lo que le corresponde pagar por tarifa, si pagó, cuánto y cómo. El
 * "debería" usa el costo registrado en el pago si existe (respeta descuentos
 * cargados a mano); si no, la tarifa por cantidad de categorías. Free pass
 * cuenta $0. Cierra con fila TOTAL.
 */
export function armarFilasPagos(inscripciones: Inscripcion[], tarifa: TarifaEvento | null): (string | number)[][] {
  const activos = [...inscripciones]
    .filter(i => i.estado !== 'baja')
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const filas: (string | number)[][] = [];
  let tDeberia = 0, tPago = 0, tDebe = 0;
  for (const i of activos) {
    const cats = categoriasDe(i);
    const freepass = i.pagoMetodo === 'freepass';
    const deberia = freepass ? 0 : i.pagoCosto ?? (tarifa ? costoInscripcion(cats.length, tarifa) : 0);
    const pago = i.pagoAt ? (i.pagoMonto ?? 0) : 0;
    const debe = !i.pagoAt ? deberia : freepass ? 0 : (i.pagoDeuda ?? 0);
    const estado = !i.pagoAt ? 'SIN REGISTRAR'
      : freepass ? 'Free pass'
        : debe > 0 ? 'Parcial' : 'Pagado';
    tDeberia += deberia; tPago += pago; tDebe += debe;
    filas.push([
      i.nombre, cats.length, cats.map(nivelSheet).join(', '),
      deberia, estado, pago, debe,
      i.pagoMetodo ? METODO_XLS[i.pagoMetodo] ?? i.pagoMetodo : '',
      i.pagoAt ? fechaCorta(i.pagoAt) : '',
    ]);
  }
  filas.push(['TOTAL', '', '', tDeberia, '', tPago, tDebe, '', '']);
  return filas;
}

/** Genera y descarga la planilla .xlsx del evento. */
export async function exportPlanillaExcel(evento: Event, inscripciones: Inscripcion[]): Promise<void> {
  const categorias = (evento.categorias || '').split(',').map(c => c.trim()).filter(Boolean);
  const { dobles, singles } = armarFilasPlanilla(inscripciones, categorias);

  const ExcelJS = await import('exceljs').then(m => (m as { default?: typeof import('exceljs') }).default ?? m);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VOLEA Admin';

  for (const [nombre, filas] of [['DOBLES', dobles], ['SINGLES', singles]] as const) {
    const ws = wb.addWorksheet(nombre);
    ws.columns = [
      { width: 5 }, { width: 28 }, { width: 18 }, { width: 15 }, { width: 13 },
      { width: 15 }, { width: 10 }, { width: 14 }, { width: 10 },
    ];
    const header = ws.addRow(HEADER);
    header.eachCell(cell => {
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    header.height = 22;
    for (const f of filas) ws.addRow(f);
    ws.eachRow(row => row.eachCell(cell => {
      if (!cell.font?.bold) cell.font = { name: 'Arial', size: 10, ...cell.font };
    }));
  }

  // Hoja PAGOS: control de cobros por persona (pedido de Brian).
  const wsPagos = wb.addWorksheet('PAGOS');
  wsPagos.columns = [
    { width: 28 }, { width: 8 }, { width: 34 }, { width: 13 },
    { width: 15 }, { width: 10 }, { width: 10 }, { width: 15 }, { width: 11 },
  ];
  const headerPagos = wsPagos.addRow(HEADER_PAGOS);
  headerPagos.eachCell(cell => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  headerPagos.height = 22;
  const filasPagos = armarFilasPagos(inscripciones, evento.tarifa ?? null);
  for (const f of filasPagos) {
    const row = wsPagos.addRow(f);
    const esTotal = f[0] === 'TOTAL';
    const debe = Number(f[6]) || 0;
    const sinRegistrar = f[4] === 'SIN REGISTRAR';
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      cell.font = { name: 'Arial', size: 10, bold: esTotal };
      if ([4, 6, 7].includes(col)) cell.numFmt = '#,##0';
      // Rojo suave para lo pendiente: se ve de un vistazo a quién correr.
      if (!esTotal && (sinRegistrar || debe > 0) && (col === 5 || col === 7)) {
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFB45309' } };
      }
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const hoy = new Date();
  const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  a.href = url;
  a.download = `inscripciones-${evento.id}-${fecha}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
