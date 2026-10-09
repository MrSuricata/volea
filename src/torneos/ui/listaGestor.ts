import type { Torneo } from '../engine/tipos';
import { resultadoDe } from '../engine/tipos';

/** Partidos del torneo con resultado cargado y total (grupos + llave, sin byes). */
export function avanceDe(t: Torneo): { jugados: number; total: number } {
  const grupo = t.partidosGrupo ?? [];
  const llave = (t.partidosLlave ?? []).filter((p) => p.a !== null && p.b !== null);
  const todos = [...grupo, ...llave];
  return { total: todos.length, jugados: todos.filter((p) => resultadoDe(p) !== null).length };
}

export type GrupoGestor = {
  /** Nombre del evento; '' para los torneos sin evento. */
  evento: string;
  titulo: string;
  enJuego: boolean;
  torneos: Torneo[];
};

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Agrupa los torneos del gestor por evento para cargar resultados sin buscar en una lista larga:
 * primero los eventos con algo en juego (el más nuevo arriba), después los terminados; adentro
 * de cada evento, por nombre. Los torneos sin evento van en su propio grupo al final del bloque
 * que les toque. `busqueda` filtra por nombre de torneo o de evento.
 */
export function agruparParaGestor(torneos: Torneo[], busqueda = ''): GrupoGestor[] {
  const q = normalizar(busqueda.trim());
  const filtrados = q
    ? torneos.filter((t) => normalizar(`${t.nombre} ${t.evento ?? ''}`).includes(q))
    : torneos;
  const porEvento = new Map<string, Torneo[]>();
  for (const t of filtrados) {
    const clave = (t.evento ?? '').trim();
    porEvento.set(clave, [...(porEvento.get(clave) ?? []), t]);
  }
  const grupos: GrupoGestor[] = [...porEvento.entries()].map(([evento, lista]) => ({
    evento,
    titulo: evento || 'Sin evento',
    enJuego: lista.some((t) => t.fase !== 'terminado'),
    torneos: [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
  }));
  const masNuevo = (g: GrupoGestor) => Math.max(...g.torneos.map((t) => new Date(t.creadoEl).getTime() || 0));
  return grupos.sort((x, y) =>
    Number(y.enJuego) - Number(x.enJuego)
    || Number(x.evento === '') - Number(y.evento === '')
    || masNuevo(y) - masNuevo(x)
    || x.titulo.localeCompare(y.titulo, 'es'));
}
