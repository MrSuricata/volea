import { describe, expect, it } from 'vitest';
import type { Torneo } from './engine/tipos';
import type { Cache } from './cacheTorneos';
import { DETALLE_SIN_BASE, aplicarEdicion, aplicarRemotosFrescos, filaDeTorneo, mergeTorneos, mismoInstante, subirTorneo } from './sync';
import type { OperacionesTorneo } from './sync';

// Fusion por partido, copia base y escritura condicionada (E2E arbitro-gestor-pisa-resultado):
// el gestor subia el torneo entero con upsert y borraba lo que un arbitro (o la otra tablet)
// acababa de cargar. Ver sync.ts / fusion.ts.

function conGrupo(id: string): Torneo {
  return {
    id, nombre: 'Con grupo', creadoEl: '2026-07-29T10:00:00.000Z', fase: 'faseGrupos',
    parejas: [{ id: 'a', nombre: 'A/A' }, { id: 'b', nombre: 'B/B' }, { id: 'c', nombre: 'C/C' }, { id: 'd', nombre: 'D/D' }],
    grupos: [{ id: 'g', nombre: 'A', parejaIds: ['a', 'b', 'c', 'd'] }],
    partidosGrupo: [
      { id: 'm1', grupoId: 'g', ronda: 1, aId: 'a', bId: 'b', puntosA: null, puntosB: null },
      { id: 'm2', grupoId: 'g', ronda: 1, aId: 'c', bId: 'd', puntosA: null, puntosB: null },
    ],
    configLlave: null, partidosLlave: null,
  };
}
function cargar(x: Torneo, partidoId: string, a: number | null, b: number | null): Torneo {
  return { ...x, partidosGrupo: x.partidosGrupo.map((p) => (p.id === partidoId ? { ...p, puntosA: a, puntosB: b } : p)) };
}
const puntos = (x: Torneo, id: string) => { const p = x.partidosGrupo.find((q) => q.id === id)!; return [p.puntosA, p.puntosB]; };
const remoto = (torneo: Torneo, updatedAt: string) => ({ torneo, updatedAt });
const clon = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function cacheCon(torneos: Torneo[], extra: Partial<Cache> = {}): Cache {
  return { estado: { torneos, jugadores: [] }, base: {}, sucios: [], borrados: [], jugadoresBase: [], jugadoresSucios: false, configSucia: false, conflictos: [], baseDatos: {}, conflictosDetalle: {}, ...extra };
}

describe('mismoInstante', () => {
  it('Z y +00:00 son el mismo instante; µs distintos dentro del mismo ms NO', () => {
    expect(mismoInstante('2026-08-09T17:44:19.957Z', '2026-08-09T17:44:19.957+00:00')).toBe(true);
    expect(mismoInstante('2026-08-09T17:44:19.957Z', '2026-08-09T17:44:19.957000+00:00')).toBe(true);
    expect(mismoInstante('2026-08-09T17:44:19.95+00:00', '2026-08-09T17:44:19.950Z')).toBe(true);
    expect(mismoInstante('2026-08-09T17:44:19+00:00', '2026-08-09T17:44:19.000Z')).toBe(true);
    expect(mismoInstante('2026-08-09T17:44:19.957123+00:00', '2026-08-09T17:44:19.957456+00:00')).toBe(false);
    expect(mismoInstante('2026-08-09T14:44:19.957-03:00', '2026-08-09T17:44:19.957Z')).toBe(true);
    expect(mismoInstante(undefined, '2026-08-09T17:44:19.957Z')).toBe(false);
    expect(mismoInstante('basura', 'basura')).toBe(false);
  });
});

describe('mergeTorneos con copia base (fusion por partido)', () => {
  const T0 = '2026-11-11T12:00:00.000+00:00';
  const T1 = '2026-11-11T12:05:00.123456+00:00';

  it('árbitro cargó m1 en el server, el gestor m2 sin subir: se fusiona, sin conflicto, y sigue sucio con base nueva', () => {
    const base = conGrupo('t1');
    const r = mergeTorneos({
      locales: [cargar(base, 'm2', 11, 7)],
      remotos: [remoto(cargar(base, 'm1', 15, 9), T1)],
      sucios: new Set(['t1']), borrados: new Set(), base: { t1: T0 }, baseDatos: { t1: base },
    });
    expect(r.conflictos).toEqual([]);
    expect(puntos(r.torneos[0], 'm1')).toEqual([15, 9]);
    expect(puntos(r.torneos[0], 'm2')).toEqual([11, 7]);
    expect(r.base.t1).toBe(T1); // la base avanza: el push siguiente sube encima del server
    expect(puntos(r.baseDatos.t1, 'm1')).toEqual([15, 9]); // la copia base pasa a ser la del server
    expect(r.limpios).toEqual([]);
  });

  it('mismo resultado cargado de los dos lados: queda limpio (nada que subir)', () => {
    const base = conGrupo('t1');
    const r = mergeTorneos({
      locales: [cargar(base, 'm1', 11, 3)],
      remotos: [remoto(cargar(base, 'm1', 11, 3), T1)],
      sucios: new Set(['t1']), borrados: new Set(), base: { t1: T0 }, baseDatos: { t1: base },
    });
    expect(r.conflictos).toEqual([]);
    expect(r.limpios).toEqual(['t1']);
    expect(r.baseDatos.t1).toBeUndefined();
  });

  it('el mismo partido con resultados distintos: CONFLICTO con detalle; base y copia NO avanzan (se vuelve a detectar)', () => {
    const base = conGrupo('t1');
    const args = {
      locales: [cargar(base, 'm1', 11, 3)],
      remotos: [remoto(cargar(base, 'm1', 4, 11), T1)],
      sucios: new Set(['t1']), borrados: new Set<string>(), base: { t1: T0 }, baseDatos: { t1: base },
    };
    const r = mergeTorneos(args);
    expect(r.conflictos).toEqual(['t1']);
    expect(r.detalles.t1[0]).toContain('A/A vs B/B');
    expect(puntos(r.torneos[0], 'm1')).toEqual([11, 3]); // se queda lo local hasta decidir
    expect(r.base.t1).toBe(T0);
    expect(r.baseDatos.t1).toBe(base);
    const r2 = mergeTorneos({ ...args, base: r.base, baseDatos: r.baseDatos });
    expect(r2.conflictos).toEqual(['t1']);
  });

  it('CACHE VIEJA (sin baseDatos) con el server avanzado: conflicto como siempre, nunca pisa', () => {
    const base = conGrupo('t1');
    const r = mergeTorneos({
      locales: [cargar(base, 'm2', 11, 7)],
      remotos: [remoto(cargar(base, 'm1', 15, 9), T1)],
      sucios: new Set(['t1']), borrados: new Set(), base: { t1: T0 }, // sin baseDatos
    });
    expect(r.conflictos).toEqual(['t1']);
    expect(r.detalles.t1).toEqual([DETALLE_SIN_BASE]);
    expect(r.base.t1).toBe(T0);
  });

  it('sucio igual al server con base vieja (push que llegó pero perdió la respuesta): limpio, sin conflicto', () => {
    const local = cargar(conGrupo('t1'), 'm1', 11, 3);
    const r = mergeTorneos({
      locales: [local], remotos: [remoto(clon(local), T1)],
      sucios: new Set(['t1']), borrados: new Set(), base: { t1: T0 },
    });
    expect(r.conflictos).toEqual([]);
    expect(r.limpios).toEqual(['t1']);
    expect(r.base.t1).toBe(T1);
  });

  it('limpio con el mismo contenido que el server: conserva la MISMA referencia (no re-renderiza)', () => {
    const local = conGrupo('t1');
    const r = mergeTorneos({
      locales: [local], remotos: [remoto(clon(local), T1)],
      sucios: new Set(), borrados: new Set(), base: { t1: T0 },
    });
    expect(r.torneos[0]).toBe(local);
  });

  it('copia base de un sucio que no está en el server (nuevo o borrado allá) se conserva; la de un limpio se descarta', () => {
    const a = conGrupo('a');
    const b = conGrupo('b');
    const r = mergeTorneos({
      locales: [a, b], remotos: [remoto(b, T0)],
      sucios: new Set(['a']), borrados: new Set(), base: { a: T0, b: T0 }, baseDatos: { a, b },
    });
    expect(r.baseDatos.a).toBe(a);
    expect(r.baseDatos.b).toBeUndefined();
  });
});

describe('aplicarEdicion (setEstado)', () => {
  it('al pasar de limpio a sucio guarda la copia base (el torneo tal como vino del server)', () => {
    const limpio = conGrupo('t1');
    const prev = cacheCon([limpio], { base: { t1: 'T0' } });
    const editado = cargar(limpio, 'm1', 11, 2);
    const c = aplicarEdicion(prev, { ...prev.estado, torneos: [editado] });
    expect(c.sucios).toEqual(['t1']);
    expect(c.baseDatos.t1).toBe(limpio);
    // una segunda edicion NO cambia la copia base
    const c2 = aplicarEdicion(c, { ...c.estado, torneos: [cargar(editado, 'm2', 11, 4)] });
    expect(c2.baseDatos.t1).toBe(limpio);
  });

  it('sin base conocida (torneo nuevo) no hay copia base', () => {
    const prev = cacheCon([]);
    const c = aplicarEdicion(prev, { ...prev.estado, torneos: [conGrupo('nuevo')] });
    expect(c.sucios).toEqual(['nuevo']);
    expect(c.baseDatos).toEqual({});
  });

  it('cache vieja con un sucio sin copia: seguir editando NO inventa una copia (la base real se desconoce)', () => {
    const sucioViejo = cargar(conGrupo('t1'), 'm1', 11, 2);
    const prev = cacheCon([sucioViejo], { base: { t1: 'T0' }, sucios: ['t1'] });
    const c = aplicarEdicion(prev, { ...prev.estado, torneos: [cargar(sucioViejo, 'm2', 3, 11)] });
    expect(c.baseDatos.t1).toBeUndefined();
  });

  it('borrar un torneo descarta su copia base y su base', () => {
    const limpio = conGrupo('t1');
    const prev = cacheCon([limpio], { base: { t1: 'T0' }, sucios: ['t1'], baseDatos: { t1: limpio } });
    const c = aplicarEdicion(prev, { ...prev.estado, torneos: [] });
    expect(c.borrados).toEqual(['t1']);
    expect(c.baseDatos.t1).toBeUndefined();
    expect(c.base.t1).toBeUndefined();
  });
});

describe('aplicarRemotosFrescos (el push encontró el server avanzado)', () => {
  it('fusiona contra lo que hay AHORA en la cache (incluye ediciones hechas mientras viajaba el push)', () => {
    const base = conGrupo('t1');
    const ahoraLocal = cargar(base, 'm2', 11, 8);
    const prev = cacheCon([ahoraLocal], { base: { t1: 'T0' }, sucios: ['t1'], baseDatos: { t1: base } });
    const { cache, refusionados } = aplicarRemotosFrescos(prev, [remoto(cargar(base, 'm1', 15, 9), '2026-11-11T12:05:00.000Z')]);
    expect(refusionados).toEqual(['t1']);
    expect(puntos(cache.estado.torneos[0], 'm1')).toEqual([15, 9]);
    expect(puntos(cache.estado.torneos[0], 'm2')).toEqual([11, 8]);
    expect(cache.base.t1).toBe('2026-11-11T12:05:00.000Z');
    expect(cache.conflictos).toEqual([]);
  });

  it('choque: queda en conflicto con detalle, sin re-push', () => {
    const base = conGrupo('t1');
    const prev = cacheCon([cargar(base, 'm1', 11, 1)], { base: { t1: 'T0' }, sucios: ['t1'], baseDatos: { t1: base } });
    const { cache, refusionados } = aplicarRemotosFrescos(prev, [remoto(cargar(base, 'm1', 1, 11), 'T1')]);
    expect(refusionados).toEqual([]);
    expect(cache.conflictos).toEqual(['t1']);
    expect(cache.conflictosDetalle.t1.length).toBe(1);
    expect(cache.base.t1).toBe('T0');
  });

  it('torneo nuevo cuyo id ya existe en el server (insert duplicado): conflicto, no pisa', () => {
    const prev = cacheCon([cargar(conGrupo('t1'), 'm1', 11, 1)], { sucios: ['t1'] });
    const { cache } = aplicarRemotosFrescos(prev, [remoto(conGrupo('t1'), 'T1')]);
    expect(cache.conflictos).toEqual(['t1']);
    expect(cache.base.t1).toBeUndefined();
  });
});

// Base falsa minima con la semantica de PostgREST que usa subirTorneo: PATCH con filtros eq
// (0 filas si no matchean, sin error), INSERT puro (409/23505 si el id existe) y select.
function tablaFalsa(inicial: { torneo: Torneo; updatedAt: string }[] = []) {
  const filas = new Map(inicial.map((f) => [f.torneo.id, { data: f.torneo, updated_at: f.updatedAt }]));
  const llamadas: string[] = [];
  const op: OperacionesTorneo = {
    actualizarSi: async (fila, base) => {
      llamadas.push(`update ${fila.id} si ${base}`);
      const f = filas.get(fila.id);
      if (!f || !mismoInstante(f.updated_at, base)) return { data: [], error: null };
      filas.set(fila.id, { data: fila.data, updated_at: fila.updated_at });
      return { data: [{ updated_at: fila.updated_at }], error: null };
    },
    insertar: async (fila) => {
      llamadas.push(`insert ${fila.id}`);
      if (filas.has(fila.id)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      filas.set(fila.id, { data: fila.data, updated_at: fila.updated_at });
      return { data: [{ updated_at: fila.updated_at }], error: null };
    },
    leer: async (id) => {
      llamadas.push(`select ${id}`);
      const f = filas.get(id);
      return { data: f ? { data: f.data, updated_at: f.updated_at } : null, error: null };
    },
  };
  return { op, filas, llamadas };
}

describe('subirTorneo (escritura condicionada)', () => {
  const T0 = '2026-11-11T12:00:00.000+00:00';
  const T1 = '2026-11-11T12:05:00.000+00:00';
  const AHORA = '2026-11-11T12:06:00.000Z';

  it('base == server: actualiza y devuelve el updated_at nuevo', async () => {
    const db = tablaFalsa([{ torneo: conGrupo('t1'), updatedAt: T0 }]);
    const r = await subirTorneo(db.op, filaDeTorneo(cargar(conGrupo('t1'), 'm1', 11, 2), AHORA), T0);
    expect(r).toEqual({ tipo: 'ok', updatedAt: AHORA });
    expect(puntos(db.filas.get('t1')!.data, 'm1')).toEqual([11, 2]);
  });

  it('REGRESION E2E: el árbitro escribió después de nuestra base → NO pisa; devuelve la versión del server', async () => {
    const delArbitro = cargar(conGrupo('t1'), 'm1', 15, 9);
    const db = tablaFalsa([{ torneo: delArbitro, updatedAt: T1 }]);
    const r = await subirTorneo(db.op, filaDeTorneo(cargar(conGrupo('t1'), 'm2', 11, 7), AHORA), T0);
    expect(r.tipo).toBe('avanzado');
    expect(puntos(db.filas.get('t1')!.data, 'm1')).toEqual([15, 9]); // el resultado del árbitro sigue
    expect(puntos(db.filas.get('t1')!.data, 'm2')).toEqual([null, null]); // y no se escribió nada
    if (r.tipo === 'avanzado') expect(r.remoto.updatedAt).toBe(T1);
  });

  it('0 filas pero el server sigue en nuestra base (RLS rechazó en silencio): ERROR, no "avance"', async () => {
    const db = tablaFalsa([{ torneo: conGrupo('t1'), updatedAt: T0 }]);
    db.op.actualizarSi = async () => ({ data: [], error: null });
    const r = await subirTorneo(db.op, filaDeTorneo(conGrupo('t1'), AHORA), T0);
    expect(r.tipo).toBe('error');
  });

  it('torneo nuevo: INSERT; si ya existe ese id, no lo pisa y devuelve la versión del server', async () => {
    const db = tablaFalsa();
    expect((await subirTorneo(db.op, filaDeTorneo(conGrupo('n'), AHORA), undefined)).tipo).toBe('ok');
    const otro = { ...conGrupo('n'), nombre: 'Otro equipo' };
    const r = await subirTorneo(db.op, filaDeTorneo(otro, AHORA), undefined);
    expect(r.tipo).toBe('avanzado');
    expect(db.filas.get('n')!.data.nombre).toBe('Con grupo');
  });

  it('con base pero la fila ya no existe (borrada en el server): se vuelve a crear', async () => {
    const db = tablaFalsa();
    const r = await subirTorneo(db.op, filaDeTorneo(conGrupo('t1'), AHORA), T0);
    expect(r.tipo).toBe('ok');
    expect(db.llamadas).toEqual([`update t1 si ${T0}`, 'select t1', 'insert t1']);
  });

  it('error de red en el update: error (sin releer)', async () => {
    const db = tablaFalsa([{ torneo: conGrupo('t1'), updatedAt: T0 }]);
    db.op.actualizarSi = async () => ({ data: null, error: new Error('timeout') });
    expect((await subirTorneo(db.op, filaDeTorneo(conGrupo('t1'), AHORA), T0)).tipo).toBe('error');
  });

  it('dos gestores con la misma base: el segundo encuentra el server avanzado, fusiona y sube encima — quedan los dos resultados', async () => {
    const base = conGrupo('t1');
    const db = tablaFalsa([{ torneo: base, updatedAt: T0 }]);
    const tabletA = cargar(base, 'm1', 11, 4);
    const tabletB = cargar(base, 'm2', 9, 11);
    expect((await subirTorneo(db.op, filaDeTorneo(tabletA, '2026-11-11T12:01:00.000Z'), T0)).tipo).toBe('ok');
    const r = await subirTorneo(db.op, filaDeTorneo(tabletB, '2026-11-11T12:01:00.500Z'), T0);
    expect(r.tipo).toBe('avanzado');
    if (r.tipo !== 'avanzado') return;
    const prev = cacheCon([tabletB], { base: { t1: T0 }, sucios: ['t1'], baseDatos: { t1: base } });
    const { cache, refusionados } = aplicarRemotosFrescos(prev, [r.remoto]);
    expect(refusionados).toEqual(['t1']);
    const r2 = await subirTorneo(db.op, filaDeTorneo(cache.estado.torneos[0], '2026-11-11T12:01:01.000Z'), cache.base.t1);
    expect(r2.tipo).toBe('ok');
    expect(puntos(db.filas.get('t1')!.data, 'm1')).toEqual([11, 4]);
    expect(puntos(db.filas.get('t1')!.data, 'm2')).toEqual([9, 11]);
  });
});
