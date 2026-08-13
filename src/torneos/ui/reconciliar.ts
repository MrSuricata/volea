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
  const parejas = [...torneo.parejas];
  const pendientes = parejas.filter((p) => !(p.jugadorIds && p.jugadorIds.length > 0));
  // Sin nada que vincular se devuelve el MISMO objeto: el sync marca sucio por cambio
  // de referencia, y devolver una copia forzaba un push a Supabase al pedo.
  if (pendientes.length === 0) return { torneo, jugadores, cancelado: false };

  const individual = (torneo.formato ?? 'grupos') === 'individual';
  // Un torneo de SINGLES jugado con formato "grupos" (todos contra todos + final):
  // cada "pareja" es una persona sola. Antes, al no encontrar el " y ", se descartaba
  // el nombre real y se pedían DOS integrantes vacíos — por eso el SINGLES del 9/8 no
  // se podía vincular y el torneo nunca sumaba al ranking.
  // Se mira solo lo PENDIENTE: mirando todas las parejas, una sola ya vinculada con
  // " y " en el nombre apagaba la detección y volvía el problema.
  // Y no se asume: en un torneo de dobles pueden ser todos nombres de fantasía
  // ("Los Pumas"), y darlos de alta como personas ensucia el padrón y el ranking.
  let unaPersonaPorEntrada = individual;
  if (!individual && pendientes.every((p) => partesDeDobles(p.nombre).length === 1)) {
    unaPersonaPorEntrada = await dialogos.confirmar({
      titulo: 'Torneo de singles',
      mensaje: `Ninguno de los ${pendientes.length} nombres tiene compañero. ¿Es un torneo de singles, con una persona por entrada?`,
      textoConfirmar: 'Sí, es de singles',
    });
  }

  for (let i = 0; i < parejas.length; i++) {
    const p = parejas[i];
    if (p.jugadorIds && p.jugadorIds.length > 0) continue;
    let nombres: string[];
    if (unaPersonaPorEntrada) {
      nombres = [p.nombre];
    } else {
      const partes = partesDeDobles(p.nombre);
      if (partes.length === 2) {
        nombres = partes;
      } else {
        // Nombre de fantasía o con 3+ partes. Se pregunta UNA sola vez y se precarga
        // el nombre real: antes abría dos diálogos vacíos e idénticos y no se veía
        // qué se estaba corrigiendo.
        const pedido = await dialogos.pedirTexto({
          titulo: `Jugadores de "${p.nombre}"`,
          valorInicial: p.nombre,
          placeholder: 'Un jugador, o dos separados por " y "',
        });
        if (pedido === null) return { torneo, jugadores, cancelado: true };
        nombres = partesDeDobles(pedido);
        if (nombres.length === 0) return { torneo, jugadores, cancelado: true };
      }
    }
    const ids: string[] = [];
    for (const nom of nombres) {
      const nombreLimpio = nom.trim();
      if (!nombreLimpio) return { torneo, jugadores, cancelado: true };
      const id = await resolverNombre(nombreLimpio, ctx);
      if (id === null) return { torneo, jugadores, cancelado: true };
      // Sin repetidos: el mismo id dos veces en una pareja le paga los puntos DOS veces
      // (ranking.ts empuja un aporte por cada id de la pareja).
      if (!ids.includes(id)) ids.push(id);
    }
    parejas[i] = { ...p, jugadorIds: ids };
  }
  return { torneo: { ...torneo, parejas }, jugadores: ctx.jugadores, cancelado: false };
}
