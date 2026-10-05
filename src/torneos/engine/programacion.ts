// Reparto de los partidos de un día en canchas y horarios, mezclando categorías.
//
// La regla: cada vez que una cancha se libera entra el mejor partido que se pueda jugar en
// ese momento, sea de la categoría que sea. Así ninguna cancha queda parada mientras haya
// algo para jugar (el reparto anterior iba categoría por categoría y dejaba huecos: un grupo
// de 3 ocupaba "media cancha" durante una hora).
//
// Un partido se puede jugar cuando llegó su hora (`noAntes`), terminaron los que tienen que
// jugarse antes (`despuesDe`) y nadie de los que lo juegan está en otra cancha. Entre los que
// se pueden jugar pasa primero el que viene colgado de otro día; después el que no tiene a
// nadie recién salido de la cancha; después el de la categoría que va primero en el día
// (`prioridad`) y, dentro de ella, la etapa más temprana (`nivel`).
//
// En la práctica eso hace que dos categorías se vayan alternando (mientras una descansa
// juega la otra), que cada categoría termine apenas puede en vez de esperar al final de la
// noche, y que la siguiente vaya entrando sola en los lugares que quedan.

/** Un partido pendiente que hay que ubicar. El orden de la lista desempata. */
export type PartidoAProgramar = {
  id: string;
  /** Personas que lo juegan, como claves comparables. Vacío si todavía no se sabe quién juega. */
  jugadores: string[];
  /** Partidos que tienen que terminar antes. Los que no están en la lista ni en juego se dan por terminados. */
  despuesDe: string[];
  /** No puede empezar antes de este minuto. */
  noAntes: number;
  /** Lugar de su categoría en el orden del día: a menor número, antes se juega. */
  prioridad: number;
  /** Etapas que le quedan a su categoría contando esta (final = 1). Dentro de una categoría, a mayor nivel, antes. */
  nivel: number;
  /** Quedó colgado de un día anterior: pasa primero. */
  urgente?: boolean;
};

export type CanchaDisponible = { nombre: string; libreDesde: number };

export type OpcionesReparto = {
  /** Minutos que ocupa cada partido en la cancha. */
  duracion: number;
  /** Aire que se le intenta dar a quien acaba de jugar (no deja una cancha vacía por esto). Por defecto, un partido. */
  descanso?: number;
  /** Lo que ya está jugándose: ocupa a sus jugadores y destraba lo que depende de él cuando termina. */
  enJuego?: { id: string; jugadores: string[]; termina: number }[];
  /** Ventanas en las que no se usa ninguna cancha (por ejemplo el One Point Challenge). */
  bloqueos?: { desde: number; hasta: number }[];
};

export type TurnoProgramado = { id: string; cancha: string; inicio: number; fin: number };

export type Reparto = {
  turnos: TurnoProgramado[];
  /** Partidos que no se pudieron ubicar porque esperan a otro que nunca termina. */
  sinLugar: string[];
};

export function repartirEnCanchas(
  partidos: PartidoAProgramar[],
  canchas: CanchaDisponible[],
  opciones: OpcionesReparto,
): Reparto {
  const { duracion } = opciones;
  if (!(duracion > 0)) throw new Error(`duración de partido inválida: ${duracion}`);
  if (canchas.length === 0) return { turnos: [], sinLugar: partidos.map((p) => p.id) };
  const descanso = opciones.descanso ?? duracion;
  const bloqueos = opciones.bloqueos ?? [];

  const libre = canchas.map((c) => c.libreDesde);
  const termina = new Map<string, number>();
  const jugadorLibre = new Map<string, number>();
  for (const e of opciones.enJuego ?? []) {
    termina.set(e.id, e.termina);
    for (const j of e.jugadores) jugadorLibre.set(j, Math.max(jugadorLibre.get(j) ?? -Infinity, e.termina));
  }

  const pendientes = partidos.map((p, orden) => ({ ...p, orden }));
  const faltan = new Set(pendientes.map((p) => p.id));
  const turnos: TurnoProgramado[] = [];

  while (pendientes.length > 0) {
    const t = Math.min(...libre);

    // Si el partido pisaría una ventana bloqueada, esa cancha recién sirve cuando termina.
    const bloqueo = bloqueos.find((b) => t < b.hasta && t + duracion > b.desde);
    if (bloqueo) {
      for (let i = 0; i < libre.length; i++) {
        if (libre[i] < bloqueo.hasta && libre[i] + duracion > bloqueo.desde) libre[i] = bloqueo.hasta;
      }
      continue;
    }

    const listos = pendientes.filter((p) =>
      p.noAntes <= t
      && p.despuesDe.every((d) => !faltan.has(d) && (termina.get(d) ?? -Infinity) <= t)
      && p.jugadores.every((j) => (jugadorLibre.get(j) ?? -Infinity) <= t));

    if (listos.length === 0) {
      // Nada se puede jugar ahora: la cancha espera hasta que algo cambie (termina un
      // partido, llega la hora de una categoría).
      const cambios = [
        ...libre,
        ...termina.values(),
        ...jugadorLibre.values(),
        ...pendientes.map((p) => p.noAntes),
      ].filter((x) => x > t);
      if (cambios.length === 0) break; // lo que queda espera a algo que no va a pasar
      const proximo = Math.min(...cambios);
      for (let i = 0; i < libre.length; i++) if (libre[i] <= t) libre[i] = proximo;
      continue;
    }

    // Quien juega una final sale de las semis: aunque todavía no se sepa quién es, el aire
    // se cuenta también desde los partidos que este espera.
    const descansado = (p: PartidoAProgramar) =>
      p.jugadores.every((j) => (jugadorLibre.get(j) ?? -Infinity) + descanso <= t)
      && p.despuesDe.every((d) => (termina.get(d) ?? -Infinity) + descanso <= t);
    listos.sort((x, y) =>
      Number(!!y.urgente) - Number(!!x.urgente)
      || Number(descansado(y)) - Number(descansado(x))
      || x.prioridad - y.prioridad
      || y.nivel - x.nivel
      || x.orden - y.orden);
    const elegido = listos[0];

    const cancha = libre.indexOf(t);
    const fin = t + duracion;
    turnos.push({ id: elegido.id, cancha: canchas[cancha].nombre, inicio: t, fin });
    libre[cancha] = fin;
    termina.set(elegido.id, fin);
    for (const j of elegido.jugadores) jugadorLibre.set(j, fin);
    faltan.delete(elegido.id);
    pendientes.splice(pendientes.indexOf(elegido), 1);
  }

  return { turnos, sinLugar: pendientes.map((p) => p.id) };
}
