// Carga masiva de DUPR ID al padrón: Brian pega una lista "Nombre, DUPRID"
// (de un Excel, un WhatsApp, lo que sea) y esto la parsea y la matchea contra
// rk_jugadores con el mismo criterio de nombres del resto de la app (sin
// tildes, tolerante a typos). Todo puro: la UI solo muestra el resultado y
// guarda lo que Brian confirme.

import { distancia, normalizar } from './nombres';

/** Un DUPR ID es corto y alfanumérico (ej: 7XZ4V2); se acepta guion por las dudas. */
const ID_VALIDO = /^[A-Za-z0-9-]{4,20}$/;

export interface FilaDupr {
  linea: number;
  nombre: string;
  duprId: string;
  error?: string;
}

/** Parte el texto pegado en filas {nombre, duprId}. Separadores: coma, ; , tab o 2+ espacios. */
export function parsearDuprPegado(texto: string): FilaDupr[] {
  const filas: FilaDupr[] = [];
  const lineas = texto.split(/\r?\n/);
  for (let i = 0; i < lineas.length; i++) {
    const cruda = lineas[i].trim();
    if (cruda === '') continue;
    // Encabezado típico de una planilla ("Nombre, DUPR ID"): se saltea.
    const bajo = cruda.toLowerCase();
    if (i === 0 && bajo.includes('dupr') && (bajo.includes('nombre') || bajo.includes('jugador'))) continue;

    const partes = cruda.split(/\s*[,;\t]\s*|\s{2,}/).map(p => p.trim()).filter(Boolean);
    const linea = i + 1;
    if (partes.length < 2) {
      filas.push({ linea, nombre: cruda, duprId: '', error: 'falta el DUPR ID' });
      continue;
    }
    const nombre = partes[0];
    const duprId = partes[1];
    if (!ID_VALIDO.test(duprId)) {
      filas.push({ linea, nombre, duprId, error: `«${duprId}» no parece un DUPR ID` });
      continue;
    }
    filas.push({ linea, nombre, duprId });
  }
  return filas;
}

export interface JugadorPadron {
  id: string;
  nombre: string;
  alias: string[];
  duprId: string | null;
}

export type EstadoMatch = 'nuevo' | 'actualiza' | 'igual' | 'dudoso' | 'sin-match' | 'duplicado' | 'invalido';

export interface MatchDupr {
  linea: number;
  nombrePegado: string;
  duprId: string;
  estado: EstadoMatch;
  /** Jugador del padrón al que se le va a escribir (estados nuevo/actualiza/igual). */
  jugador?: { id: string; nombre: string; duprId: string | null };
  /** Candidatos parecidos cuando el nombre no matchea exacto. */
  candidatos?: { id: string; nombre: string }[];
  error?: string;
}

/** Cruza las filas pegadas contra el padrón y dice qué haría con cada una. */
export function matchearDupr(filas: FilaDupr[], padron: JugadorPadron[]): MatchDupr[] {
  const porNombre = new Map<string, JugadorPadron>();
  for (const j of padron) {
    porNombre.set(normalizar(j.nombre), j);
    for (const a of j.alias) porNombre.set(normalizar(a), j);
  }
  const yaTocados = new Set<string>();
  return filas.map(f => {
    const base = { linea: f.linea, nombrePegado: f.nombre, duprId: f.duprId };
    if (f.error) return { ...base, estado: 'invalido' as const, error: f.error };

    const norm = normalizar(f.nombre);
    const exacto = porNombre.get(norm);
    if (!exacto) {
      const candidatos = padron
        .filter(j => [j.nombre, ...j.alias].some(n => {
          const nn = normalizar(n);
          return Math.min(nn.length, norm.length) >= 5 && distancia(nn, norm) <= 2;
        }))
        .slice(0, 3)
        .map(j => ({ id: j.id, nombre: j.nombre }));
      return candidatos.length > 0
        ? { ...base, estado: 'dudoso' as const, candidatos }
        : { ...base, estado: 'sin-match' as const };
    }
    if (yaTocados.has(exacto.id)) {
      return { ...base, estado: 'duplicado' as const, jugador: { id: exacto.id, nombre: exacto.nombre, duprId: exacto.duprId } };
    }
    yaTocados.add(exacto.id);
    const jugador = { id: exacto.id, nombre: exacto.nombre, duprId: exacto.duprId };
    if ((exacto.duprId || '') === f.duprId) return { ...base, estado: 'igual' as const, jugador };
    return { ...base, estado: exacto.duprId ? ('actualiza' as const) : ('nuevo' as const), jugador };
  });
}

/** Los que efectivamente se van a escribir al confirmar. */
export function asignacionesAGuardar(matches: MatchDupr[]): { id: string; duprId: string }[] {
  return matches
    .filter(m => (m.estado === 'nuevo' || m.estado === 'actualiza') && m.jugador)
    .map(m => ({ id: m.jugador!.id, duprId: m.duprId }));
}
