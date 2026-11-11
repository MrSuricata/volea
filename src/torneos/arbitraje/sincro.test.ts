import { describe, expect, it } from 'vitest';
import type { Jugada } from './motor';
import {
  alEntrar, alEnviar, alResponder, colaGuardada, colaNueva, firma, iguales, interpretar, jugar, mensajeAmigable, pendiente,
  proximoEnvio, reconciliar, textoAviso, type Aviso, type Cola, type Respuesta,
} from './sincro';

const ini: Jugada = { t: 'inicio', saca: 'A', derechaA: 0, derechaB: 0 };
const r = (gana: 'A' | 'B'): Jugada => ({ t: 'rally', gana });
const lista = (s: string): Jugada[] => [ini, ...s.split('').map((c) => r(c as 'A' | 'B'))];

describe('cola de envío', () => {
  it('lo que se marca mientras viaja un envío no se pierde: al volver se manda lo último', () => {
    let c = jugar(colaNueva([], 0), ini);
    const e1 = proximoEnvio(c)!;
    c = alEnviar(c, e1);
    // Mientras sube el inicio, el árbitro marca dos puntos: no sale nada nuevo (uno por vez).
    c = jugar(jugar(c, r('A')), r('B'));
    expect(proximoEnvio(c)).toBeNull();
    // Vuelve el ok del primero: NO queda todo marcado como subido.
    const s = alResponder(c, e1, { tipo: 'ok', version: 1 });
    c = s.cola;
    expect(pendiente(c)).toBe(true);
    const e2 = proximoEnvio(c)!;
    expect(e2).toEqual({ jugadas: lista('AB'), version: 1 });
    c = alResponder(alEnviar(c, e2), e2, { tipo: 'ok', version: 2 }).cola;
    expect(pendiente(c)).toBe(false);
    expect(proximoEnvio(c)).toBeNull();
  });

  it('un deshacer rápido durante el envío también llega', () => {
    let c = colaNueva(lista('AA'), 3);
    c = jugar(c, r('B'));
    const e1 = proximoEnvio(c)!;
    c = alEnviar(c, e1);
    c = jugar(c, 'deshacer');
    c = alResponder(c, e1, { tipo: 'ok', version: 4 }).cola;
    expect(pendiente(c)).toBe(true);
    expect(proximoEnvio(c)).toEqual({ jugadas: lista('AA'), version: 4 });
  });

  it('sin señal: queda pendiente y se espera para reintentar', () => {
    let c = jugar(colaNueva(lista(''), 1), r('A'));
    const e1 = proximoEnvio(c)!;
    c = alEnviar(c, e1);
    const s = alResponder(c, e1, { tipo: 'red' });
    expect(s.siguiente).toBe('esperar');
    expect(pendiente(s.cola)).toBe(true);
    expect(proximoEnvio(s.cola)).toEqual({ jugadas: lista('A'), version: 1 });
  });

  it('código dado de baja o rechazo: para (no reintenta solo) y avisa sin textos crudos', () => {
    const c = jugar(colaNueva(lista(''), 1), r('A'));
    const e1 = proximoEnvio(c)!;
    const s = alResponder(alEnviar(c, e1), e1, interpretar({ ok: false, error: 'El código ya no es válido.' }, null));
    expect(s.siguiente).toBe('parar');
    expect(s.aviso?.tipo).toBe('codigo');
    expect(textoAviso(s.aviso!)).not.toMatch(/desfasado/i);
  });

  it('el partido se cerró en el servidor: la cola termina', () => {
    const c = jugar(colaNueva(lista(''), 1), r('A'));
    const e1 = proximoEnvio(c)!;
    const s = alResponder(alEnviar(c, e1), e1, { tipo: 'terminado', motivo: 'cargado_en_mesa', resultado: { puntosA: 11, puntosB: 4 } });
    expect(s.siguiente).toBe('terminado');
  });
});

describe('reconciliación (regla explícita)', () => {
  const base = (jugadas: Jugada[], subido: Jugada[], version: number, enviados: string[] = []): Cola => ({ jugadas, subido, version, enviados, enVuelo: null });

  it('1. el servidor ya tiene lo mismo (la respuesta se perdió): se adopta la versión', () => {
    const s = reconciliar(base(lista('AB'), lista('A'), 2), lista('AB'), 3);
    expect(s.aviso).toBeNull();
    expect(s.cola.version).toBe(3);
    expect(pendiente(s.cola)).toBe(false);
  });

  it('2. eco de un envío propio cuya respuesta se perdió: se sigue con lo del teléfono y se reenvía', () => {
    const c = base(lista('ABB'), lista('A'), 2, [firma(lista('AB'))]);
    const s = reconciliar(c, lista('AB'), 3);
    expect(s.aviso).toBeNull();
    expect(s.cola.jugadas).toEqual(lista('ABB'));
    expect(proximoEnvio(s.cola)).toEqual({ jugadas: lista('ABB'), version: 3 });
  });

  it('2. eco aunque después se haya deshecho en el teléfono: gana el deshacer', () => {
    // Se mandó "AB" (llegó, se perdió la respuesta) y después se deshizo la B.
    const c = base(lista('A'), lista('A'), 2, [firma(lista('AB'))]);
    const s = reconciliar(c, lista('AB'), 3);
    expect(s.aviso).toBeNull();
    expect(proximoEnvio(s.cola)).toEqual({ jugadas: lista('A'), version: 3 });
  });

  it('3. el servidor avanzó por la misma línea (guardado viejo sin historial): se sigue con lo del teléfono', () => {
    const s = reconciliar(base(lista('ABBA'), [], 0), lista('AB'), 5);
    expect(s.aviso).toBeNull();
    expect(s.cola.jugadas).toEqual(lista('ABBA'));
  });

  it('4. otro teléfono marcó más: se trae y se avisa (sin perder nada)', () => {
    const s = reconciliar(base(lista('A'), lista('A'), 2), lista('ABB'), 4);
    expect(s.aviso).toEqual({ tipo: 'traido' });
    expect(s.cola.jugadas).toEqual(lista('ABB'));
    expect(pendiente(s.cola)).toBe(false);
  });

  it('5. dos teléfonos marcaron distinto: manda el servidor, avisa cuántas quedaron afuera y guarda respaldo', () => {
    const local = lista('AAB');
    const s = reconciliar(base(local, lista('A'), 2), lista('ABA'), 4);
    expect(s.cola.jugadas).toEqual(lista('ABA'));
    expect(s.aviso).toEqual({ tipo: 'descartado', cantidad: 2, respaldo: local });
    expect(textoAviso(s.aviso as Aviso)).toMatch(/2 jugadas de este teléfono/);
  });

  it('5. alguien deshizo en otro teléfono algo que ya estaba subido: manda el servidor y se avisa', () => {
    const s = reconciliar(base(lista('ABB'), lista('ABB'), 5), lista('A'), 6);
    expect(s.cola.jugadas).toEqual(lista('A'));
    expect(s.aviso?.tipo).toBe('descartado');
  });

  it('el JSON del servidor viene con las claves en otro orden y es lo mismo', () => {
    const delServidor = JSON.parse('[{"derechaA":0,"derechaB":0,"saca":"A","t":"inicio"},{"gana":"A","t":"rally"}]') as Jugada[];
    expect(iguales(delServidor, lista('A'))).toBe(true);
  });
});

describe('al entrar (o recargar) con cosas guardadas en el teléfono', () => {
  it('servidor igual a lo último confirmado: manda el teléfono y se sube lo pendiente', () => {
    const local = { jugadas: lista('ABA'), subido: lista('A'), version: 2, enviados: [] };
    const s = alEntrar(local, lista('A'), 2);
    expect(s.aviso).toBeNull();
    expect(proximoEnvio(s.cola)).toEqual({ jugadas: lista('ABA'), version: 2 });
  });

  it('más jugadas en el teléfono NO alcanza para pisar: si el servidor cambió por otro lado, se avisa', () => {
    // Antes se usaba el teléfono solo por tener más jugadas. Ahora: otro teléfono deshizo y siguió.
    const local = { jugadas: lista('AAAA'), subido: lista('AAA'), version: 3, enviados: [] };
    const s = alEntrar(local, lista('AB'), 5);
    expect(s.cola.jugadas).toEqual(lista('AB'));
    expect(s.aviso?.tipo).toBe('descartado');
  });

  it('sin nada guardado: lo del servidor', () => {
    expect(alEntrar(null, lista('A'), 7).cola).toMatchObject({ jugadas: lista('A'), version: 7 });
  });

  it('lee lo guardado por la versión anterior de la pantalla', () => {
    expect(colaGuardada({ jugadas: lista('A'), version: 2, pendiente: false })).toEqual({ jugadas: lista('A'), subido: lista('A'), version: 2, enviados: [] });
    const viejo = colaGuardada({ jugadas: lista('AB'), version: 2, pendiente: true })!;
    // Pendiente viejo: el servidor tenía "A" en la versión 2 → se sigue con lo del teléfono (regla 3).
    expect(alEntrar(viejo, lista('A'), 2).cola.jugadas).toEqual(lista('AB'));
    expect(colaGuardada('basura')).toBeNull();
    expect(colaGuardada({ jugadas: 'x', version: 1 })).toBeNull();
  });
});

describe('respuestas de la base v36 y v37', () => {
  it('v36 y v37: ok y desfasado', () => {
    expect(interpretar({ ok: true, version: 4 }, null)).toEqual({ tipo: 'ok', version: 4, resultado: null });
    expect(interpretar({ ok: true }, null)).toMatchObject({ tipo: 'ok' }); // terminar v36
    expect(interpretar({ ok: false, error: 'desfasado', jugadas: lista('A'), version: 3 }, null)).toEqual({ tipo: 'desfasado', jugadas: lista('A'), version: 3 });
  });
  it('sin señal o error de la llamada', () => {
    expect(interpretar(null, { message: 'Failed to fetch' })).toEqual({ tipo: 'red' });
    expect(interpretar(undefined, null)).toEqual({ tipo: 'red' });
  });
  it('v37: partido cerrado (por el árbitro o en la mesa), freno y baja', () => {
    expect(interpretar({ ok: false, error: 'desfasado', estado: 'terminado', motivo: 'cargado_en_mesa', resultado: { puntosA: 11, puntosB: 9 }, jugadas: [], version: 9 }, null))
      .toMatchObject({ tipo: 'terminado', motivo: 'cargado_en_mesa', resultado: { puntosA: 11, puntosB: 9 } });
    expect(interpretar({ ok: true, estado: 'terminado', ya_cargado: true, resultado: { puntosA: 2, puntosB: 1, games: [{ a: 11, b: 3 }, { a: 5, b: 11 }, { a: 11, b: 9 }] } }, null))
      .toMatchObject({ tipo: 'ok', resultado: { puntosA: 2, puntosB: 1 } });
    expect(interpretar({ ok: false, error: 'Demasiados códigos incorrectos', bloqueado: true }, null)).toMatchObject({ tipo: 'bloqueado' });
    expect(interpretar({ ok: false, error: 'El código ya no es válido.', baja: true }, null).tipo).toBe('codigo');
    expect(interpretar({ ok: false, error: 'Jugadas inválidas.' }, null)).toEqual({ tipo: 'error', mensaje: 'Jugadas inválidas.' });
  });
  it('nunca muestra textos crudos', () => {
    for (const crudo of ['desfasado', 'red', 'error', '', undefined]) expect(mensajeAmigable(crudo)).not.toMatch(/^(desfasado|red|error)?$/);
    expect(interpretar({ ok: false, error: 'desfasado' }, null)).toMatchObject({ tipo: 'error' });
    expect((interpretar({ ok: false, error: 'desfasado' }, null) as { mensaje: string }).mensaje).not.toMatch(/desfasado/);
  });
});

// Simulación: un teléfono marcando con mala señal contra un servidor con control de versión. Pedidos que
// tardan, respuestas que se pierden (el cambio llegó igual), toques y deshacer en cualquier momento.
// Al final, con señal, el servidor tiene exactamente lo del teléfono y nunca se descartó nada.
describe('simulación con mala señal', () => {
  function azar(semilla: number) {
    let s = semilla >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
  }
  const visto = { desfasado: 0, respuestaPerdida: 0 };
  for (let semilla = 1; semilla <= 40; semilla++) {
    it(`semilla ${semilla}`, () => {
      const rnd = azar(semilla);
      const servidor = { jugadas: [] as Jugada[], version: 0 };
      let c = colaNueva([], 0);
      let enVuelo: { jugadas: Jugada[]; version: number } | null = null;
      const avisos: Aviso[] = [];
      const responder = (resp: Respuesta) => {
        const s = alResponder(c, enVuelo!, resp);
        c = s.cola; enVuelo = null;
        if (s.aviso) avisos.push(s.aviso);
      };
      const llegar = (envio: { jugadas: Jugada[]; version: number }): Respuesta => {
        if (envio.version !== servidor.version) visto.desfasado++;
        if (envio.version !== servidor.version) return { tipo: 'desfasado', jugadas: servidor.jugadas, version: servidor.version };
        servidor.jugadas = envio.jugadas; servidor.version++;
        return { tipo: 'ok', version: servidor.version };
      };
      for (let paso = 0; paso < 300; paso++) {
        const x = rnd();
        if (x < 0.45) c = jugar(c, c.jugadas.length === 0 ? ini : rnd() < 0.15 ? 'deshacer' : r(rnd() < 0.5 ? 'A' : 'B'));
        else if (x < 0.6 && !enVuelo) { const e = proximoEnvio(c); if (e) { c = alEnviar(c, e); enVuelo = e; } }
        else if (x < 0.75 && enVuelo) responder(llegar(enVuelo)); // llega y vuelve
        else if (x < 0.85 && enVuelo) { llegar(enVuelo); visto.respuestaPerdida++; responder({ tipo: 'red' }); } // llega pero la respuesta se pierde
        else if (x < 0.95 && enVuelo) responder({ tipo: 'red' }); // no llega
      }
      if (enVuelo) responder({ tipo: 'red' });
      // Vuelve la señal: se vacía la cola.
      for (let i = 0; i < 20; i++) {
        const e = proximoEnvio(c);
        if (!e) break;
        c = alEnviar(c, e); enVuelo = e;
        responder(llegar(e));
      }
      expect(pendiente(c)).toBe(false);
      expect(iguales(servidor.jugadas, c.jugadas)).toBe(true);
      expect(avisos.filter((a) => a.tipo === 'descartado' || a.tipo === 'traido')).toEqual([]);
    });
  }
  it('la simulación de verdad pasó por respuestas perdidas y desfasajes', () => {
    expect(visto.respuestaPerdida).toBeGreaterThan(50);
    expect(visto.desfasado).toBeGreaterThan(50);
  });
});
