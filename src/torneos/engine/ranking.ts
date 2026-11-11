import type { ConfigPuntos, Escalon, PartidoLlave, Torneo, Jugador } from './tipos';
import { ESCALONES } from './tipos';
import { campeonDe, ganadorPartido, resolverSlot } from './llave';
import { calcularTabla, calcularTablaIndividual } from './tabla';

export function puntosDe(escalon: Escalon, categoria: 'A' | 'B', config: ConfigPuntos): number {
  const idx = ESCALONES.indexOf(escalon);
  if (idx < 0) return config.escalera[config.escalera.length - 1]; // escalon desconocido => piso
  const off = categoria === 'B' ? config.offsetB : 0;
  return config.escalera[Math.min(idx + off, config.escalera.length - 1)];
}

// distancia a la final => escalon (0 = perdio la final)
function escalonPorDistancia(d: number): Escalon {
  if (d === 0) return 'FINALISTA';
  if (d === 1) return 'SEMI';
  if (d === 2) return 'CUARTOS';
  if (d === 3) return 'OCTAVOS';
  return 'PARTICIPO';
}

// Escalon de una pareja segun hasta donde llego en la llave. Asume una llave TERMINADA
// (el llamador debe filtrar por torneo terminado; en una llave a medias sub-valora).
export function escalonEnLlave(partidos: PartidoLlave[], parejaId: string): Escalon {
  if (campeonDe(partidos) === parejaId) return 'CAMPEON';
  const reales = partidos.filter((p) => !p.esTercerPuesto);
  const maxRonda = Math.max(...reales.map((p) => p.ronda));
  let peor: number | null = null; // ronda mas alta donde perdio
  for (const p of reales) {
    const a = resolverSlot(p.a, partidos);
    const b = resolverSlot(p.b, partidos);
    if (a !== parejaId && b !== parejaId) continue;
    const g = ganadorPartido(p, partidos);
    if (g === null || g === parejaId) continue; // sin resultado o lo gano
    peor = peor === null ? p.ronda : Math.max(peor, p.ronda);
  }
  if (peor === null) return 'PARTICIPO';
  return escalonPorDistancia(maxRonda - peor);
}

export function escalonDePareja(torneo: Torneo, parejaId: string): Escalon {
  if (torneo.partidosLlave && torneo.partidosLlave.length > 0) {
    return escalonEnLlave(torneo.partidosLlave, parejaId);
  }
  // sin llave: solo tiene sentido "campeon" en grupo unico terminado
  if (torneo.formato !== 'individual' && torneo.grupos.length === 1) {
    const tabla = calcularTabla(torneo.grupos[0].parejaIds, torneo.partidosGrupo);
    const pos = tabla.find((f) => f.parejaId === parejaId)?.posicion;
    if (pos === 1) return 'CAMPEON';
    if (pos === 2) return 'FINALISTA';
  }
  return 'PARTICIPO';
}

export function torneoAporta(t: Torneo): boolean {
  return t.fase === 'terminado' && t.cuentaParaRanking !== false && (t.categoria === 'A' || t.categoria === 'B');
}

export type AporteRanking = {
  torneoId: string;
  torneoNombre: string;
  categoria: 'A' | 'B';
  escalon: Escalon;
  puntos: number;
  descartadoPorEvento?: boolean; // otro torneo del mismo evento (o del mismo cuadro con copas) paga mas: este no suma (se muestra igual en el detalle)
};
export type FilaRanking = { jugadorId: string; nombre: string; puntos: number; torneosJugados: number; aportes: AporteRanking[] };

// Quién cobra qué en un torneo: un escalón por jugador.
function escalonesDeJugadores(t: Torneo): { jugadorId: string; nombre: string; escalon: Escalon }[] {
  // Americano individual sin llave: la tabla es por jugador (cada uno juega con varias duplas);
  // por dupla le pagaría una vez por cada compañero.
  if (t.americanoIndividual && !(t.partidosLlave && t.partidosLlave.length > 0)) {
    return calcularTablaIndividual(t.parejas, t.partidosGrupo).map((f) => ({
      jugadorId: f.jugadorId, nombre: f.nombre,
      escalon: f.posicion === 1 ? 'CAMPEON' : f.posicion === 2 ? 'FINALISTA' : 'PARTICIPO',
    }));
  }
  const out: { jugadorId: string; nombre: string; escalon: Escalon }[] = [];
  for (const pareja of t.parejas) {
    const ids = pareja.jugadorIds;
    if (!ids || ids.length === 0) continue;
    const escalon = escalonDePareja(t, pareja.id);
    for (const jid of ids) out.push({ jugadorId: jid, nombre: pareja.nombre, escalon });
  }
  return out;
}

// Torneos que aportan, ordenados por puntos. filtro por creadoEl (ISO, comparacion lexicografica).
// Reglas de suma: en individuales, PARTICIPO no paga (solo pagan las instancias de llave);
// y entre torneos de PAREJAS que comparten `evento`, al jugador le cuenta solo el mejor.
// Copas sin evento: el cuadro de grupos y sus Copas de Oro/Plata (copaDe) son UN torneo para el
// ranking: al jugador le cuenta solo su mejor escalón entre ellos (el de la copa si la copa paga;
// si no, el "participó" del cuadro), igual que si compartieran evento.
export function calcularRanking(
  torneos: Torneo[],
  jugadores: Jugador[],
  config: ConfigPuntos,
  filtro?: { desde?: string; hasta?: string },
): FilaRanking[] {
  const nombreDe = new Map(jugadores.map((j) => [j.id, j.nombre]));
  const porJugador = new Map<string, FilaRanking>();
  // cuadros de los que salieron copas (aunque se les haya sacado la bandera `copas` después)
  const cuadrosConCopas = new Set(torneos.map((t) => t.copaDe).filter((x): x is string => typeof x === 'string'));
  // "familia" por torneo: los de la misma familia pagan una sola vez por jugador (el mejor).
  // Solo parejas (los individuales quedan siempre fuera del "max por evento").
  const familiaDe = new Map<string, string>();
  for (const t of torneos) {
    if (!torneoAporta(t)) continue;
    if (filtro?.desde && t.creadoEl < filtro.desde) continue;
    if (filtro?.hasta && t.creadoEl > filtro.hasta) continue;
    const categoria = t.categoria as 'A' | 'B';
    const individual = (t.formato ?? 'grupos') === 'individual';
    // clave normalizada (trim + minusculas): "Sabado " y "sabado" son el MISMO evento — un typo
    // de mayusculas no puede duplicar puntos en silencio. typeof: un import editado a mano con
    // evento no-string se ignora en vez de tirar la pantalla abajo. La UI muestra el texto crudo.
    const evento = individual || typeof t.evento !== 'string' ? undefined : t.evento.trim().toLowerCase() || undefined;
    const copa = individual ? undefined : typeof t.copaDe === 'string' ? t.copaDe : cuadrosConCopas.has(t.id) ? t.id : undefined;
    if (evento) familiaDe.set(t.id, `evento:${evento}`);
    else if (copa) familiaDe.set(t.id, `copas:${copa}`);
    for (const { jugadorId: jid, nombre, escalon } of escalonesDeJugadores(t)) {
      const puntos = individual && escalon === 'PARTICIPO' ? 0 : puntosDe(escalon, categoria, config);
      let fila = porJugador.get(jid);
      if (!fila) {
        fila = { jugadorId: jid, nombre: nombreDe.get(jid) ?? nombre, puntos: 0, torneosJugados: 0, aportes: [] };
        porJugador.set(jid, fila);
      }
      // copia por jugador: descartadoPorEvento se decide fila por fila (los companieros
      // de pareja pueden tener eventos distintos entre si por sus OTROS torneos)
      fila.aportes.push({ torneoId: t.id, torneoNombre: t.nombre, categoria, escalon, puntos });
    }
  }
  const filas = [...porJugador.values()];
  for (const f of filas) {
    // max por evento: de los aportes de parejas que comparten evento, cuenta solo el mejor
    const mejorPorEvento = new Map<string, AporteRanking>();
    for (const a of f.aportes) {
      const evento = familiaDe.get(a.torneoId);
      if (!evento) continue;
      const actual = mejorPorEvento.get(evento);
      // empate de puntos (ej. campeon B = finalista A con el default): queda el mejor escalon,
      // para que el detalle no muestre un "Campeon" tachado mientras cuenta un "Finalista"
      const gana = !actual
        || a.puntos > actual.puntos
        || (a.puntos === actual.puntos && ESCALONES.indexOf(a.escalon) < ESCALONES.indexOf(actual.escalon));
      if (gana) mejorPorEvento.set(evento, a);
    }
    for (const a of f.aportes) {
      const evento = familiaDe.get(a.torneoId);
      if (evento && mejorPorEvento.get(evento) !== a) a.descartadoPorEvento = true;
    }
    f.puntos = f.aportes.reduce((s, a) => s + (a.descartadoPorEvento ? 0 : a.puntos), 0);
    f.torneosJugados = new Set(f.aportes.map((a) => a.torneoId)).size;
  }
  filas.sort((a, b) => b.puntos - a.puntos || b.torneosJugados - a.torneosJugados || a.nombre.localeCompare(b.nombre));
  return filas;
}

// Fusiona dos personas del padron: el absorbido desaparece y sus nombres pasan a alias del que queda.
export function unirJugadores(jugadores: Jugador[], idQueda: string, idAbsorbido: string): Jugador[] {
  if (idQueda === idAbsorbido) return jugadores;
  const abs = jugadores.find((j) => j.id === idAbsorbido);
  if (!abs) return jugadores;
  return jugadores
    .filter((j) => j.id !== idAbsorbido)
    .map((j) =>
      j.id === idQueda
        ? { ...j, alias: [...new Set([...(j.alias ?? []), abs.nombre, ...(abs.alias ?? [])])] }
        : j,
    );
}

// Reescribe un jugadorId por otro en todas las parejas (para cuando se fusionan personas).
// Preserva la referencia de los torneos no afectados (ninguna pareja con deId): el sync
// local-first marca "sucio" por cambio de referencia, asi que tocar TODOS los torneos por
// una fusion de jugadores en uno solo forzaria un push de todo el padron de torneos.
export function reasignarJugador(torneos: Torneo[], deId: string, aId: string): Torneo[] {
  return torneos.map((t) => {
    if (!t.parejas.some((p) => p.jugadorIds && p.jugadorIds.includes(deId))) return t; // sin cambios: misma referencia
    return {
      ...t,
      parejas: t.parejas.map((p) =>
        p.jugadorIds && p.jugadorIds.includes(deId)
          ? { ...p, jugadorIds: p.jugadorIds.map((id) => (id === deId ? aId : id)) }
          : p,
      ),
    };
  });
}
