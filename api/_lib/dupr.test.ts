import { beforeEach, describe, expect, it } from 'vitest';
import {
  ErrorDupr, aRating, actualizarPartido, borrarPartido, clubesDe, configDupr, crearPartidos, habilitacionDe, huellaDe,
  identifierDe, infoBasica, interpretarAviso, leerClubes, leerHabilitacion, olvidarToken, partidosParaDupr,
  planificarSubida, puedeSubirPorElClub, refrescarToken, registrarWebhook, secretoValido, suscribirRating,
  tokenPartner, urlLogin, usuarioPartner,
} from './dupr.js';
import type { ConfigDupr, CuerpoPartido, FilaSubida, JugadorParaDupr, TorneoParaDupr } from './dupr.js';

const ENV = { DUPR_CLIENT_KEY: 'ck-prueba', DUPR_CLIENT_SECRET: 'cs-secreto', DUPR_WEBHOOK_SECRET: 'w-secreto' };
const cfg = (extra: Record<string, string> = {}): ConfigDupr => configDupr({ ...ENV, ...extra })!;

// ── DUPR falso ───────────────────────────────────────────────────────────────
type Llamada = { metodo: string; url: string; headers: Record<string, string>; cuerpo: unknown };
function duprFalso(responder: (l: Llamada) => { status?: number; json?: unknown } | undefined) {
  const llamadas: Llamada[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const l: Llamada = {
      metodo: init.method ?? 'GET', url: String(url),
      headers: (init.headers ?? {}) as Record<string, string>,
      cuerpo: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    llamadas.push(l);
    const r = (l.url.endsWith('/auth/v1.0/token')
      ? { json: { status: 'SUCCESS', result: { token: `tok-${llamadas.filter((x) => x.url.endsWith('/token')).length}` } } }
      : responder(l)) ?? { status: 404, json: { status: 'FAILURE', message: 'no existe' } };
    return new Response(r.json === undefined ? '' : JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, llamadas, sinToken: () => llamadas.filter((l) => !l.url.endsWith('/token')) };
}
const OK = { json: { status: 'SUCCESS', result: {} } };

beforeEach(() => olvidarToken());

describe('configDupr', () => {
  it('sin las tres claves no hay integración', () => {
    expect(configDupr({})).toBeNull();
    expect(configDupr({ DUPR_CLIENT_KEY: 'k', DUPR_CLIENT_SECRET: 's' })).toBeNull();
    expect(configDupr({ ...ENV, DUPR_WEBHOOK_SECRET: '  ' })).toBeNull();
  });

  it('por defecto apunta al ambiente de prueba; producción solo si se pide', () => {
    expect(cfg().entorno).toBe('uat');
    expect(cfg().urls).toEqual({ partner: 'https://uat.mydupr.com/api', publico: 'https://api.uat.dupr.gg', login: 'https://uat.dupr.gg' });
    expect(cfg({ DUPR_ENTORNO: 'cualquiera' }).entorno).toBe('uat');
    const prod = cfg({ DUPR_ENTORNO: ' PROD ' });
    expect(prod.entorno).toBe('prod');
    expect(prod.urls).toEqual({ partner: 'https://prod.mydupr.com/api', publico: 'https://api.dupr.gg', login: 'https://dashboard.dupr.com' });
  });

  it('lee el club y deja pisar las URL para probar contra un DUPR simulado', () => {
    expect(cfg().clubId).toBeNull();
    expect(cfg({ DUPR_CLUB_ID: '7614955351' }).clubId).toBe(7614955351);
    expect(cfg({ DUPR_CLUB_ID: 'abc' }).clubId).toBeNull();
    expect(cfg({ DUPR_URL_PARTNER: 'http://localhost:4010/api/' }).urls.partner).toBe('http://localhost:4010/api');
  });

  it('arma la página de login con la client key en base64', () => {
    expect(urlLogin(cfg())).toBe(`https://uat.dupr.gg/login-external-app/${Buffer.from('ck-prueba').toString('base64')}`);
  });
});

describe('token de partner', () => {
  it('lo pide con base64(key:secret) en x-authorization y lo reutiliza', async () => {
    const d = duprFalso(() => OK);
    expect(await tokenPartner(cfg(), d.fetchFn, 1_000)).toBe('tok-1');
    expect(await tokenPartner(cfg(), d.fetchFn, 2_000)).toBe('tok-1');
    expect(d.llamadas).toHaveLength(1);
    expect(d.llamadas[0]).toMatchObject({ metodo: 'POST', url: 'https://uat.mydupr.com/api/auth/v1.0/token' });
    expect(d.llamadas[0].headers['x-authorization']).toBe(Buffer.from('ck-prueba:cs-secreto').toString('base64'));
  });

  it('pide otro cuando al guardado le quedan menos de 5 minutos', async () => {
    const d = duprFalso(() => OK);
    await tokenPartner(cfg(), d.fetchFn, 0);
    expect(await tokenPartner(cfg(), d.fetchFn, 51 * 60_000)).toBe('tok-2');
  });

  it('si DUPR no lo entrega, falla con el detalle', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ status: 'FAILURE', message: 'Invalid credentials' }), { status: 401 })) as unknown as typeof fetch;
    await expect(tokenPartner(cfg(), fetchFn)).rejects.toBeInstanceOf(ErrorDupr);
  });

  it('un 401 en una llamada hace pedir un token nuevo y reintentar una vez', async () => {
    let primera = true;
    const d = duprFalso((l) => {
      if (l.url.endsWith('/v1.0/webhook') && primera) { primera = false; return { status: 401, json: {} }; }
      return OK;
    });
    expect(await registrarWebhook(cfg(), 'https://volea.vercel.app/api/dupr/webhook?k=x', d.fetchFn)).toEqual({ ok: true, detalle: 'HTTP 200' });
    expect(d.sinToken().map((l) => l.headers.Authorization)).toEqual(['Bearer tok-1', 'Bearer tok-2']);
  });
});

describe('avisos de rating: registro y suscripción', () => {
  it('registra la URL con el tema RATING', async () => {
    const d = duprFalso(() => OK);
    await registrarWebhook(cfg(), 'https://volea.vercel.app/api/dupr/webhook?k=x', d.fetchFn);
    expect(d.sinToken()[0]).toMatchObject({
      metodo: 'POST', url: 'https://uat.mydupr.com/api/v1.0/webhook',
      cuerpo: { webhookUrl: 'https://volea.vercel.app/api/dupr/webhook?k=x', topics: ['RATING'] },
    });
  });

  it('cuenta por qué DUPR rechazó el registro', async () => {
    const d = duprFalso(() => ({ status: 400, json: { status: 'FAILURE', message: 'The specified webhook did not respond with a 200 OK' } }));
    expect(await registrarWebhook(cfg(), 'https://x', d.fetchFn)).toEqual({ ok: false, detalle: 'The specified webhook did not respond with a 200 OK' });
  });

  it('suscribe jugadores y no llama si no hay ninguno', async () => {
    const d = duprFalso(() => OK);
    expect((await suscribirRating(cfg(), [], d.fetchFn)).ok).toBe(true);
    expect(d.llamadas).toHaveLength(0);
    await suscribirRating(cfg(), ['4Z6K9G', 'LWN6OZ'], d.fetchFn);
    expect(d.sinToken()[0]).toMatchObject({
      metodo: 'POST', url: 'https://uat.mydupr.com/api/user/v1.0/subscribe/webhook-event',
      cuerpo: { duprIds: ['4Z6K9G', 'LWN6OZ'], topic: 'RATING' },
    });
  });
});

describe('datos de un jugador', () => {
  it('lee nombre y ratings de la API de partner', async () => {
    const d = duprFalso(() => ({ json: { status: 'SUCCESS', result: { id: '4Z6K9G', fullName: 'Gabriela Velazquez', ratings: { singles: '3.152', doubles: 'NR', singlesReliabilityScore: 62, doublesReliabilityScore: 10 } } } }));
    expect(await usuarioPartner(cfg(), '4Z6K9G', d.fetchFn)).toEqual({
      duprId: '4Z6K9G', nombre: 'Gabriela Velazquez', singles: 3.152, dobles: null, fiabilidadSingles: 62, fiabilidadDobles: 10,
    });
    expect(d.sinToken()[0].url).toBe('https://uat.mydupr.com/api/user/v1.0/4Z6K9G');
  });

  it('si DUPR no lo deja ver (todavía no conectó) devuelve null', async () => {
    const d = duprFalso(() => ({ status: 403, json: { status: 'FAILURE' } }));
    expect(await usuarioPartner(cfg(), '4Z6K9G', d.fetchFn)).toBeNull();
  });

  it('convierte ratings de texto y descarta lo que no es un rating', () => {
    expect([aRating('4.125'), aRating(3.5), aRating('NR'), aRating(''), aRating(null), aRating('0'), aRating('3.14159')]).toEqual([4.125, 3.5, null, null, null, null, 3.142]);
  });
});

describe('con el token del jugador', () => {
  it('lee quién es y qué aceptó compartir', async () => {
    const d = duprFalso(() => ({ json: { status: 'SUCCESS', results: [{ duprId: '4z6k9g', fullName: 'Gabriela V.', birthYear: 1971, gender: 'FEMALE' }], errors: [] } }));
    expect(await infoBasica(cfg(), 'token-jugador', d.fetchFn)).toEqual({ duprId: '4Z6K9G', nombre: 'Gabriela V.', genero: 'FEMALE', anioNacimiento: 1971, ubicacion: null });
    expect(d.llamadas[0]).toMatchObject({ metodo: 'GET', url: 'https://api.uat.dupr.gg/public/user/info', headers: { Authorization: 'Bearer token-jugador' } });
  });

  it('un fallo que llega como HTTP 200 con FAILURE no pasa por válido', async () => {
    const falla = duprFalso(() => ({ json: { status: 'FAILURE', results: [], errors: [{ message: 'no consent' }] } }));
    expect(await infoBasica(cfg(), 't', falla.fetchFn)).toBeNull();
    const vencido = duprFalso(() => ({ status: 401, json: {} }));
    expect(await infoBasica(cfg(), 't', vencido.fetchFn)).toBeNull();
  });

  it('lee la habilitación con o sin la lista de suscripciones', async () => {
    expect(leerHabilitacion({ subscriptions: [{ status: 'active', displayName: 'DUPR+', entitlements: { tournaments: ['BASIC_L1', 'PREMIUM_L1', 'VERIFIED_L1'], merchandise: ['PREMIUM_L1'] } }] }))
      .toMatchObject({ habilitado: true, premium: true, verificado: true });
    expect(leerHabilitacion({ displayName: 'DUPR', entitlements: { tournaments: ['BASIC_L1'], merchandise: [] } })).toMatchObject({ habilitado: true, premium: false });
    // PREMIUM en mercadería no es estar habilitado para torneos
    expect(leerHabilitacion({ subscriptions: [{ entitlements: { tournaments: [], merchandise: ['PREMIUM_L1'] } }] })).toMatchObject({ habilitado: false, premium: false });
    const d = duprFalso(() => ({ json: { subscriptions: [{ entitlements: { tournaments: ['BASIC_L1'] } }] } }));
    expect(await habilitacionDe(cfg(), 't', d.fetchFn)).toMatchObject({ habilitado: true, premium: false });
    expect(d.llamadas[0]).toMatchObject({ metodo: 'POST', url: 'https://api.uat.dupr.gg/subscription/active' });
  });

  it('lee los clubes en cualquiera de las formas y dice si puede subir por el club', async () => {
    const club = { clubId: 7614955351, clubName: 'VOLEA', role: 'director' };
    for (const forma of [[club], { membership: [club] }, { status: 'SUCCESS', results: [club] }, { result: [club] }]) {
      expect(leerClubes(forma)).toEqual([{ clubId: 7614955351, clubName: 'VOLEA', role: 'DIRECTOR' }]);
    }
    expect(leerClubes({ status: 'FAILURE' })).toEqual([]);
    expect(puedeSubirPorElClub(leerClubes([club]), 7614955351)).toBe(true);
    expect(puedeSubirPorElClub(leerClubes([{ ...club, role: 'PLAYER' }]), 7614955351)).toBe(false);
    expect(puedeSubirPorElClub(leerClubes([club]), 111)).toBe(false);
    const d = duprFalso(() => ({ json: [club] }));
    expect(await clubesDe(cfg(), 't', d.fetchFn)).toHaveLength(1);
    expect(d.llamadas[0].url).toBe('https://api.uat.dupr.gg/user/club/membership');
  });

  it('renueva el par de tokens con el refresh token', async () => {
    const d = duprFalso(() => ({ json: { status: 'SUCCESS', result: { accessToken: 'nuevo', refreshToken: 'nuevo-refresh' } } }));
    expect(await refrescarToken(cfg(), 'viejo-refresh', d.fetchFn)).toEqual({ accessToken: 'nuevo', refreshToken: 'nuevo-refresh' });
    expect(d.llamadas[0]).toMatchObject({ metodo: 'GET', url: 'https://api.uat.dupr.gg/auth/v2.0/refresh', headers: { 'x-refresh-token': 'viejo-refresh' } });
    const v1 = duprFalso(() => ({ json: { status: 'SUCCESS', result: 'solo-access' } }));
    expect(await refrescarToken(cfg(), 'r', v1.fetchFn)).toEqual({ accessToken: 'solo-access', refreshToken: null });
    const vencido = duprFalso(() => ({ status: 401, json: { status: 'FAILURE' } }));
    expect(await refrescarToken(cfg(), 'r', vencido.fetchFn)).toBeNull();
  });
});

describe('avisos que manda DUPR', () => {
  it('compara el secreto de la URL', () => {
    expect(secretoValido('w-secreto', 'w-secreto')).toBe(true);
    expect(secretoValido('w-secretO', 'w-secreto')).toBe(false);
    expect(secretoValido('corto', 'w-secreto')).toBe(false);
    expect(secretoValido(undefined, 'w-secreto')).toBe(false);
  });

  it('reconoce la prueba de registro, el rating y la foto inicial', () => {
    expect(interpretarAviso({ clientId: 'x', event: 'REGISTRATION' })).toEqual({ tipo: 'registro' });
    expect(interpretarAviso({
      clientId: 'x', event: 'RATING',
      message: { duprId: '4z6k9g', name: 'Gabriela', timestamp: 1, rating: { singles: '3.152', doubles: '3.401', singlesReliability: 62.5, doublesReliability: 80, matchId: 99 } },
    })).toEqual({ tipo: 'rating', evento: 'RATING', duprId: '4Z6K9G', singles: 3.152, dobles: 3.401, fiabilidadSingles: 62.5, fiabilidadDobles: 80 });
    // un jugador que nunca jugó: la foto inicial llega sin rating
    expect(interpretarAviso({ event: 'RATING_SEED', message: { duprId: 'LWN6OZ', rating: null, metrics: null } }))
      .toEqual({ tipo: 'rating', evento: 'RATING_SEED', duprId: 'LWN6OZ', singles: null, dobles: null, fiabilidadSingles: null, fiabilidadDobles: null });
  });

  it('ignora lo que no entiende sin romperse', () => {
    expect(interpretarAviso(null).tipo).toBe('ignorado');
    expect(interpretarAviso('hola').tipo).toBe('ignorado');
    expect(interpretarAviso({ event: 'OTRA_COSA' })).toEqual({ tipo: 'ignorado', motivo: 'evento OTRA_COSA' });
    expect(interpretarAviso({ event: 'RATING', message: {} }).tipo).toBe('ignorado');
  });
});

// ── De un cuadro a partidos de DUPR ──────────────────────────────────────────
const OPC = { fecha: '2026-10-09', lugar: 'Pickleball City, Montevideo', evento: 'VOLEA Aniversario Pickleball City 2026', puntaje: 'SIDEOUT' as const, clubId: null };
const jugador = (nombre: string, duprId: string | null, extra: Partial<JugadorParaDupr> = {}): JugadorParaDupr => ({ nombre, duprId, conectado: true, habilitado: true, ...extra });

function singles(): { t: TorneoParaDupr; padron: Map<string, JugadorParaDupr> } {
  const t: TorneoParaDupr = {
    id: 'sfem', nombre: 'SINGLES FEMENINO ANIVERSARIO',
    parejas: [
      { id: 'p1', nombre: 'PAULA SEGURA', jugadorIds: ['j1'] }, { id: 'p2', nombre: 'MATILDE KLICHE', jugadorIds: ['j2'] },
      { id: 'p3', nombre: 'TATIANA JORGE', jugadorIds: ['j3'] }, { id: 'p4', nombre: 'MIA BATISTA' },
    ],
    grupos: [{ id: 'g', nombre: 'A' }],
    partidosGrupo: [
      { id: 'm1', grupoId: 'g', aId: 'p1', bId: 'p2', puntosA: 11, puntosB: 7 },
      { id: 'm2', grupoId: 'g', aId: 'p1', bId: 'p3', puntosA: 0, puntosB: 11, wo: true },
      { id: 'm3', grupoId: 'g', aId: 'p2', bId: 'p3', puntosA: null, puntosB: null },
      { id: 'm4', grupoId: 'g', aId: 'p1', bId: 'p4', puntosA: 11, puntosB: 2 },
      { id: 'm5', grupoId: 'g', aId: 'p2', bId: 'p3', puntosA: 5, puntosB: 3 },
    ],
    partidosLlave: null,
  };
  const padron = new Map([['j1', jugador('Paula Segura', 'AAA111')], ['j2', jugador('Matilde Kliche', 'BBB222')], ['j3', jugador('Tatiana Jorge', 'CCC333')]]);
  return { t, padron };
}

describe('partidosParaDupr', () => {
  it('arma el partido de singles como lo pide DUPR', () => {
    const { t, padron } = singles();
    const [m1] = partidosParaDupr(t, padron, OPC);
    expect(m1).toEqual({
      partidoId: 'm1', fase: 'Grupo A', a: 'PAULA SEGURA', b: 'MATILDE KLICHE', puntos: [11, 7], motivo: null,
      cuerpo: {
        location: 'Pickleball City, Montevideo', matchDate: '2026-10-09',
        teamA: { player1: 'AAA111', game1: 11 }, teamB: { player1: 'BBB222', game1: 7 },
        format: 'SINGLES', event: 'VOLEA Aniversario Pickleball City 2026', bracket: 'SINGLES FEMENINO ANIVERSARIO · Grupo A',
        matchType: 'SIDEOUT', matchSource: 'PARTNER', matchPlayType: 'TOURNAMENT',
      },
    });
  });

  it('dice por qué un partido no va: W.O., sin resultado, sin vincular, menos de 6 puntos', () => {
    const { t, padron } = singles();
    expect(partidosParaDupr(t, padron, OPC).map((p) => `${p.partidoId}: ${p.motivo}`)).toEqual([
      'm1: null',
      'm2: W.O.: no se jugó',
      'm3: Sin resultado',
      'm4: MIA BATISTA no está vinculada al padrón',
      'm5: DUPR no acepta un partido en el que el ganador hizo menos de 6 puntos',
    ]);
  });

  it('dice quién no tiene DUPR, quién no conectó y quién no está habilitado', () => {
    const { t, padron } = singles();
    const motivo = (j: JugadorParaDupr) => partidosParaDupr(t, new Map(padron).set('j2', j), OPC)[0].motivo;
    expect(motivo(jugador('Matilde Kliche', null))).toBe('Matilde Kliche no tiene DUPR');
    expect(motivo(jugador('Matilde Kliche', 'BBB222', { conectado: false }))).toBe('Matilde Kliche todavía no conectó su cuenta DUPR');
    expect(motivo(jugador('Matilde Kliche', 'BBB222', { habilitado: false }))).toBe('Matilde Kliche no está habilitado en DUPR');
    // si todavía no se pudo consultar la habilitación, no se frena: DUPR lo vuelve a controlar al subir
    expect(motivo(jugador('Matilde Kliche', 'BBB222', { habilitado: null }))).toBeNull();
    expect(motivo(jugador('Matilde Kliche', 'AAA111'))).toBe('Hay un jugador repetido en el partido');
  });

  it('dobles con club y la llave con sus ganadores', () => {
    const t: TorneoParaDupr = {
      id: 'mixa', nombre: 'DOBLE MIXTO A ANIVERSARIO',
      parejas: [
        { id: 'p1', nombre: 'GASTON y PAULA', jugadorIds: ['j1', 'j2'] }, { id: 'p2', nombre: 'FABIAN y MARCELA', jugadorIds: ['j3', 'j4'] },
        { id: 'p3', nombre: 'HERNAN y GABRIELA', jugadorIds: ['j5', 'j6'] },
      ],
      grupos: [], partidosGrupo: [],
      partidosLlave: [
        { id: 'pase', ronda: 1, a: { tipo: 'seed', parejaId: 'p1' }, b: null, puntosA: null, puntosB: null, esTercerPuesto: false },
        { id: 'sf', ronda: 1, a: { tipo: 'seed', parejaId: 'p2' }, b: { tipo: 'seed', parejaId: 'p3' }, puntosA: 9, puntosB: 11, esTercerPuesto: false },
        { id: 'final', ronda: 2, a: { tipo: 'ganadorDe', partidoId: 'pase' }, b: { tipo: 'ganadorDe', partidoId: 'sf' }, puntosA: 11, puntosB: 6, esTercerPuesto: false },
      ],
    };
    const padron = new Map(['j1', 'j2', 'j3', 'j4', 'j5', 'j6'].map((id, i) => [id, jugador(`Jugador ${i + 1}`, `ID000${i + 1}`)]));
    const partidos = partidosParaDupr(t, padron, { ...OPC, puntaje: 'RALLY', clubId: 7614955351 });
    expect(partidos.map((p) => `${p.fase}: ${p.a} vs ${p.b}`)).toEqual(['Semifinal: FABIAN y MARCELA vs HERNAN y GABRIELA', 'Final: GASTON y PAULA vs HERNAN y GABRIELA']);
    expect(partidos[1].cuerpo).toMatchObject({
      teamA: { player1: 'ID0001', player2: 'ID0002', game1: 11 }, teamB: { player1: 'ID0005', player2: 'ID0006', game1: 6 },
      format: 'DOUBLES', matchType: 'RALLY', matchSource: 'CLUB', clubId: 7614955351, bracket: 'DOBLE MIXTO A ANIVERSARIO · Final',
    });
  });
});

describe('subir, corregir y borrar partidos', () => {
  const cuerpo = (game1 = 11): CuerpoPartido => ({
    location: 'x', matchDate: '2026-10-09', teamA: { player1: 'AAA111', game1 }, teamB: { player1: 'BBB222', game1: 7 },
    format: 'SINGLES', event: 'e', bracket: 'b', matchType: 'SIDEOUT', matchSource: 'PARTNER', matchPlayType: 'TOURNAMENT',
  });
  const partido = (partidoId: string, c: CuerpoPartido | null) => ({ partidoId, fase: 'Grupo A', a: 'A', b: 'B', puntos: null, motivo: c ? null : 'W.O.: no se jugó', cuerpo: c });
  const fila = (partido_id: string, extra: Partial<FilaSubida> = {}): FilaSubida => ({
    partido_id, intento: 1, identifier: identifierDe('uat', 'sfem', partido_id, 1), match_code: '5001', huella: huellaDe(cuerpo()), estado: 'subido', ...extra,
  });

  it('el identifier es único por entorno, cuadro, partido e intento', () => {
    expect(identifierDe('uat', 'sfem', 'm1', 1)).toBe('volea-uat-sfem-m1-1');
    expect(identifierDe('prod', 'sfem', 'm1', 2)).toBe('volea-prod-sfem-m1-2');
    expect(huellaDe(cuerpo())).toBe(huellaDe(cuerpo()));
    expect(huellaDe(cuerpo())).not.toBe(huellaDe(cuerpo(12)));
  });

  it('sube lo nuevo, no toca lo que está igual, corrige lo que cambió y borra lo que dejó de ir', () => {
    const plan = planificarSubida(
      [partido('nuevo', cuerpo()), partido('igual', cuerpo()), partido('cambio', cuerpo(12)), partido('pasoAWO', null), partido('nuncaFue', null)],
      [fila('igual'), fila('cambio'), fila('pasoAWO', { match_code: '5003' })],
      'uat', 'sfem',
    );
    expect(plan.estados).toEqual({ nuevo: 'por subir', igual: 'subido', cambio: 'cambió', pasoAWO: 'por borrar', nuncaFue: 'no va' });
    expect(plan.acciones.map((a) => `${a.tipo} ${a.partidoId} ${a.identifier}`)).toEqual([
      'subir nuevo volea-uat-sfem-nuevo-1', 'actualizar cambio volea-uat-sfem-cambio-1', 'borrar pasoAWO volea-uat-sfem-pasoAWO-1',
    ]);
  });

  it('lo que se borró vuelve a subir con otro identifier; lo que falló se reintenta con el mismo', () => {
    const plan = planificarSubida(
      [partido('borrado', cuerpo()), partido('fallo', cuerpo())],
      [fila('borrado', { estado: 'borrado' }), fila('fallo', { estado: 'error', match_code: null })],
      'uat', 'sfem',
    );
    expect(plan.acciones.map((a) => `${a.tipo} ${a.identifier}`)).toEqual(['subir volea-uat-sfem-borrado-2', 'subir volea-uat-sfem-fallo-1']);
  });

  it('un partido subido que ya no existe en el cuadro (llave rearmada) se borra', () => {
    const plan = planificarSubida([partido('m1', cuerpo())], [fila('m1'), fila('viejo', { match_code: '5009' })], 'uat', 'sfem');
    expect(plan.acciones).toEqual([{ tipo: 'borrar', partidoId: 'viejo', intento: 1, identifier: 'volea-uat-sfem-viejo-1', matchCode: '5009' }]);
  });

  it('crea partidos en lote y separa los que DUPR rechazó', async () => {
    const d = duprFalso(() => ({ json: { status: 'PARTIAL', result: {
      matchCodes: [{ identifier: 'volea-uat-sfem-m1-1', matchCode: '5001', hashedMatchCode: '9P45OZ7VR' }],
      errors: [{ identifier: 'volea-uat-sfem-m4-1', error: 'Match with identifier already exists', errors: { teamA: ['player1 lacks BASIC_L1'] } }],
    } } }));
    const r = await crearPartidos(cfg(), [{ ...cuerpo(), identifier: 'volea-uat-sfem-m1-1' }, { ...cuerpo(), identifier: 'volea-uat-sfem-m4-1' }], d.fetchFn);
    expect(r.creados).toEqual([{ identifier: 'volea-uat-sfem-m1-1', matchCode: '5001', hashedMatchCode: '9P45OZ7VR' }]);
    expect(r.errores).toEqual([{ identifier: 'volea-uat-sfem-m4-1', error: 'Match with identifier already exists · teamA: player1 lacks BASIC_L1' }]);
    expect(d.sinToken()[0]).toMatchObject({ metodo: 'POST', url: 'https://uat.mydupr.com/api/match/v1.0/batch' });
    expect(Array.isArray(d.sinToken()[0].cuerpo)).toBe(true);
  });

  it('no manda más de 100 por pedido y avisa si DUPR rechaza todo', async () => {
    const d = duprFalso(() => ({ status: 403, json: { status: 'FAILURE', message: 'Forbidden' } }));
    await expect(crearPartidos(cfg(), Array.from({ length: 101 }, (_, i) => ({ ...cuerpo(), identifier: `i${i}` })), d.fetchFn)).rejects.toThrow('hasta 100');
    await expect(crearPartidos(cfg(), [{ ...cuerpo(), identifier: 'i' }], d.fetchFn)).rejects.toThrow('Forbidden');
    expect((await crearPartidos(cfg(), [], d.fetchFn)).creados).toEqual([]);
  });

  it('corrige con el matchCode como número y borra con matchCode + identifier', async () => {
    const d = duprFalso(() => OK);
    expect((await actualizarPartido(cfg(), '5001', { ...cuerpo(12), identifier: 'volea-uat-sfem-m1-1' }, d.fetchFn)).ok).toBe(true);
    expect((await borrarPartido(cfg(), '5001', 'volea-uat-sfem-m1-1', d.fetchFn)).ok).toBe(true);
    const [act, bor] = d.sinToken();
    expect(act).toMatchObject({ metodo: 'POST', url: 'https://uat.mydupr.com/api/match/v1.0/update', cuerpo: { matchId: 5001, identifier: 'volea-uat-sfem-m1-1', teamA: { game1: 12 } } });
    expect(bor).toMatchObject({ metodo: 'DELETE', url: 'https://uat.mydupr.com/api/match/v1.0/delete', cuerpo: { matchCode: '5001', identifier: 'volea-uat-sfem-m1-1' } });
  });
});
