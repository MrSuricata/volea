// jugadorIds: vinculo al padron (1 en individual, 2 en dobles). Ausente => sin vincular (no aporta al ranking).
export type Pareja = { id: string; nombre: string; jugadorIds?: string[] };

export type Grupo = { id: string; nombre: string; parejaIds: string[] };

export type PartidoGrupo = {
  id: string;
  grupoId: string;
  ronda: number;
  aId: string;
  bId: string;
  puntosA: number | null;
  puntosB: number | null;
};

export type SlotLlave =
  | { tipo: 'seed'; parejaId: string }
  | { tipo: 'ganadorDe'; partidoId: string }
  | { tipo: 'perdedorDe'; partidoId: string };

export type PartidoLlave = {
  id: string;
  ronda: number; // 1 = primera ronda de la llave
  posicion: number; // orden dentro de la ronda, desde 0
  a: SlotLlave | null; // null = bye (el rival pasa directo)
  b: SlotLlave | null;
  puntosA: number | null;
  puntosB: number | null;
  esTercerPuesto: boolean;
};

export type ConfigLlave = {
  porGrupo: 1 | 2 | 3;
  mejoresExtra: number;
  tercerPuesto: boolean;
  // parejaIds de los "mejores extra" elegidos a mano (para resolver empates en la cancha).
  // Ausente/vacío ⇒ la app los elige automáticamente por métricas.
  extrasManuales?: string[];
};

export type Fase = 'parejas' | 'grupos' | 'faseGrupos' | 'llave' | 'terminado';

export type Torneo = {
  id: string;
  nombre: string;
  creadoEl: string; // ISO
  formato?: 'grupos' | 'individual'; // ausente ⇒ 'grupos' (compat con torneos guardados)
  fase: Fase;
  parejas: Pareja[];
  grupos: Grupo[];
  partidosGrupo: PartidoGrupo[];
  configLlave: ConfigLlave | null;
  partidosLlave: PartidoLlave[] | null;
  canchas?: number; // canchas disponibles; la UI usa 2 por defecto
  categoria?: 'A' | 'B'; // categoria del torneo para el ranking; ausente => no cuenta hasta asignarla
  cuentaParaRanking?: boolean; // undefined => cuenta; false => excluido (torneos de prueba)
  visible?: boolean; // interruptor "lo ve el publico" (default true); la web lo denormaliza a la columna rk_torneos.visible
};

export function nuevoId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Un resultado vale solo si hay dos puntajes enteros >= 0 y no hay empate (no existe el empate en pickleball)
export function resultadoValido(puntosA: number | null, puntosB: number | null): boolean {
  if (puntosA === null || puntosB === null) return false;
  return Number.isInteger(puntosA) && Number.isInteger(puntosB) && puntosA >= 0 && puntosB >= 0 && puntosA !== puntosB;
}

// Puntajes de un resultado válido ya narroweados, o null si el partido no cuenta.
// Uso típico en el motor: const r = resultadoDe(p); if (!r) continue;
export function resultadoDe(p: { puntosA: number | null; puntosB: number | null }): { a: number; b: number } | null {
  if (!resultadoValido(p.puntosA, p.puntosB)) return null;
  return { a: p.puntosA as number, b: p.puntosB as number };
}

// ----- Ranking / padron -----

export type Jugador = { id: string; nombre: string; alias?: string[] };

// Escalones ordenados de mejor a peor. El indice es lo que usa la escalera de puntos.
export type Escalon = 'CAMPEON' | 'FINALISTA' | 'SEMI' | 'CUARTOS' | 'OCTAVOS' | 'PARTICIPO';
export const ESCALONES: Escalon[] = ['CAMPEON', 'FINALISTA', 'SEMI', 'CUARTOS', 'OCTAVOS', 'PARTICIPO'];

// escalera = puntos de categoria A por escalon [CAMPEON..PARTICIPO]; offsetB = cuantos escalones baja la B.
export type ConfigPuntos = { escalera: [number, number, number, number, number, number]; offsetB: number };
export const CONFIG_PUNTOS_DEFAULT: ConfigPuntos = { escalera: [100, 86, 72, 60, 50, 40], offsetB: 1 };
