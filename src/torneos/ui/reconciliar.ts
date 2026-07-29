import type { Jugador, Torneo } from '../engine/tipos';
import { agregarAlias, agregarJugador, buscarJugador } from '../engine/padron';
import type { Dialogos } from './dialogos';

const CLAVE_NUEVO = '__nuevo__';

type Ctx = { jugadores: Jugador[]; dialogos: Dialogos };

// Resuelve un nombre a un jugadorId, preguntando si hay duda. Devuelve el id, o null si se cancela.
async function resolverNombre(nombre: string, ctx: Ctx): Promise<string | null> {
  const b = buscarJugador(ctx.jugadores, nombre);
  if (b.tipo === 'exacto') return b.jugador.id;
  if (b.tipo === 'nuevo') {
    const alta = agregarJugador(ctx.jugadores, nombre);
    ctx.jugadores = alta.jugadores;
    return alta.jugador.id;
  }
  const opciones = [
    ...b.candidatos.slice(0, 4).map((j) => ({
      clave: j.id,
      etiqueta: j.nombre,
      ayuda: j.alias?.length ? `alias: ${j.alias.join(', ')}` : undefined,
    })),
    { clave: CLAVE_NUEVO, etiqueta: `Es un jugador nuevo ("${nombre}")` },
  ];
  const elegido = await ctx.dialogos.elegirDeLista({
    titulo: 'Vincular jugador',
    mensaje: `"${nombre}" se parece a alguien del padrón. ¿Quién es?`,
    opciones,
    textoConfirmar: 'Vincular',
  });
  if (elegido === null) return null;
  if (elegido === CLAVE_NUEVO) {
    const alta = agregarJugador(ctx.jugadores, nombre);
    ctx.jugadores = alta.jugadores;
    return alta.jugador.id;
  }
  ctx.jugadores = agregarAlias(ctx.jugadores, elegido, nombre); // recuerda el alias para no repreguntar
  return elegido;
}

function partesDeDobles(nombre: string): string[] {
  return nombre.split(/\s+y\s+/i).map((s) => s.trim()).filter(Boolean);
}

export type ResultadoReconciliar = { torneo: Torneo; jugadores: Jugador[]; cancelado: boolean };

// Vincula las parejas sin jugadorIds al padron. Devuelve copias (no muta el estado).
export async function reconciliarTorneo(torneo: Torneo, jugadores: Jugador[], dialogos: Dialogos): Promise<ResultadoReconciliar> {
  const ctx: Ctx = { jugadores: [...jugadores], dialogos };
  const individual = (torneo.formato ?? 'grupos') === 'individual';
  const parejas = [...torneo.parejas];
  for (let i = 0; i < parejas.length; i++) {
    const p = parejas[i];
    if (p.jugadorIds && p.jugadorIds.length > 0) continue;
    let nombres: string[];
    if (individual) {
      nombres = [p.nombre];
    } else {
      const partes = partesDeDobles(p.nombre);
      nombres = partes.length === 2 ? partes : ['', ''];
    }
    const ids: string[] = [];
    for (const nom of nombres) {
      let nombreLimpio = nom.trim();
      if (!nombreLimpio) {
        const pedido = await dialogos.pedirTexto({ titulo: `Integrante de "${p.nombre}"`, placeholder: 'Nombre del jugador' });
        nombreLimpio = pedido?.trim() ?? '';
      }
      if (!nombreLimpio) return { torneo, jugadores, cancelado: true };
      const id = await resolverNombre(nombreLimpio, ctx);
      if (id === null) return { torneo, jugadores, cancelado: true };
      ids.push(id);
    }
    parejas[i] = { ...p, jugadorIds: ids };
  }
  return { torneo: { ...torneo, parejas }, jugadores: ctx.jugadores, cancelado: false };
}
