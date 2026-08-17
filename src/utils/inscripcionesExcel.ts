// Export de inscripciones con el FORMATO DE LA PLANILLA de Brian (hojas
// DOBLES/SINGLES, duplas numeradas de a 2 filas, "CONFIRMAR" para pareja
// pendiente). El armado de filas es puro y testeable; exceljs entra por
// import() dinámico para no engordar el bundle (patrón cajaExcel — ojo DEV:
// el primer click puede recargar por el optimize de Vite; en prod no pasa).

import type { Event, Inscripcion } from '../types';
import { armarSeccionesCategoria, parejaDe } from './inscripciones';

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
