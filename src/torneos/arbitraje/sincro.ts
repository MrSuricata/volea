// Cola de envío y reconciliación teléfono ↔ servidor del tanteador de árbitros. Puro: sin React ni red.
// ArbitroPage lo maneja con un ref y servicio.ts traduce las respuestas de la base a `Respuesta`.
//
// Cola: siempre se sube el ÚLTIMO estado completo (la lista de jugadas entera), de a un envío por vez.
// "Pendiente" = lo que muestra el teléfono no es lo último que el servidor confirmó tener; se apaga
// solo cuando lo confirmado ES lo último (si se marcó algo mientras viajaba un envío, se manda otro).
//
// Regla de reconciliación cuando el servidor tiene otra cosa (versión distinta), con
// L = lo del teléfono, S = lo del servidor, B = lo último que el servidor nos confirmó:
//   1. S = L                                → al día, nada que hacer.
//   2. S = B, o S es algo que mandó ESTE teléfono (eco de un envío cuya respuesta se perdió)
//                                            → nadie más tocó: se sigue con L y se vuelve a mandar.
//   3. S es el comienzo de L y B es el comienzo de S (el servidor avanzó por nuestra misma línea)
//                                            → se sigue con L (no hay nada que perder).
//   4. L es el comienzo de S                 → otro teléfono marcó más: se trae S (no se pierde nada).
//   5. Si no (dos teléfonos marcaron cosas distintas, o alguien deshizo en otro lado)
//                                            → manda el servidor (es lo que ve la TV), se avisa cuántas
//                                              jugadas de este teléfono quedaron afuera y se guarda un
//                                              respaldo para recuperarlas con un toque.
import type { FormatoArbitraje } from '../engine/tipos';
import type { Jugada } from './motor';

export type Resultado = { puntosA: number; puntosB: number; games?: { a: number; b: number }[]; wo?: boolean };

export type Cola = {
  jugadas: Jugada[]; // lo que muestra el teléfono (lo último)
  subido: Jugada[]; // lo último que el servidor confirmó tener
  version: number; // versión del servidor de `subido`
  enviados: string[]; // firmas de lo que mandó este teléfono (para reconocer su propio eco)
  enVuelo: Jugada[] | null; // lo que está viajando ahora (a lo sumo uno)
};

export type Respuesta =
  | { tipo: 'ok'; version: number; resultado?: Resultado | null }
  | { tipo: 'desfasado'; jugadas: Jugada[]; version: number }
  | { tipo: 'terminado'; motivo: 'terminado' | 'cargado_en_mesa'; resultado: Resultado | null; jugadas?: Jugada[]; version?: number }
  | { tipo: 'red' }
  | { tipo: 'bloqueado'; mensaje: string }
  | { tipo: 'codigo'; mensaje: string } // código inválido o dado de baja: no reintentar solo
  | { tipo: 'error'; mensaje: string }; // la base rechazó lo enviado

export type Aviso =
  | { tipo: 'traido' }
  | { tipo: 'descartado'; cantidad: number; respaldo: Jugada[] }
  | { tipo: 'bloqueado'; mensaje: string }
  | { tipo: 'codigo'; mensaje: string }
  | { tipo: 'error'; mensaje: string };

const firmaFormato = (f: FormatoArbitraje | undefined) => (f ? `:${f.tipo}-${f.a}-${f.mejorDe}` : '');
const firmaJugada = (j: Jugada): string =>
  j.t === 'inicio' ? `i${j.saca}${j.derechaA}${j.derechaB}${firmaFormato(j.formato)}` : j.t === 'rally' ? `r${j.gana}` : `t${j.equipo}`;

/** Firma canónica de una lista (el servidor devuelve el JSON con las claves en otro orden). */
export const firma = (jugadas: Jugada[]): string => jugadas.map(firmaJugada).join('|');
export const iguales = (a: Jugada[], b: Jugada[]) => a.length === b.length && firma(a) === firma(b);
/** ¿`corto` es el comienzo de `largo`? */
export function esComienzo(corto: Jugada[], largo: Jugada[]): boolean {
  if (corto.length > largo.length) return false;
  for (let i = 0; i < corto.length; i++) if (firmaJugada(corto[i]) !== firmaJugada(largo[i])) return false;
  return true;
}
function comunAlPrincipio(a: Jugada[], b: Jugada[]): number {
  let i = 0;
  while (i < a.length && i < b.length && firmaJugada(a[i]) === firmaJugada(b[i])) i++;
  return i;
}

const MAX_ENVIADOS = 30;

export function colaNueva(jugadas: Jugada[], version: number): Cola {
  return { jugadas, subido: jugadas, version, enviados: [], enVuelo: null };
}

export function jugar(c: Cola, j: Jugada | 'deshacer'): Cola {
  return { ...c, jugadas: j === 'deshacer' ? c.jugadas.slice(0, -1) : [...c.jugadas, j] };
}

export const pendiente = (c: Cola) => !iguales(c.jugadas, c.subido);

/** Lo próximo para mandar (siempre lo último), o null si hay un envío en vuelo o no falta nada. */
export function proximoEnvio(c: Cola): { jugadas: Jugada[]; version: number } | null {
  if (c.enVuelo || !pendiente(c)) return null;
  return { jugadas: c.jugadas, version: c.version };
}

export function alEnviar(c: Cola, envio: { jugadas: Jugada[] }): Cola {
  return { ...c, enVuelo: envio.jugadas, enviados: [...c.enviados.filter((f) => f !== firma(envio.jugadas)), firma(envio.jugadas)].slice(-MAX_ENVIADOS) };
}

export function reconciliar(c: Cola, servidor: Jugada[], version: number): { cola: Cola; aviso: Aviso | null } {
  const L = c.jugadas;
  const base = { ...c, enVuelo: null, version };
  if (iguales(servidor, L)) return { cola: { ...base, subido: L }, aviso: null };
  const eco = iguales(servidor, c.subido) || c.enviados.includes(firma(servidor));
  if (eco || (esComienzo(servidor, L) && esComienzo(c.subido, servidor))) {
    return { cola: { ...base, subido: servidor }, aviso: null };
  }
  const traido = { ...base, jugadas: servidor, subido: servidor };
  if (esComienzo(L, servidor)) return { cola: traido, aviso: { tipo: 'traido' } };
  const quedanAfuera = L.length - comunAlPrincipio(L, servidor);
  return { cola: traido, aviso: { tipo: 'descartado', cantidad: quedanAfuera, respaldo: L } };
}

export type Siguiente = 'seguir' | 'esperar' | 'parar' | 'terminado';

/** Qué hacer con la respuesta a un envío de la cola. */
export function alResponder(c: Cola, envio: { jugadas: Jugada[] }, r: Respuesta): { cola: Cola; aviso: Aviso | null; siguiente: Siguiente } {
  const libre = { ...c, enVuelo: null };
  switch (r.tipo) {
    case 'ok':
      return { cola: { ...libre, subido: envio.jugadas, version: r.version }, aviso: null, siguiente: 'seguir' };
    case 'desfasado': {
      const s = reconciliar(c, r.jugadas, r.version);
      return { ...s, siguiente: 'seguir' };
    }
    case 'terminado':
      return { cola: libre, aviso: null, siguiente: 'terminado' };
    case 'red':
      return { cola: libre, aviso: null, siguiente: 'esperar' };
    case 'bloqueado':
      return { cola: libre, aviso: { tipo: 'bloqueado', mensaje: r.mensaje }, siguiente: 'esperar' };
    case 'codigo':
      return { cola: libre, aviso: { tipo: 'codigo', mensaje: r.mensaje }, siguiente: 'parar' };
    case 'error':
      return { cola: libre, aviso: { tipo: 'error', mensaje: r.mensaje }, siguiente: 'parar' };
  }
}

/** Lo guardado en el teléfono contra lo que devuelve el servidor al (re)entrar. */
export function alEntrar(local: Pick<Cola, 'jugadas' | 'subido' | 'version' | 'enviados'> | null, servidor: Jugada[], version: number): { cola: Cola; aviso: Aviso | null } {
  if (!local) return { cola: colaNueva(servidor, version), aviso: null };
  const c: Cola = { ...local, enVuelo: null };
  if (local.version === version && iguales(servidor, local.subido)) return { cola: c, aviso: null };
  return reconciliar(c, servidor, version);
}

/** Lo guardado por la versión anterior de la pantalla ({jugadas, version, pendiente}) o por esta. */
export function colaGuardada(x: unknown): Pick<Cola, 'jugadas' | 'subido' | 'version' | 'enviados'> | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.jugadas) || typeof o.version !== 'number') return null;
  const jugadas = o.jugadas as Jugada[];
  if (Array.isArray(o.subido)) {
    return { jugadas, subido: o.subido as Jugada[], version: o.version, enviados: Array.isArray(o.enviados) ? (o.enviados as string[]) : [] };
  }
  // Formato viejo: si no estaba pendiente, el servidor tenía exactamente eso; si no, no se sabe.
  return { jugadas, subido: o.pendiente ? [] : jugadas, version: o.version, enviados: [] };
}

// ---------------------------------------------------------------- respuestas de la base

const TEXTOS_CRUDOS = new Set(['desfasado', 'red', 'error', '']);

/** Nunca un texto técnico en pantalla. */
export function mensajeAmigable(error: unknown): string {
  const e = typeof error === 'string' ? error.trim() : '';
  if (TEXTOS_CRUDOS.has(e)) return 'No se pudo guardar en el servidor. Lo marcado sigue en el teléfono: probá de nuevo en un momento.';
  return e;
}

function resultadoDe(x: unknown): Resultado | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.puntosA !== 'number' || typeof o.puntosB !== 'number') return null;
  const r: Resultado = { puntosA: o.puntosA, puntosB: o.puntosB };
  if (Array.isArray(o.games)) r.games = o.games as { a: number; b: number }[];
  if (o.wo === true) r.wo = true;
  return r;
}

const ES_CODIGO = /c[oó]digo (ya no es v[aá]lido|incorrecto)|ya no se usa/i;

/**
 * Respuesta de arbitro_marcar / arbitro_terminar, sea de la base v36 (sin estado/motivo/bloqueado)
 * o de la v37. `error` = error de la llamada (sin señal, timeout).
 */
export function interpretar(data: unknown, error: unknown): Respuesta {
  if (error || !data || typeof data !== 'object') return { tipo: 'red' };
  const d = data as Record<string, unknown>;
  if (d.ok === true) return { tipo: 'ok', version: typeof d.version === 'number' ? d.version : -1, resultado: resultadoDe(d.resultado) };
  if (d.estado === 'terminado') {
    return {
      tipo: 'terminado', motivo: d.motivo === 'cargado_en_mesa' ? 'cargado_en_mesa' : 'terminado', resultado: resultadoDe(d.resultado),
      jugadas: Array.isArray(d.jugadas) ? (d.jugadas as Jugada[]) : undefined, version: typeof d.version === 'number' ? d.version : undefined,
    };
  }
  const msg = typeof d.error === 'string' ? d.error : '';
  if (d.bloqueado === true) return { tipo: 'bloqueado', mensaje: mensajeAmigable(msg) };
  if (msg === 'desfasado' && Array.isArray(d.jugadas) && typeof d.version === 'number') return { tipo: 'desfasado', jugadas: d.jugadas as Jugada[], version: d.version };
  if (d.baja === true || ES_CODIGO.test(msg)) return { tipo: 'codigo', mensaje: 'Este código ya no sirve para marcar. Avisá en la mesa de control: lo marcado quedó guardado en este teléfono.' };
  return { tipo: 'error', mensaje: mensajeAmigable(msg) };
}

export function textoAviso(a: Aviso): string {
  switch (a.tipo) {
    case 'traido':
      return 'Este partido se siguió marcando desde otro teléfono: se trajo lo último.';
    case 'descartado':
      return `Este partido también se marcó desde otro teléfono. Quedó lo que tiene el servidor (lo que ve la TV) y se dejaron de lado ${a.cantidad} ${a.cantidad === 1 ? 'jugada' : 'jugadas'} de este teléfono.`;
    default:
      return a.mensaje;
  }
}
