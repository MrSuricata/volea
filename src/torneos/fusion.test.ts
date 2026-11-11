import { describe, expect, it } from 'vitest';
import type { PartidoGrupo, PartidoLlave, Torneo } from './engine/tipos';
import { describirPartido, fusionarTorneo, igualesJson } from './fusion';
import { armarLlaveRolling } from './engine/llaveIndividual';
import { conAusente } from './ui/opc/ausentes';
import { marcar } from './ui/opc/modelo';

// Torneo de prueba: 4 parejas, un grupo de todos contra todos y una llave de semis + final +
// tercer puesto (s1: P1 vs P4, s2: P2 vs P3, final: ganadores, t3: perdedores).
function pg(id: string, aId: string, bId: string, ronda: number): PartidoGrupo {
  return { id, grupoId: 'gA', ronda, aId, bId, puntosA: null, puntosB: null };
}
function pl(id: string, ronda: number, posicion: number, a: PartidoLlave['a'], b: PartidoLlave['b'], tercer = false): PartidoLlave {
  return { id, ronda, posicion, a, b, puntosA: null, puntosB: null, esTercerPuesto: tercer };
}
function torneo(): Torneo {
  return {
    id: 'oro', nombre: 'One Point Challenge', creadoEl: '2026-11-11T10:00:00.000Z', fase: 'llave',
    parejas: [
      { id: 'p1', nombre: 'Uno/Uno' }, { id: 'p2', nombre: 'Dos/Dos' }, { id: 'p3', nombre: 'Tres/Tres' }, { id: 'p4', nombre: 'Cuatro/Cuatro' },
    ],
    grupos: [{ id: 'gA', nombre: 'A', parejaIds: ['p1', 'p2', 'p3', 'p4'] }],
    partidosGrupo: [pg('g1', 'p1', 'p2', 1), pg('g2', 'p3', 'p4', 1), pg('g3', 'p1', 'p3', 2), pg('g4', 'p2', 'p4', 2)],
    configLlave: { porGrupo: 2, mejoresExtra: 0, tercerPuesto: true },
    partidosLlave: [
      pl('s1', 1, 0, { tipo: 'seed', parejaId: 'p1' }, { tipo: 'seed', parejaId: 'p4' }),
      pl('s2', 1, 1, { tipo: 'seed', parejaId: 'p2' }, { tipo: 'seed', parejaId: 'p3' }),
      pl('f', 2, 0, { tipo: 'ganadorDe', partidoId: 's1' }, { tipo: 'ganadorDe', partidoId: 's2' }),
      pl('t3', 2, 1, { tipo: 'perdedorDe', partidoId: 's1' }, { tipo: 'perdedorDe', partidoId: 's2' }, true),
    ],
  };
}
const copia = (t: Torneo): Torneo => JSON.parse(JSON.stringify(t));

// Carga un resultado (como lo hacen el gestor, En vivo o arbitro_terminar)
function conResultado(t: Torneo, id: string, a: number | null, b: number | null, extra: Partial<PartidoLlave> = {}): Torneo {
  const n = copia(t);
  const fijar = <P extends PartidoGrupo | PartidoLlave>(p: P): P => (p.id === id ? { ...p, puntosA: a, puntosB: b, ...(a !== null ? { cargadoEl: '2026-11-11T12:00:00.000Z' } : {}), ...extra } : p);
  n.partidosGrupo = n.partidosGrupo.map(fijar);
  n.partidosLlave = n.partidosLlave ? n.partidosLlave.map(fijar) : null;
  return n;
}
const res = (t: Torneo, id: string) => {
  const p = [...t.partidosGrupo, ...(t.partidosLlave ?? [])].find((x) => x.id === id)!;
  return [p.puntosA, p.puntosB];
};

describe('igualesJson', () => {
  it('ignora claves con undefined (no existen en el JSON guardado)', () => {
    expect(igualesJson({ a: 1, cargadoEl: undefined }, { a: 1 })).toBe(true);
    expect(igualesJson({ a: 1 }, { a: 1, b: null })).toBe(false); // null SI se guarda
    expect(igualesJson([1, { x: [2] }], [1, { x: [2] }])).toBe(true);
    expect(igualesJson([1, 2], [2, 1])).toBe(false);
    expect(igualesJson(null, undefined)).toBe(false);
  });
});

describe('fusionarTorneo: resultados de partidos', () => {
  it('solo cambió el server: gana el server', () => {
    const base = torneo();
    const remoto = conResultado(base, 'g1', 11, 5);
    const r = fusionarTorneo(base, copia(base), remoto);
    expect(r.ok && res(r.torneo, 'g1')).toEqual([11, 5]);
  });

  it('solo cambió lo local: gana lo local', () => {
    const base = torneo();
    const local = conResultado(base, 'g1', 11, 5);
    const r = fusionarTorneo(base, local, copia(base));
    expect(r.ok && r.torneo).toBe(local);
  });

  it('árbitro cargó un partido y el gestor otro (el bug del E2E): quedan los dos', () => {
    const base = torneo();
    const remoto = conResultado(base, 'g1', 15, 9); // arbitro_terminar
    const local = conResultado(base, 'g2', 11, 7); // el gestor sin refrescar
    const r = fusionarTorneo(base, local, remoto);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(res(r.torneo, 'g1')).toEqual([15, 9]);
    expect(res(r.torneo, 'g2')).toEqual([11, 7]);
    expect(res(r.torneo, 'g3')).toEqual([null, null]);
  });

  it('dos tablets cargan semis distintas de la misma llave: quedan las dos', () => {
    const base = torneo();
    const r = fusionarTorneo(base, conResultado(base, 's1', 11, 4), conResultado(base, 's2', 9, 11));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(res(r.torneo, 's1')).toEqual([11, 4]);
    expect(res(r.torneo, 's2')).toEqual([9, 11]);
  });

  it('los dos cargaron EL MISMO resultado: no es choque (aunque cargadoEl difiera)', () => {
    const base = torneo();
    const local = conResultado(base, 'g1', 11, 5, { cargadoEl: '2026-11-11T12:00:01.000Z' });
    const remoto = conResultado(base, 'g1', 11, 5, { cargadoEl: '2026-11-11T12:00:09.000Z' });
    const r = fusionarTorneo(base, conResultado(local, 'g2', 11, 0), remoto);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(res(r.torneo, 'g1')).toEqual([11, 5]);
    expect(res(r.torneo, 'g2')).toEqual([11, 0]);
  });

  it('los dos tocaron el mismo partido con resultados distintos: CHOQUE que nombra el partido y los dos resultados', () => {
    const base = torneo();
    const r = fusionarTorneo(base, conResultado(base, 'g1', 11, 5), conResultado(base, 'g1', 9, 11));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.choques).toHaveLength(1);
    expect(r.choques[0].partidoId).toBe('g1');
    expect(r.choques[0].descripcion).toContain('Grupo A: Uno/Uno vs Dos/Dos');
    expect(r.choques[0].descripcion).toContain('11-5');
    expect(r.choques[0].descripcion).toContain('9-11');
  });

  it('uno borró un resultado y el otro lo corrigió: CHOQUE', () => {
    const base = conResultado(torneo(), 'g1', 11, 5);
    const r = fusionarTorneo(base, conResultado(base, 'g1', null, null), conResultado(base, 'g1', 11, 7));
    expect(r.ok).toBe(false);
  });

  it('W.O. y games cuentan como parte del resultado', () => {
    const base = torneo();
    const wo = fusionarTorneo(base, conResultado(base, 'g1', 11, 0, { wo: true }), conResultado(base, 'g1', 11, 0));
    expect(wo.ok).toBe(false);
    const g1 = conResultado(base, 's1', 2, 1, { games: [{ a: 11, b: 4 }, { a: 8, b: 11 }, { a: 11, b: 9 }] });
    const g2 = conResultado(base, 's1', 2, 1, { games: [{ a: 11, b: 4 }, { a: 9, b: 11 }, { a: 11, b: 9 }] });
    expect(fusionarTorneo(base, g1, g2).ok).toBe(false);
    expect(fusionarTorneo(base, g1, copia(g1)).ok).toBe(true);
  });

  it('cargadoEl: undefined local (resultado borrado en el gestor) no da choque falso', () => {
    const base = conResultado(torneo(), 'g1', 11, 5);
    const local = copia(base);
    local.partidosGrupo[0] = { ...local.partidosGrupo[0], puntosA: null, puntosB: null, cargadoEl: undefined };
    const remoto = conResultado(base, 'g2', 11, 3);
    const r = fusionarTorneo(base, local, remoto);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(res(r.torneo, 'g1')).toEqual([null, null]);
    expect(res(r.torneo, 'g2')).toEqual([11, 3]);
  });
});

describe('fusionarTorneo: datos sueltos del torneo', () => {
  it('nombre cambiado acá y resultado en el server: se combinan', () => {
    const base = torneo();
    const r = fusionarTorneo(base, { ...copia(base), nombre: 'OPC 2026' }, conResultado(base, 'g1', 11, 5));
    expect(r.ok && r.torneo.nombre).toBe('OPC 2026');
    expect(r.ok && res(r.torneo, 'g1')).toEqual([11, 5]);
  });

  it('el mismo dato cambiado distinto en los dos lados: CHOQUE; igual en los dos: sin choque', () => {
    const base = torneo();
    const r = fusionarTorneo(base, { ...conResultado(base, 'g1', 11, 2), nombre: 'A' }, { ...conResultado(base, 'g2', 11, 2), nombre: 'B' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.choques[0].descripcion).toMatch(/el nombre del torneo/);
    const r2 = fusionarTorneo(base, { ...conResultado(base, 'g1', 11, 2), visible: false }, { ...conResultado(base, 'g2', 11, 2), visible: false });
    expect(r2.ok && r2.torneo.visible).toBe(false);
  });

  it('un campo agregado solo de un lado (p.ej. canchas) se conserva', () => {
    const base = torneo();
    const r = fusionarTorneo(base, { ...copia(base), canchas: 4 }, conResultado(base, 's1', 11, 2));
    expect(r.ok && r.torneo.canchas).toBe(4);
  });
});

describe('fusionarTorneo: estructura', () => {
  it('llave rearmada acá y resultado cargado en el server: CHOQUE', () => {
    const base = conResultado(torneo(), 's1', 11, 3);
    const local = { ...copia(base), configLlave: null, partidosLlave: null, fase: 'llave' as const };
    const r = fusionarTorneo(base, local, conResultado(base, 's2', 11, 6));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.choques[0].descripcion).toMatch(/armado del torneo/);
  });

  it('pareja renombrada en el server y resultado cargado acá: CHOQUE', () => {
    const base = torneo();
    const remoto = copia(base);
    remoto.parejas[0] = { ...remoto.parejas[0], nombre: 'Uno/Otro' };
    expect(fusionarTorneo(base, conResultado(base, 'g1', 11, 5), remoto).ok).toBe(false);
  });

  it('partidos con ids distintos (fixture rehecho) de un lado y resultados del otro: CHOQUE', () => {
    const base = torneo();
    const remoto = copia(base);
    remoto.partidosGrupo = remoto.partidosGrupo.map((p) => ({ ...p, id: `${p.id}x` }));
    expect(fusionarTorneo(base, conResultado(base, 'g1', 11, 5), remoto).ok).toBe(false);
  });

  it('estructura cambiada de un lado y del otro solo un dato suelto: gana la estructura con el dato', () => {
    const base = torneo();
    const remoto = { ...copia(base), configLlave: null, partidosLlave: null };
    const r = fusionarTorneo(base, { ...copia(base), nombre: 'Nuevo' }, remoto);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.torneo.partidosLlave).toBeNull();
    expect(r.torneo.nombre).toBe('Nuevo');
  });

  it('la misma estructura nueva en los dos lados y resultados distintos: se fusiona por partido', () => {
    const base = torneo();
    const nueva = { ...copia(base), parejas: [...base.parejas.map((p) => ({ ...p }))] };
    nueva.parejas[3] = { id: 'p4', nombre: 'Cuatro/Bis' };
    const r = fusionarTorneo(base, conResultado(nueva, 'g1', 11, 5), conResultado(nueva, 'g2', 3, 11));
    expect(r.ok).toBe(true);
  });

  it('un lado reordenó la llave (posición) y el otro cargó un resultado: CHOQUE', () => {
    const base = torneo();
    const local = copia(base);
    local.partidosLlave = local.partidosLlave!.map((p) => (p.id === 's1' ? { ...p, posicion: 1 } : p.id === 's2' ? { ...p, posicion: 0 } : p));
    expect(fusionarTorneo(base, local, conResultado(base, 's1', 11, 3)).ok).toBe(false);
  });
});

describe('fusionarTorneo: cascada de la llave', () => {
  it('ganador de semi corregido de un lado y final ya jugada del otro: CHOQUE (no fusión silenciosa)', () => {
    // base: s1 la ganó P1, s2 la ganó P2; la final todavía no
    const base = conResultado(conResultado(torneo(), 's1', 11, 3), 's2', 11, 8);
    // acá: corrigen la semi 1 (ganó P4)
    const local = conResultado(base, 's1', 5, 11);
    // en la otra tablet: cargan la final P1 vs P2
    const remoto = conResultado(base, 'f', 11, 9);
    const r = fusionarTorneo(base, local, remoto);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.choques.map((c) => c.partidoId)).toContain('f');
    expect(r.choques.some((c) => /cambió quién llegaba/.test(c.descripcion))).toBe(true);
  });

  it('el tercer puesto (perdedorDe) también cuenta para la cascada', () => {
    const base = conResultado(conResultado(torneo(), 's1', 11, 3), 's2', 11, 8);
    // acá cargan el 3er puesto (P4 vs P3); en la otra tablet corrigen la semi 2 (ahora pierde P2)
    const r = fusionarTorneo(base, conResultado(base, 't3', 11, 2), conResultado(base, 's2', 4, 11));
    expect(r.ok).toBe(false);
  });

  it('semis de los dos lados y final cargada después de las dos: sin choque', () => {
    const base = torneo();
    // la otra tablet: carga s2
    const remoto = conResultado(base, 's2', 11, 8);
    // acá: s1 (sin saber de s2) — la final todavía no está definida acá
    const local = conResultado(base, 's1', 11, 3);
    const r = fusionarTorneo(base, local, remoto);
    expect(r.ok).toBe(true);
  });

  it('corrección de semi que NO cambia el ganador + final del otro lado: sin choque', () => {
    const base = conResultado(conResultado(torneo(), 's1', 11, 3), 's2', 11, 8);
    const local = conResultado(base, 's1', 11, 7); // sigue ganando P1
    const remoto = conResultado(base, 'f', 11, 9);
    const r = fusionarTorneo(base, local, remoto);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(res(r.torneo, 's1')).toEqual([11, 7]);
    expect(res(r.torneo, 'f')).toEqual([11, 9]);
  });

  it('el mismo lado corrige la semi y borra la final (cascada del motor) mientras el otro carga un partido de grupo: fusión', () => {
    const base = conResultado(conResultado(conResultado(torneo(), 's1', 11, 3), 's2', 11, 8), 'f', 11, 9);
    const local = conResultado(conResultado(base, 's1', 5, 11), 'f', null, null);
    const remoto = conResultado(base, 'g1', 11, 2);
    const r = fusionarTorneo(base, local, remoto);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(res(r.torneo, 'f')).toEqual([null, null]);
    expect(res(r.torneo, 'g1')).toEqual([11, 2]);
  });

  it('corrección de semi + final cargada del otro lado, pero prefiriendo lo local (Mi versión): se resuelve', () => {
    const base = conResultado(conResultado(torneo(), 's1', 11, 3), 's2', 11, 8);
    const r = fusionarTorneo(base, conResultado(base, 's1', 5, 11), conResultado(base, 'f', 11, 9), { preferir: 'local' });
    expect(r.ok).toBe(true);
  });
});

describe('fusionarTorneo: preferir lo local (Mi versión)', () => {
  it('en el partido que choca gana lo local y lo demás del server se conserva', () => {
    const base = torneo();
    const local = conResultado(base, 'g1', 11, 5);
    const remoto = conResultado(conResultado(base, 'g1', 9, 11), 'g2', 11, 1);
    const r = fusionarTorneo(base, local, remoto, { preferir: 'local' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(res(r.torneo, 'g1')).toEqual([11, 5]);
    expect(res(r.torneo, 'g2')).toEqual([11, 1]);
  });

  it('choque de estructura: gana el torneo local entero', () => {
    const base = torneo();
    const local = { ...copia(base), partidosLlave: null, configLlave: null };
    const r = fusionarTorneo(base, local, conResultado(base, 's1', 11, 2), { preferir: 'local' });
    expect(r.ok && r.torneo.partidosLlave).toBeNull();
  });
});

describe('fusionarTorneo: estabilidad de referencia', () => {
  it('mismas entradas => el MISMO objeto (el hook aplica cada cambio dos veces y compara referencias)', () => {
    const base = torneo();
    const local = conResultado(base, 'g1', 11, 5);
    const remoto = conResultado(base, 'g2', 3, 11);
    const a = fusionarTorneo(base, local, remoto);
    const b = fusionarTorneo(base, local, remoto);
    expect(a.ok && b.ok && a.torneo === b.torneo).toBe(true);
    const c = fusionarTorneo(base, local, remoto, { preferir: 'local' });
    expect(c).not.toBe(a); // otra opcion: se recalcula
    const d = fusionarTorneo(base, local, copia(remoto));
    expect(d).not.toBe(a);
  });
});

describe('describirPartido', () => {
  it('nombra grupo, ronda de llave y rivales resueltos', () => {
    const t = conResultado(torneo(), 's1', 11, 3);
    expect(describirPartido(t, 'g2')).toBe('Grupo A: Tres/Tres vs Cuatro/Cuatro');
    expect(describirPartido(t, 's2')).toBe('Semifinal: Dos/Dos vs Tres/Tres');
    expect(describirPartido(t, 'f')).toBe('Final: Uno/Uno vs a definir');
    expect(describirPartido(t, 't3')).toBe('Tercer puesto: Cuatro/Cuatro vs a definir');
  });
});

// One Point Challenge: `ausentes` (los que no se presentaron) es un dato suelto que se fusiona
// como conjunto; los W.O. que genera son resultados y se fusionan partido por partido.
describe('fusionarTorneo: ausentes del One Point Challenge', () => {
  function opc(): Torneo {
    const ids = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7', 'j8'];
    return {
      id: 'opc', nombre: 'OPC', creadoEl: '2026-11-11T10:00:00.000Z', formato: 'individual', fase: 'llave',
      parejas: ids.map((id) => ({ id, nombre: id.toUpperCase() })), grupos: [], partidosGrupo: [], configLlave: null,
      partidosLlave: armarLlaveRolling(ids),
    };
  }
  const r1 = (t: Torneo, k: number) => t.partidosLlave!.filter((p) => p.ronda === 1)[k];
  const tocar = (t: Torneo, k: number): Torneo => ({ ...t, partidosLlave: marcar(t.partidosLlave!, r1(t, k).id, 'a', '2026-11-11T12:00:00.000Z', t.ausentes ?? []) });

  it('ausente marcado acá y resultado cargado en el server: se combinan sin choque de estructura', () => {
    const base = opc();
    const local = conAusente(copia(base), 'j1', true);
    const remoto = tocar(copia(base), 1);
    const r = fusionarTorneo(base, local, remoto);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.torneo.ausentes).toEqual(['j1']);
    expect([r1(r.torneo, 0).puntosB, r1(r.torneo, 0).wo]).toEqual([1, true]);
    expect(r1(r.torneo, 1).puntosA).toBe(1);
    // y al revés (el ausente vino del server)
    const r2 = fusionarTorneo(base, remoto, local);
    expect(r2.ok && r2.torneo.ausentes).toEqual(['j1']);
  });

  it('dos equipos marcan a distintos ausentes: quedan los dos (y sus W.O.)', () => {
    const base = opc();
    const r = fusionarTorneo(base, conAusente(copia(base), 'j1', true), conAusente(copia(base), 'j4', true));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.torneo.ausentes).toEqual(['j1', 'j4']);
    expect([r1(r.torneo, 0).wo, r1(r.torneo, 1).wo]).toEqual([true, true]);
  });

  it('uno desmarca (llegó) y el otro carga otro cruce: el ausente sale y el campo desaparece', () => {
    const base = conAusente(opc(), 'j1', true);
    const local = conAusente(copia(base), 'j1', false);
    const remoto = tocar(copia(base), 2);
    const r = fusionarTorneo(base, local, remoto);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('ausentes' in r.torneo).toBe(false);
    expect(r1(r.torneo, 0).puntosA).toBeNull();
    expect(r1(r.torneo, 2).puntosA).toBe(1);
  });

  it('el mismo ausente en los dos lados: sin choque', () => {
    const base = opc();
    const r = fusionarTorneo(base, tocar(conAusente(copia(base), 'j1', true), 1), conAusente(copia(base), 'j1', true));
    expect(r.ok && r.torneo.ausentes).toEqual(['j1']);
  });

  it('acá se marcó ausente y en el otro dispositivo se jugó ese mismo cruce: CHOQUE (no se adivina)', () => {
    const base = opc();
    const r = fusionarTorneo(base, conAusente(copia(base), 'j1', true), tocar(copia(base), 0));
    expect(r.ok).toBe(false);
  });
});
