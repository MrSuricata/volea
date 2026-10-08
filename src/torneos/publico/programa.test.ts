import { describe, expect, it } from 'vitest';
import type { PartidoGrupo, PartidoLlave, Torneo } from '../engine/tipos';
import {
  PROGRAMA, aHora, aMinuto, aplicarAjustes, armarCategoria, categoriasDelEvento, minutoDesde, momentoDeTorneo,
  personasDe, programarEvento,
} from './programa';
import type { CatProg, Fila } from './programa';

// ─── Armado de cuadros de prueba ─────────────────────────────────────────────

const pareja = (id: string, nombre: string) => ({ id, nombre });

function torneo(nombre: string, parejas: string[], extra: Partial<Torneo> = {}): Torneo {
  return {
    id: nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    nombre,
    creadoEl: '2026-10-08T20:00:00.000Z',
    fase: 'faseGrupos',
    parejas: parejas.map((n, i) => pareja(`p${i + 1}`, n)),
    grupos: [],
    partidosGrupo: [],
    configLlave: null,
    partidosLlave: null,
    ...extra,
  };
}

const pg = (id: string, ronda: number, aId: string, bId: string, puntos?: [number, number], extra: Partial<PartidoGrupo> = {}): PartidoGrupo => ({
  id, grupoId: 'gA', ronda, aId, bId, puntosA: puntos ? puntos[0] : null, puntosB: puntos ? puntos[1] : null, ...extra,
});

// Un grupo de 4 con el fixture ya generado: 3 rondas de 2 partidos.
function conGrupoDe4(nombre: string, gente: string[], resultados: Record<string, [number, number]> = {}): Torneo {
  return torneo(nombre, gente, {
    grupos: [{ id: 'gA', nombre: 'A', parejaIds: ['p1', 'p2', 'p3', 'p4'] }],
    partidosGrupo: [
      pg('r1a', 1, 'p1', 'p4', resultados.r1a), pg('r1b', 1, 'p2', 'p3', resultados.r1b),
      pg('r2a', 2, 'p1', 'p3', resultados.r2a), pg('r2b', 2, 'p4', 'p2', resultados.r2b),
      pg('r3a', 3, 'p1', 'p2', resultados.r3a), pg('r3b', 3, 'p3', 'p4', resultados.r3b),
    ],
  });
}

const VIGENTE = aplicarAjustes(PROGRAMA, null);
const DOS = { activas: ['Cancha 1', 'Cancha 2'], enJuego: [] };
const ANTES = { dia: null, minuto: 0 };

const cat = (t: Torneo, ajustes = VIGENTE): CatProg =>
  armarCategoria(t, { corto: PROGRAMA.nombreCorto(t.nombre), ...ajustes.categoria(t.id, t.nombre) });

const linea = (f: Fila) => `${f.dia} ${aHora(f.ini)} ${f.cancha.replace('Cancha ', 'C')} ${f.categoria} ${f.fase}: ${f.a} vs ${f.b}`;

// ─── El programa del aniversario ─────────────────────────────────────────────

describe('PROGRAMA del aniversario', () => {
  it('reconoce los cuadros del evento por el nombre o por la etiqueta de evento', () => {
    expect(PROGRAMA.esDelEvento({ nombre: 'SINGLES FEMENINO ANIVERSARIO' })).toBe(true);
    expect(PROGRAMA.esDelEvento({ nombre: 'DOBLE MIXTO A', evento: 'Aniversario Pickleball City · 9-10 oct' })).toBe(true);
    expect(PROGRAMA.esDelEvento({ nombre: 'MASCULINO A RACKET ROLL', evento: 'VOLEA Racket Roll · 22-23 ago' })).toBe(false);
  });

  it('saca el nombre del evento para el chip de la categoría', () => {
    expect(PROGRAMA.nombreCorto('SINGLES MASCULINO A ANIVERSARIO')).toBe('SINGLES MASCULINO A');
    expect(PROGRAMA.nombreCorto('Aniversario Pickleball City - Doble Mixto +50')).toBe('Doble Mixto +50');
    expect(PROGRAMA.nombreCorto('DOBLE FEMENINO')).toBe('DOBLE FEMENINO');
    expect(PROGRAMA.nombreCorto('ANIVERSARIO')).toBe('ANIVERSARIO');
  });

  it('los singles van el viernes y todo lo demás el sábado', () => {
    expect(PROGRAMA.diaDe('SINGLES +50 ANIVERSARIO')).toBe('VIE');
    expect(PROGRAMA.diaDe('SINGLES FEMENINO ANIVERSARIO')).toBe('VIE');
    expect(PROGRAMA.diaDe('DOBLE MASCULINO +50 ANIVERSARIO')).toBe('SAB');
  });

  it('dos canchas, 20 minutos, viernes 19:00 y sábado 10:00', () => {
    expect(VIGENTE.duracion).toBe(20);
    expect(PROGRAMA.canchas).toEqual(['Cancha 1', 'Cancha 2']);
    expect(VIGENTE.dias.map((d) => `${d.clave} ${aHora(d.inicio)}`)).toEqual(['VIE 19:00', 'SAB 10:00']);
  });
});

describe('aplicarAjustes', () => {
  it('lo que se cambia desde la pantalla pisa el programa', () => {
    const v = aplicarAjustes(PROGRAMA, {
      duracion: 25,
      inicios: { VIE: 18 * 60 + 30 },
      categorias: { t1: { dia: 'VIE', noAntes: 20 * 60 } },
      bloque: { dia: 'SAB', desde: 18 * 60, hasta: 19 * 60 + 30, titulo: 'ONE POINT CHALLENGE', detalle: 'x' },
    });
    expect(v.duracion).toBe(25);
    expect(v.dias.map((d) => aHora(d.inicio))).toEqual(['18:30', '10:00']);
    expect(v.categoria('t1', 'DOBLE MIXTO A ANIVERSARIO')).toEqual({ dia: 'VIE', orden: null, noAntes: 1200 });
    expect(v.categoria('otro', 'DOBLE MIXTO A ANIVERSARIO')).toEqual({ dia: 'SAB', orden: null, noAntes: null });
    expect(v.bloque?.desde).toBe(1080);
  });

  it('ignora lo que venga roto y se queda con el programa', () => {
    const roto = { duracion: 0, inicios: { VIE: -5, SAB: 'diez' }, categorias: { t1: { dia: 'LUN', orden: 'x', noAntes: 99999 } }, bloque: { dia: 'SAB', desde: 600, hasta: 500 } };
    const v = aplicarAjustes(PROGRAMA, roto as never);
    expect(v.duracion).toBe(20);
    expect(v.dias.map((d) => d.inicio)).toEqual([1140, 600]);
    expect(v.categoria('t1', 'SINGLES FEMENINO ANIVERSARIO')).toEqual({ dia: 'VIE', orden: null, noAntes: null });
    expect(v.bloque).toBeNull();
  });
});

describe('horas', () => {
  it('la madrugada sigue siendo la noche del torneo', () => {
    expect(momentoDeTorneo(new Date(2026, 9, 9, 23, 50), PROGRAMA.dias)).toEqual({ fecha: '2026-10-09', dia: 'VIE', minuto: 1430 });
    expect(momentoDeTorneo(new Date(2026, 9, 10, 0, 40), PROGRAMA.dias)).toEqual({ fecha: '2026-10-09', dia: 'VIE', minuto: 1480 });
    expect(momentoDeTorneo(new Date(2026, 9, 10, 9, 0), PROGRAMA.dias)).toEqual({ fecha: '2026-10-10', dia: 'SAB', minuto: 540 });
    expect(momentoDeTorneo(new Date(2026, 9, 8, 21, 0), PROGRAMA.dias).dia).toBeNull();
  });

  it('pasa de hora escrita a minuto y vuelve', () => {
    expect(aMinuto('19:30')).toBe(1170);
    expect(aMinuto('00:30')).toBe(1470);
    expect(aHora(1470)).toBe('00:30');
    expect(aMinuto('25:00')).toBeNull();
    expect(aMinuto('')).toBeNull();
  });

  it('cuenta los minutos de un instante desde el comienzo del día de torneo', () => {
    expect(minutoDesde('2026-10-09', new Date(2026, 9, 9, 19, 30))).toBe(1170);
    expect(minutoDesde('2026-10-09', new Date(2026, 9, 10, 0, 10))).toBe(1450);
    expect(minutoDesde('2026-10-09', new Date(2026, 9, 8, 23, 0))).toBeLessThan(0);
  });
});

// ─── De un cuadro a lo que falta ─────────────────────────────────────────────

describe('armarCategoria', () => {
  it('separa lo jugado de lo pendiente y proyecta la final', () => {
    const t = conGrupoDe4('SINGLES FEMENINO ANIVERSARIO', ['ANA', 'BEA', 'CARO', 'DANI'], { r1a: [11, 4], r1b: [0, 11] });
    t.partidosGrupo[1].wo = true;
    const c = cat(t);
    expect(c.corto).toBe('SINGLES FEMENINO');
    expect(c.dia).toBe('VIE');
    expect([c.jugados, c.total]).toEqual([2, 7]); // 6 de grupo + la final proyectada
    expect(c.resultados.map((r) => `${r.a} ${r.pa}-${r.pb} ${r.b}${r.wo ? ' W.O.' : ''}`)).toEqual(['BEA 0-11 CARO W.O.', 'ANA 11-4 DANI']);
    expect(c.pendientes.map((p) => `${p.fase} ${p.a}-${p.b} n${p.nivel}${p.listo ? '' : ' (proyectado)'}`)).toEqual([
      'Grupo A ANA-CARO n3', 'Grupo A DANI-BEA n3',
      'Grupo A ANA-BEA n2', 'Grupo A CARO-DANI n2',
      'FINAL 1° de la liga-2° de la liga n1 (proyectado)',
    ]);
    // la final espera a todo lo que queda del grupo
    expect(c.pendientes.at(-1)!.despuesDe).toEqual(['r2a', 'r2b', 'r3a', 'r3b'].map((id) => `${t.id}:${id}`));
    expect(c.pendientes[0]).toMatchObject({ clave: `${t.id}:r2a`, partidoId: 'r2a', tipo: 'grupo', jugadores: ['ana', 'caro'] });
  });

  it('sin sortear proyecta la cantidad de partidos por la cantidad de anotados', () => {
    const cinco = cat(torneo('SINGLES MASCULINO B ANIVERSARIO', ['A', 'B', 'C', 'D', 'E'], { fase: 'parejas' }));
    expect(cinco.total).toBe(11); // todos contra todos de 5 (10) + final
    expect(cinco.pendientes[0].a).toMatch(/^Jugador \d$/);
    expect(cinco.pendientes[0].listo).toBe(false);
    const ocho = cat(torneo('DOBLE MIXTO B ANIVERSARIO', Array.from({ length: 8 }, (_, i) => `D${i}`), { fase: 'parejas' }));
    expect(ocho.total).toBe(15); // dos grupos de 4 (12) + semis + final
    expect(ocho.pendientes[0].a).toMatch(/^Dupla \d$/);
    expect(cat(torneo('DOBLE FEMENINO +50 ANIVERSARIO', ['UNA SOLA'], { fase: 'parejas' })).total).toBe(0);
  });

  it('con los grupos sorteados ya pone los nombres aunque falte generar el fixture', () => {
    const t = torneo('SINGLES +50 ANIVERSARIO', ['OMAR', 'GUSTAVO', 'SHAI'], {
      fase: 'grupos', grupos: [{ id: 'gA', nombre: 'A', parejaIds: ['p1', 'p2', 'p3'] }],
    });
    const c = cat(t);
    expect(c.pendientes.filter((p) => p.fase === 'Grupo A').map((p) => `${p.a}-${p.b}`).sort()).toEqual(['GUSTAVO-SHAI', 'OMAR-GUSTAVO', 'OMAR-SHAI']);
    expect(c.pendientes[0].jugadores).toHaveLength(2);
    expect(c.pendientes.every((p) => !p.listo)).toBe(true);
  });

  it('en la llave armada cada partido espera a los que le dan sus jugadores', () => {
    const seed = (parejaId: string) => ({ tipo: 'seed' as const, parejaId });
    const ganador = (partidoId: string) => ({ tipo: 'ganadorDe' as const, partidoId });
    const perdedor = (partidoId: string) => ({ tipo: 'perdedorDe' as const, partidoId });
    const pl = (id: string, ronda: number, a: PartidoLlave['a'], b: PartidoLlave['b'], puntos?: [number, number], tercero = false): PartidoLlave => ({
      id, ronda, posicion: 0, a, b, puntosA: puntos ? puntos[0] : null, puntosB: puntos ? puntos[1] : null, esTercerPuesto: tercero,
    });
    const t = conGrupoDe4('DOBLE MASCULINO A ANIVERSARIO', ['ANA y BEA', 'CARO y DANI', 'ELI y FLOR', 'GABI y INES'], {
      r1a: [11, 1], r1b: [11, 2], r2a: [11, 3], r2b: [11, 4], r3a: [11, 5], r3b: [11, 6],
    });
    t.fase = 'llave';
    t.partidosLlave = [
      pl('sf1', 1, seed('p1'), seed('p4'), [11, 7]),
      pl('sf2', 1, seed('p2'), seed('p3')),
      pl('final', 2, ganador('sf1'), ganador('sf2')),
      pl('tercero', 2, perdedor('sf1'), perdedor('sf2'), undefined, true),
    ];
    const c = cat(t);
    expect(c.llaveArmada).toBe(true);
    expect(c.gruposCompletos).toBe(true);
    expect([c.jugados, c.total]).toEqual([7, 10]);
    expect(c.pendientes.map((p) => `${p.fase} ${p.a} vs ${p.b} n${p.nivel} espera[${p.despuesDe}] ${p.listo ? 'listo' : 'falta'}`)).toEqual([
      'SEMIS CARO y DANI vs ELI y FLOR n2 espera[] listo',
      `FINAL ANA y BEA vs Ganador ronda previa n1 espera[${t.id}:sf2] falta`,
      `3er PUESTO GABI y INES vs Perdedor ronda previa n1 espera[${t.id}:sf2] falta`,
    ]);
    // de la final ya se sabe un lado: esas dos personas quedan ocupadas
    expect(c.pendientes[1].jugadores).toEqual(['ana', 'bea']);
    expect(c.campeon).toBeNull();

    t.partidosLlave[1].puntosA = 11; t.partidosLlave[1].puntosB = 9;
    t.partidosLlave[2].puntosA = 8; t.partidosLlave[2].puntosB = 11;
    expect(cat(t).campeon).toBe('CARO y DANI');
  });

  it('un pase directo no es un partido: el que sigue no lo espera', () => {
    const t = torneo('DOBLE MIXTO A ANIVERSARIO', ['A y B', 'C y D', 'E y F'], {
      fase: 'llave',
      partidosLlave: [
        { id: 'bye', ronda: 1, posicion: 0, a: { tipo: 'seed', parejaId: 'p1' }, b: null, puntosA: null, puntosB: null, esTercerPuesto: false },
        { id: 'sf', ronda: 1, posicion: 1, a: { tipo: 'seed', parejaId: 'p2' }, b: { tipo: 'seed', parejaId: 'p3' }, puntosA: null, puntosB: null, esTercerPuesto: false },
        { id: 'final', ronda: 2, posicion: 0, a: { tipo: 'ganadorDe', partidoId: 'bye' }, b: { tipo: 'ganadorDe', partidoId: 'sf' }, puntosA: null, puntosB: null, esTercerPuesto: false },
      ],
    });
    const c = cat(t);
    expect(c.total).toBe(2);
    expect(c.pendientes.map((p) => `${p.partidoId} ${p.a} vs ${p.b} espera[${p.despuesDe}]`)).toEqual([
      'sf C y D vs E y F espera[]',
      `final A y B vs Ganador ronda previa espera[${t.id}:sf]`,
    ]);
  });

  it('una categoría cerrada sin llave no proyecta final', () => {
    const t = conGrupoDe4('SINGLES FEMENINO ANIVERSARIO', ['ANA', 'BEA', 'CARO', 'DANI'], {
      r1a: [11, 1], r1b: [11, 2], r2a: [11, 3], r2b: [11, 4], r3a: [11, 5], r3b: [11, 6],
    });
    t.fase = 'terminado';
    const c = cat(t);
    expect(c.pendientes).toEqual([]);
    expect([c.jugados, c.total, c.terminado]).toEqual([6, 6, true]);
  });

  it('separa las personas de una dupla para compararlas entre categorías', () => {
    expect(personasDe('GASTÓN MOIRANO y Paula Segura')).toEqual(['gaston moirano', 'paula segura']);
    expect(personasDe('FABIAN PERDOMO')).toEqual(['fabian perdomo']);
  });
});

describe('categoriasDelEvento', () => {
  it('toma solo los cuadros del evento y deja afuera el One Point Challenge', () => {
    const cats = categoriasDelEvento([
      conGrupoDe4('SINGLES FEMENINO ANIVERSARIO', ['ANA', 'BEA', 'CARO', 'DANI']),
      torneo('ONE POINT CHALLENGE ANIVERSARIO', ['A', 'B', 'C'], { formato: 'individual', fase: 'llave' }),
      conGrupoDe4('MASCULINO A RACKET ROLL', ['A y B', 'C y D', 'E y F', 'G y H']),
      { ...conGrupoDe4('DOBLE MIXTO A', ['A y B', 'C y D', 'E y F', 'G y H']), evento: 'Aniversario Pickleball City · 9-10 oct' },
    ], PROGRAMA, VIGENTE);
    expect(cats.map((c) => `${c.corto} ${c.dia}`)).toEqual(['DOBLE MIXTO A SAB', 'SINGLES FEMENINO VIE']);
  });
});

// ─── Horarios ────────────────────────────────────────────────────────────────

describe('programarEvento', () => {
  const femenino = () => conGrupoDe4('SINGLES FEMENINO ANIVERSARIO', ['PAULA', 'MATILDE', 'TATIANA', 'MIA']);
  const masculino = () => conGrupoDe4('SINGLES MASCULINO A ANIVERSARIO', ['GASTON', 'BRIAN', 'FABIAN', 'ENZO']);

  it('antes del torneo: el viernes arranca 19:00 con las dos canchas llenas y partidos cada 20 minutos', () => {
    const { filas, resumen } = programarEvento({ cats: [cat(femenino()), cat(masculino())], vigente: VIGENTE, ahora: ANTES, canchas: DOS });
    expect(filas.slice(0, 4).map(linea)).toEqual([
      'VIE 19:00 C1 SINGLES FEMENINO Grupo A: PAULA vs MIA',
      'VIE 19:00 C2 SINGLES FEMENINO Grupo A: MATILDE vs TATIANA',
      'VIE 19:20 C1 SINGLES MASCULINO A Grupo A: GASTON vs ENZO',
      'VIE 19:20 C2 SINGLES MASCULINO A Grupo A: BRIAN vs FABIAN',
    ]);
    // las dos categorías se alternan tanda a tanda: todas descansan 20 minutos entre partidos
    const tandas = [...new Set(filas.map((f) => f.ini))].map((ini) => filas.filter((f) => f.ini === ini).map((f) => f.categoria.split(' ')[1][0]).join(''));
    expect(tandas).toEqual(['FF', 'MM', 'FF', 'MM', 'FF', 'MM', 'FM']);
    // 14 partidos de a dos: 7 tandas sin una cancha vacía
    expect(resumen.VIE).toEqual({ partidos: 14, termina: 19 * 60 + 7 * 20 });
    expect(resumen.SAB).toEqual({ partidos: 0, termina: null });
  });

  it('el organizador puede cambiar el orden en que arrancan las categorías', () => {
    const fem = femenino();
    const masc = masculino();
    const vigente = aplicarAjustes(PROGRAMA, { categorias: { [masc.id]: { orden: 0 }, [fem.id]: { orden: 1 } } });
    const { filas } = programarEvento({ cats: [cat(fem, vigente), cat(masc, vigente)], vigente, ahora: ANTES, canchas: DOS });
    expect(filas.slice(0, 4).map((f) => f.categoria.split(' ')[1])).toEqual(['MASCULINO', 'MASCULINO', 'FEMENINO', 'FEMENINO']);
  });

  it('nadie queda citado en dos canchas a la misma hora aunque juegue dos categorías', () => {
    const b = conGrupoDe4('SINGLES MASCULINO B ANIVERSARIO', ['EMILIO', 'FABIAN', 'MAXI', 'MAURO']);
    const { filas } = programarEvento({ cats: [cat(masculino()), cat(b)], vigente: VIGENTE, ahora: ANTES, canchas: DOS });
    const deFabian = filas.filter((f) => f.a === 'FABIAN' || f.b === 'FABIAN').map((f) => f.ini);
    expect(deFabian).toHaveLength(6);
    expect(new Set(deFabian).size).toBe(6);
  });

  it('durante el torneo: sigue desde la hora real y con las canchas como están', () => {
    const t = femenino();
    const { filas, resumen } = programarEvento({
      cats: [cat(t), cat(masculino())],
      vigente: VIGENTE,
      ahora: { dia: 'VIE', minuto: 19 * 60 + 40 },
      // r1a (PAULA vs MIA) se está jugando en la 1 desde las 19:30: se libera 19:50
      canchas: { activas: ['Cancha 1', 'Cancha 2'], enJuego: [{ cancha: 'Cancha 1', torneoId: t.id, partidoId: 'r1a', desde: 19 * 60 + 30 }] },
    });
    expect(filas.some((f) => f.partidoId === 'r1a' && f.categoria === 'SINGLES FEMENINO')).toBe(false);
    // el otro cuadro tiene un partido con el mismo id: ese sí sigue pendiente
    expect(filas.some((f) => f.partidoId === 'r1a' && f.categoria === 'SINGLES MASCULINO A')).toBe(true);
    expect(filas[0]).toMatchObject({ ini: 19 * 60 + 40, cancha: 'Cancha 2' });
    // ni PAULA ni MIA pueden estar en la cancha 2 mientras juegan en la 1
    expect(['PAULA', 'MIA']).not.toContain(filas[0].a);
    expect(['PAULA', 'MIA']).not.toContain(filas[0].b);
    expect(filas.find((f) => f.cancha === 'Cancha 1')!.ini).toBe(19 * 60 + 50);
    expect(resumen.VIE.partidos).toBe(13);
  });

  it('si un partido se pasa de los 20 minutos, la cancha se libera "ahora", no en el pasado', () => {
    const t = femenino();
    const { filas } = programarEvento({
      cats: [cat(t)],
      vigente: VIGENTE,
      ahora: { dia: 'VIE', minuto: 20 * 60 },
      canchas: { activas: ['Cancha 1'], enJuego: [{ cancha: 'Cancha 1', torneoId: t.id, partidoId: 'r1a', desde: 19 * 60 }] },
    });
    expect(filas[0].ini).toBe(20 * 60);
  });

  it('una cancha deshabilitada no recibe partidos', () => {
    const { filas } = programarEvento({ cats: [cat(femenino())], vigente: VIGENTE, ahora: ANTES, canchas: { activas: ['Cancha 2'], enJuego: [] } });
    expect(new Set(filas.map((f) => f.cancha))).toEqual(new Set(['Cancha 2']));
  });

  it('lo que quedó del viernes pasa al sábado y va primero', () => {
    const t = femenino();
    for (const p of t.partidosGrupo) { p.puntosA = 11; p.puntosB = 5; }
    const doble = conGrupoDe4('DOBLE MIXTO A ANIVERSARIO', ['A y B', 'C y D', 'E y F', 'G y H']);
    const { filas, resumen } = programarEvento({
      cats: [cat(doble), cat(t)], vigente: VIGENTE, ahora: { dia: 'SAB', minuto: 9 * 60 }, canchas: DOS,
    });
    expect(linea(filas[0])).toBe('SAB 10:00 C1 SINGLES FEMENINO FINAL: 1° de la liga vs 2° de la liga');
    expect(resumen.VIE.partidos).toBe(0);
    expect(resumen.SAB.partidos).toBe(8);
  });

  it('respeta el "no antes de" de una categoría y el cambio de hora de inicio', () => {
    const fem = femenino();
    const vigente = aplicarAjustes(PROGRAMA, { inicios: { VIE: 18 * 60 + 30 }, categorias: { [fem.id]: { noAntes: 20 * 60 } } });
    const { filas } = programarEvento({ cats: [cat(fem, vigente), cat(masculino(), vigente)], vigente, ahora: ANTES, canchas: DOS });
    expect(aHora(filas[0].ini)).toBe('18:30');
    expect(Math.min(...filas.filter((f) => f.categoria === 'SINGLES FEMENINO').map((f) => f.ini))).toBe(20 * 60);
  });

  it('con otra duración cambian todos los horarios', () => {
    const vigente = aplicarAjustes(PROGRAMA, { duracion: 30 });
    const { filas } = programarEvento({ cats: [cat(femenino(), vigente)], vigente, ahora: ANTES, canchas: DOS });
    expect([...new Set(filas.map((f) => aHora(f.ini)))]).toEqual(['19:00', '19:30', '20:00', '20:30']);
  });

  it('el One Point Challenge frena los cuadros en todas las canchas y figura como bloque', () => {
    const vigente = aplicarAjustes(PROGRAMA, {
      bloque: { dia: 'SAB', desde: 10 * 60 + 30, hasta: 11 * 60 + 30, titulo: 'ONE POINT CHALLENGE', detalle: 'Todos los anotados' },
    });
    const doble = conGrupoDe4('DOBLE MIXTO A ANIVERSARIO', ['A y B', 'C y D', 'E y F', 'G y H']);
    const { filas } = programarEvento({ cats: [cat(doble, vigente)], vigente, ahora: ANTES, canchas: DOS });
    const partidos = filas.filter((f) => !f.bloque);
    expect([...new Set(partidos.map((f) => aHora(f.ini)))]).toEqual(['10:00', '11:30', '11:50', '12:10']);
    expect(filas.find((f) => f.bloque)).toMatchObject({ ini: 10 * 60 + 30, cancha: 'TODAS', categoria: 'ONE POINT CHALLENGE' });
  });

  it('sin cuadros no hay nada que programar', () => {
    expect(programarEvento({ cats: [], vigente: VIGENTE, ahora: ANTES, canchas: DOS })).toEqual({
      filas: [], resumen: { VIE: { partidos: 0, termina: null }, SAB: { partidos: 0, termina: null } },
    });
  });
});

describe('americano (sin llave)', () => {
  const gente = ['OMAR', 'CRISTIAN', 'FABIAN', 'MICHAEL'];
  const cfg = { corto: 'SINGLES MASCULINO +50', dia: 'VIE', orden: null, noAntes: null };

  it('no proyecta final ni ofrece armar la llave', () => {
    const cat = armarCategoria(conGrupoDe4('SINGLES MASCULINO +50 ANIVERSARIO', gente, {}) as Torneo, cfg);
    const sin = armarCategoria({ ...conGrupoDe4('SINGLES MASCULINO +50 ANIVERSARIO', gente, {}), sinLlave: true }, cfg);
    expect(cat.total).toBe(7); // 6 de grupo + la final proyectada
    expect(sin.total).toBe(6);
    expect(sin.pendientes.every((p) => p.fase.startsWith('Grupo'))).toBe(true);
    expect(sin.sinLlave).toBe(true);
  });

  it('el campeón es el 1° de la tabla cuando se jugó todo', () => {
    const res = { r1a: [11, 3], r1b: [11, 5], r2a: [11, 4], r2b: [6, 11], r3a: [11, 9], r3b: [11, 7] } as Record<string, [number, number]>;
    const casi = armarCategoria({ ...conGrupoDe4('X +50', gente, { ...res, r3b: undefined as unknown as [number, number] }), sinLlave: true }, cfg);
    expect(casi.campeon).toBeNull();
    const todo = armarCategoria({ ...conGrupoDe4('X +50', gente, res), sinLlave: true }, cfg);
    expect(todo.campeon).toBe('OMAR');
  });
});

