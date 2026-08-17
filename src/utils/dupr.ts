// Carga masiva de DUPR ID al padrón: Brian pega una lista "Nombre, DUPRID"
// (de un Excel, un WhatsApp, lo que sea) y esto la parsea y la matchea contra
// rk_jugadores con el mismo criterio de nombres del resto de la app (sin
// tildes, tolerante a typos). Todo puro: la UI solo muestra el resultado y
// guarda lo que Brian confirme.

import { distancia, normalizar } from './nombres';

/** Un DUPR ID es corto y alfanumérico (ej: 7XZ4V2); se acepta guion por las dudas. */
const ID_VALIDO = /^[A-Za-z0-9-]{4,20}$/;
/** Un rating DUPR es un número entre 1 y 8 con hasta 3 decimales (3.6 / 3.600 / 3,6). */
const RATING_CRUDO = /^\d(?:[.,]\d{1,3})?$/;

/** "3.600" y "3,6" son 3.6 (el DUPR va de 1 a 8: nunca es tres mil seiscientos). */
export function parsearRating(txt: string): number | null {
  const limpio = txt.trim().replace(',', '.');
  if (!RATING_CRUDO.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n >= 1 && n <= 8 ? n : null;
}

export interface FilaDupr {
  linea: number;
  nombre: string;
  duprId: string;
  rating: number | null;
  error?: string;
}

/**
 * Parte el texto pegado en filas {nombre, duprId, rating}. Separadores: coma,
 * ; , tab o 2+ espacios. Después del nombre, cada campo se reconoce por su
 * forma: número 1-8 = rating, alfanumérico = DUPR ID. Así sirven las tres
 * formas de pegar: solo ID, solo rating, o los dos en cualquier orden.
 */
export function parsearDuprPegado(texto: string): FilaDupr[] {
  const filas: FilaDupr[] = [];
  const lineas = texto.split(/\r?\n/);
  for (let i = 0; i < lineas.length; i++) {
    const cruda = lineas[i].trim();
    if (cruda === '') continue;
    // Encabezado típico de una planilla ("Nombre, DUPR ID"): se saltea.
    const bajo = cruda.toLowerCase();
    if (i === 0 && bajo.includes('dupr') && (bajo.includes('nombre') || bajo.includes('jugador'))) continue;

    // Una coma ENTRE DÍGITOS es decimal ("3,45"), nunca separador de campos:
    // los nombres no tienen números. Se normaliza antes de cortar.
    const normalizada = cruda.replace(/(\d),(\d)/g, '$1.$2');
    let partes = normalizada.split(/\s*[,;\t]\s*|\s{2,}/).map(p => p.trim()).filter(Boolean);
    // "Franco Montero 3.6" (un solo espacio, como se escribe en WhatsApp): si
    // quedó todo junto, se corta por el último espacio cuando la cola es un
    // rating o un ID válido.
    if (partes.length === 1) {
      const corte = partes[0].lastIndexOf(' ');
      if (corte > 0) {
        const cola = partes[0].slice(corte + 1);
        // Sin separador explícito, la cola solo se toma como DUPR si es un
        // rating o un ID CON algún dígito: si no, "Ana Lopez" partiría el
        // apellido como si fuera un ID.
        if (parsearRating(cola) !== null || (ID_VALIDO.test(cola) && /\d/.test(cola))) {
          partes = [partes[0].slice(0, corte).trim(), cola];
        }
      }
    }
    const linea = i + 1;
    const nombre = partes[0];
    if (partes.length < 2) {
      filas.push({ linea, nombre: cruda, duprId: '', rating: null, error: 'falta el DUPR (ID o rating)' });
      continue;
    }

    let duprId = '';
    let rating: number | null = null;
    let error: string | undefined;
    for (const campo of partes.slice(1)) {
      const comoRating = parsearRating(campo);
      if (comoRating !== null) { rating ??= comoRating; continue; }
      if (ID_VALIDO.test(campo)) { if (duprId === '') duprId = campo; continue; }
      error ??= `«${campo}» no es un DUPR ID ni un rating`;
    }
    if (duprId === '' && rating === null) {
      filas.push({ linea, nombre, duprId, rating, error: error ?? 'no se entiende el DUPR' });
      continue;
    }
    filas.push({ linea, nombre, duprId, rating, error });
  }
  return filas;
}

// ── Topes por categoría (reglamento APU, dictado por Brian 17/8) ─────────────

export interface TopeCategoria {
  /** Máximo DUPR de cada jugador. */
  individual: number;
  /** Máximo de la SUMA de la dupla (null = sin tope de suma). */
  suma: number | null;
}

export const TOPES_APU: Record<string, TopeCategoria> = {
  'Doble Masculino B': { individual: 3.6, suma: 7.0 },
  'Doble Mixto B': { individual: 3.6, suma: 7.0 },
  'Doble Femenino B': { individual: 3.3, suma: 6.5 },
  'Singles Masculino B': { individual: 3.6, suma: null },
  'Doble Masculino C': { individual: 3.0, suma: null },
  'Doble Mixto C': { individual: 3.0, suma: null },
  'Doble Femenino C': { individual: 3.0, suma: null },
  'Singles Masculino C': { individual: 3.0, suma: null },
  'Singles Femenino C': { individual: 3.0, suma: null },
};

export type EstadoTope = 'ok' | 'excede-individual' | 'excede-suma' | 'sin-datos' | 'sin-tope';

export interface ChequeoTope {
  estado: EstadoTope;
  tope?: TopeCategoria;
  suma: number | null;
  /** Ratings que pasan el tope individual. */
  quienesExceden: { nombre: string; rating: number }[];
  detalle: string;
}

/**
 * Chequea una dupla (o un jugador solo, en singles) contra el tope de su
 * categoría. `sin-datos` = falta el DUPR de alguien, así que no se puede
 * afirmar nada — la UI lo muestra distinto de un incumplimiento.
 */
export function chequearTope(categoria: string, jugadores: { nombre: string; rating: number | null }[]): ChequeoTope {
  const tope = TOPES_APU[categoria];
  if (!tope) return { estado: 'sin-tope', suma: null, quienesExceden: [], detalle: 'sin tope' };
  if (jugadores.length === 0 || jugadores.some(j => j.rating === null)) {
    return { estado: 'sin-datos', tope, suma: null, quienesExceden: [], detalle: 'falta DUPR' };
  }
  const ratings = jugadores as { nombre: string; rating: number }[];
  const suma = Math.round(ratings.reduce((s, j) => s + j.rating, 0) * 1000) / 1000;
  const quienesExceden = ratings.filter(j => j.rating > tope.individual);
  if (quienesExceden.length > 0) {
    return {
      estado: 'excede-individual', tope, suma, quienesExceden,
      detalle: `${quienesExceden.map(j => `${j.nombre} ${j.rating.toFixed(3)}`).join(', ')} supera ${tope.individual.toFixed(3)}`,
    };
  }
  if (tope.suma !== null && suma > tope.suma) {
    return {
      estado: 'excede-suma', tope, suma, quienesExceden: [],
      detalle: `la dupla suma ${suma.toFixed(3)} y el máximo es ${tope.suma.toFixed(3)}`,
    };
  }
  return { estado: 'ok', tope, suma, quienesExceden: [], detalle: `suma ${suma.toFixed(3)}` };
}

export interface JugadorPadron {
  id: string;
  nombre: string;
  alias: string[];
  duprId: string | null;
  /** Rating DUPR (foto), con el día en que se cargó. */
  rating?: number | null;
  ratingAt?: string | null;
}

export type EstadoMatch = 'nuevo' | 'actualiza' | 'igual' | 'dudoso' | 'sin-match' | 'duplicado' | 'invalido';

export interface MatchDupr {
  linea: number;
  nombrePegado: string;
  duprId: string;
  rating: number | null;
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
    const base = { linea: f.linea, nombrePegado: f.nombre, duprId: f.duprId, rating: f.rating };
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
    // Se compara lo que REALMENTE se va a escribir: si viene solo el rating, el
    // ID vacío no cuenta como cambio (y al revés). Si nada cambia, es 'igual'.
    const cambiaId = f.duprId !== '' && f.duprId !== (exacto.duprId || '');
    const cambiaRating = f.rating !== null && f.rating !== (exacto.rating ?? null);
    if (!cambiaId && !cambiaRating) return { ...base, estado: 'igual' as const, jugador };
    const teniaAlgo = (cambiaId && !!exacto.duprId) || (cambiaRating && exacto.rating != null);
    return { ...base, estado: teniaAlgo ? ('actualiza' as const) : ('nuevo' as const), jugador };
  });
}

/** Los que efectivamente se van a escribir al confirmar. */
export function asignacionesAGuardar(matches: MatchDupr[]): { id: string; duprId: string; rating: number | null }[] {
  return matches
    .filter(m => (m.estado === 'nuevo' || m.estado === 'actualiza') && m.jugador)
    .map(m => ({ id: m.jugador!.id, duprId: m.duprId, rating: m.rating }));
}
