// Tests de los handlers de DUPR con una base en memoria y un DUPR falso: verifican el
// cableado de punta a punta (qué se le pide a DUPR, qué queda guardado, qué se contesta).
// Vive en _lib/ y no en dupr/ a propósito: Vercel publica como función todo archivo de api/
// salvo los que empiezan con _.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Base en memoria ──────────────────────────────────────────────────────────
type Fila = Record<string, unknown>;
const base = vi.hoisted(() => ({
  tablas: {} as Record<string, Record<string, unknown>[]>,
  rpcs: [] as { nombre: string; args: Record<string, unknown> }[],
  errorRpc: null as string | null,
  equipo: null as string | null,
  tickets: 0,
}));

vi.mock('./equipo.js', () => ({ equipoDe: () => Promise.resolve(base.equipo) }));
vi.mock('./supabaseAdmin.js', () => ({
  clienteAdmin: () => ({
    from(nombre: string) {
      const tabla = (base.tablas[nombre] ??= []);
      const st = { op: 'select', filtros: [] as { tipo: 'eq' | 'in'; col: string; val: unknown }[], filas: [] as Fila[], patch: {} as Fila, conflicto: [] as string[], limite: 0 };
      const cumple = (f: Fila) => st.filtros.every((x) => (x.tipo === 'in' ? (x.val as unknown[]).includes(f[x.col]) : f[x.col] === x.val));
      const correr = (): { data: Fila[]; error: null } => {
        if (st.op === 'insert') {
          const nuevas = st.filas.map((r) => ({ ...(nombre === 'dupr_tickets' ? { ticket: `ticket-${++base.tickets}` } : {}), ...r }));
          tabla.push(...nuevas);
          return { data: nuevas, error: null };
        }
        if (st.op === 'upsert') {
          for (const r of st.filas) {
            const existente = tabla.find((f) => st.conflicto.every((col) => f[col] === r[col]));
            if (existente) Object.assign(existente, r); else tabla.push({ ...r });
          }
          return { data: [], error: null };
        }
        if (st.op === 'update') {
          const tocadas = tabla.filter(cumple);
          tocadas.forEach((f) => Object.assign(f, st.patch));
          return { data: tocadas, error: null };
        }
        const filas = tabla.filter(cumple).map((f) => ({ ...f }));
        return { data: st.limite ? filas.slice(0, st.limite) : filas, error: null };
      };
      const q = {
        select() { return q; },
        insert(r: Fila | Fila[]) { st.op = 'insert'; st.filas = Array.isArray(r) ? r : [r]; return q; },
        upsert(r: Fila | Fila[], o: { onConflict: string }) { st.op = 'upsert'; st.filas = Array.isArray(r) ? r : [r]; st.conflicto = o.onConflict.split(','); return q; },
        update(p: Fila) { st.op = 'update'; st.patch = p; return q; },
        eq(col: string, val: unknown) { st.filtros.push({ tipo: 'eq', col, val }); return q; },
        in(col: string, val: unknown[]) { st.filtros.push({ tipo: 'in', col, val }); return q; },
        order() { return q; },
        limit(n: number) { st.limite = n; return q; },
        maybeSingle() { return Promise.resolve({ data: correr().data[0] ?? null, error: null }); },
        single() { const f = correr().data[0]; return Promise.resolve(f ? { data: f, error: null } : { data: null, error: { message: 'sin filas' } }); },
        then(ok: (r: { data: Fila[]; error: null }) => unknown, mal?: (e: unknown) => unknown) { return Promise.resolve(correr()).then(ok, mal); },
      };
      return q;
    },
    rpc(nombre: string, args: Record<string, unknown>) {
      base.rpcs.push({ nombre, args });
      return Promise.resolve(base.errorRpc ? { data: null, error: { message: base.errorRpc } } : { data: { conexiones: 1, padron: 1 }, error: null });
    },
  }),
}));

import admin from '../dupr/admin.js';
import conectar from '../dupr/conectar.js';
import config from '../dupr/config.js';
import webhook from '../dupr/webhook.js';
import { huellaDe, olvidarToken } from './dupr.js';

// ── DUPR falso ───────────────────────────────────────────────────────────────
type Llamada = { metodo: string; ruta: string; headers: Record<string, string>; cuerpo: unknown };
const dupr = {
  llamadas: [] as Llamada[],
  // qué token de jugador pertenece a quién
  jugadores: {} as Record<string, { duprId: string; nombre: string; habilitado: boolean; clubes?: unknown[] }>,
  suscripcion: { status: 200, json: { status: 'SUCCESS', result: {} } as unknown },
  rechazar: {} as Record<string, string>, // identifier → error
  codigo: 5000,
};
function fetchFalso(url: string, init: RequestInit = {}): Promise<Response> {
  const u = new URL(String(url));
  const l: Llamada = {
    metodo: init.method ?? 'GET', ruta: `${u.host}${u.pathname}`,
    headers: (init.headers ?? {}) as Record<string, string>, cuerpo: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
  };
  dupr.llamadas.push(l);
  const responder = (json: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(json), { status }));
  const jugador = dupr.jugadores[(l.headers.Authorization ?? '').replace('Bearer ', '')];
  if (l.ruta === 'uat.mydupr.com/api/auth/v1.0/token') return responder({ status: 'SUCCESS', result: { token: 'tok-partner' } });
  if (l.ruta === 'api.uat.dupr.gg/public/user/info') {
    return jugador ? responder({ status: 'SUCCESS', results: [{ duprId: jugador.duprId, fullName: jugador.nombre, birthYear: 1975 }], errors: [] }) : responder({}, 401);
  }
  if (l.ruta === 'api.uat.dupr.gg/subscription/active') {
    return jugador ? responder({ subscriptions: [{ entitlements: { tournaments: jugador.habilitado ? ['BASIC_L1'] : [], merchandise: [] } }] }) : responder({}, 401);
  }
  if (l.ruta === 'api.uat.dupr.gg/user/club/membership') return jugador ? responder(jugador.clubes ?? []) : responder({}, 401);
  if (l.ruta.startsWith('uat.mydupr.com/api/user/v1.0/') && l.metodo === 'GET') {
    return responder({ status: 'SUCCESS', result: { id: u.pathname.split('/').pop(), fullName: 'Nombre Completo', ratings: { singles: '3.250', doubles: '3.600', singlesReliabilityScore: 50, doublesReliabilityScore: 70 } } });
  }
  if (l.ruta === 'uat.mydupr.com/api/user/v1.0/subscribe/webhook-event') return responder(dupr.suscripcion.json, dupr.suscripcion.status);
  if (l.ruta === 'uat.mydupr.com/api/v1.0/webhook') return responder({ status: 'SUCCESS', result: {} });
  if (l.ruta === 'uat.mydupr.com/api/match/v1.0/batch') {
    const partidos = l.cuerpo as { identifier: string }[];
    return responder({ status: 'SUCCESS', result: {
      matchCodes: partidos.filter((p) => !dupr.rechazar[p.identifier]).map((p) => ({ identifier: p.identifier, matchCode: String(++dupr.codigo), hashedMatchCode: 'H' })),
      errors: partidos.filter((p) => dupr.rechazar[p.identifier]).map((p) => ({ identifier: p.identifier, error: dupr.rechazar[p.identifier], errors: {} })),
    } });
  }
  if (l.ruta === 'uat.mydupr.com/api/match/v1.0/update' || l.ruta === 'uat.mydupr.com/api/match/v1.0/delete') return responder({ status: 'SUCCESS', result: {} });
  return responder({ status: 'FAILURE', message: `sin respuesta para ${l.ruta}` }, 404);
}

// ── Request/response falsos ──────────────────────────────────────────────────
function llamar(handler: (req: VercelRequest, res: VercelResponse) => unknown, req: Partial<VercelRequest>) {
  const r = { codigo: 0, cuerpo: undefined as unknown };
  const res = {
    status(c: number) { r.codigo = c; return res; },
    json(b: unknown) { r.cuerpo = b; return res; },
    end() { return res; },
    setHeader() { return res; },
  };
  return Promise.resolve(handler({ method: 'POST', body: {}, query: {}, headers: { host: 'volea.vercel.app' }, ...req } as unknown as VercelRequest, res as unknown as VercelResponse)).then(() => r);
}

const ENV = { DUPR_CLIENT_KEY: 'ck', DUPR_CLIENT_SECRET: 'cs', DUPR_WEBHOOK_SECRET: 'secreto-webhook', SUPABASE_SERVICE_ROLE_KEY: 'srk' };
const tabla = (nombre: string) => (base.tablas[nombre] ??= []);

beforeEach(() => {
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  base.rpcs.length = 0; base.errorRpc = null; base.equipo = null; base.tickets = 0;
  dupr.llamadas.length = 0; dupr.jugadores = {}; dupr.rechazar = {}; dupr.codigo = 5000;
  dupr.suscripcion = { status: 200, json: { status: 'SUCCESS', result: {} } };
  olvidarToken();
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.stubGlobal('fetch', fetchFalso);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('GET /api/dupr/config', () => {
  it('sin claves la web queda como antes', async () => {
    vi.stubEnv('DUPR_CLIENT_KEY', '');
    expect((await llamar(config, { method: 'GET' })).cuerpo).toEqual({ habilitado: false });
  });

  it('con claves dice el entorno y qué página de DUPR abrir', async () => {
    expect((await llamar(config, { method: 'GET' })).cuerpo).toEqual({
      habilitado: true, entorno: 'uat', login: `https://uat.dupr.gg/login-external-app/${Buffer.from('ck').toString('base64')}`, conClub: false,
    });
    expect((await llamar(config, { method: 'POST' })).codigo).toBe(405);
  });
});

describe('POST /api/dupr/conectar', () => {
  beforeEach(() => { dupr.jugadores['token-paula'] = { duprId: 'AAA111', nombre: 'Paula S.', habilitado: true }; });

  it('comprueba contra DUPR de quién es el token, guarda la conexión y devuelve un ticket', async () => {
    const r = await llamar(conectar, { body: { userToken: 'token-paula', refreshToken: 'refresh-paula', duprId: 'ZZZ999' } });
    expect(r.codigo).toBe(200);
    // el DUPR ID sale de DUPR, no de lo que mande el navegador
    expect(r.cuerpo).toEqual({
      ticket: 'ticket-1', duprId: 'AAA111', nombre: 'Paula S.', singles: 3.25, dobles: 3.6, anioNacimiento: 1975,
      habilitado: true, premium: false, delEquipo: false,
    });
    expect(tabla('dupr_conexiones')).toHaveLength(1);
    expect(tabla('dupr_conexiones')[0]).toMatchObject({
      entorno: 'uat', dupr_id: 'AAA111', nombre: 'Paula S.', anio_nacimiento: 1975,
      rating_singles: 3.25, rating_dobles: 3.6, habilitado: true, premium: false, suscripto: true,
    });
    expect(tabla('dupr_conexiones')[0]).not.toHaveProperty('admin_email');
    expect(tabla('dupr_tokens')[0]).toMatchObject({ dupr_id: 'AAA111', access_token: 'token-paula', refresh_token: 'refresh-paula' });
    expect(tabla('dupr_tickets')[0]).toMatchObject({ entorno: 'uat', dupr_id: 'AAA111' });
    const suscripcion = dupr.llamadas.find((l) => l.ruta.endsWith('/subscribe/webhook-event'))!;
    expect(suscripcion.cuerpo).toEqual({ duprIds: ['AAA111'], topic: 'RATING' });
  });

  it('un token que DUPR no reconoce no deja nada guardado', async () => {
    const r = await llamar(conectar, { body: { userToken: 'token-inventado' } });
    expect(r.codigo).toBe(401);
    expect(tabla('dupr_conexiones')).toEqual([]);
    expect(tabla('dupr_tickets')).toEqual([]);
  });

  it('sin token, o sin claves cargadas, ni llama a DUPR', async () => {
    expect((await llamar(conectar, { body: {} })).codigo).toBe(400);
    vi.stubEnv('DUPR_CLIENT_SECRET', '');
    expect((await llamar(conectar, { body: { userToken: 'token-paula' } })).codigo).toBe(503);
    expect(dupr.llamadas).toEqual([]);
  });

  it('si la suscripción falla la conexión vale igual y queda pendiente', async () => {
    dupr.suscripcion = { status: 400, json: { status: 'FAILURE', message: 'no webhook registered' } };
    const r = await llamar(conectar, { body: { userToken: 'token-paula' } });
    expect(r.codigo).toBe(200);
    expect(tabla('dupr_conexiones')[0].suscripto).toBeUndefined();
  });

  it('la cuenta de alguien del equipo solo se marca con sesión del panel', async () => {
    expect((await llamar(conectar, { body: { userToken: 'token-paula', comoEquipo: true } })).codigo).toBe(403);
    expect(tabla('dupr_conexiones')).toEqual([]);
    base.equipo = 'brian@volea.test';
    const r = await llamar(conectar, { body: { userToken: 'token-paula', comoEquipo: true } });
    expect((r.cuerpo as { delEquipo: boolean }).delEquipo).toBe(true);
    expect(tabla('dupr_conexiones')[0].admin_email).toBe('brian@volea.test');
  });
});

describe('POST /api/dupr/webhook', () => {
  const rating = { clientId: 'x', event: 'RATING', message: { duprId: 'AAA111', name: 'Paula', timestamp: 1, rating: { singles: '3.301', doubles: '3.655', singlesReliability: 55, doublesReliability: 72, matchId: 9 } } };

  it('sin el secreto de la URL no hace nada', async () => {
    expect((await llamar(webhook, { body: rating, query: {} })).codigo).toBe(401);
    expect((await llamar(webhook, { body: rating, query: { k: 'otro' } })).codigo).toBe(401);
    expect(base.rpcs).toEqual([]);
    expect(tabla('dupr_eventos')).toEqual([]);
  });

  it('contesta 200 a la prueba de registro', async () => {
    const r = await llamar(webhook, { body: { clientId: 'x', event: 'REGISTRATION' }, query: { k: 'secreto-webhook' } });
    expect(r.codigo).toBe(200);
    expect(tabla('dupr_eventos')[0]).toMatchObject({ entorno: 'uat', evento: 'REGISTRATION', dupr_id: null });
    expect(base.rpcs).toEqual([]);
  });

  it('guarda el rating nuevo y deja el aviso en la bitácora', async () => {
    tabla('dupr_conexiones').push({ entorno: 'uat', dupr_id: 'AAA111', suscripto: false });
    const r = await llamar(webhook, { body: rating, query: { k: 'secreto-webhook' } });
    expect(r.codigo).toBe(200);
    expect(base.rpcs).toEqual([{ nombre: 'dupr_aplicar_rating', args: {
      p_entorno: 'uat', p_dupr_id: 'AAA111', p_singles: 3.301, p_dobles: 3.655, p_fiabilidad_singles: 55, p_fiabilidad_dobles: 72,
    } }]);
    expect(tabla('dupr_conexiones')[0].suscripto).toBe(true);
    expect(tabla('dupr_eventos')[0]).toMatchObject({ evento: 'RATING', dupr_id: 'AAA111' });
  });

  it('lo que no entiende lo anota y contesta 200; si la base falla contesta 500', async () => {
    expect((await llamar(webhook, { body: { event: 'OTRO' }, query: { k: 'secreto-webhook' } })).cuerpo).toEqual({ ignorado: true });
    base.errorRpc = 'se cayó';
    expect((await llamar(webhook, { body: rating, query: { k: 'secreto-webhook' } })).codigo).toBe(500);
  });
});

describe('POST /api/dupr/admin', () => {
  const PEDIDO = { torneoId: 'sfem', fecha: '2026-09-20', lugar: 'Pickleball City, Montevideo', evento: 'VOLEA Aniversario 2026', puntaje: 'SIDEOUT' };
  const cuadro = () => ({
    id: 'sfem', nombre: 'SINGLES FEMENINO ANIVERSARIO',
    parejas: [{ id: 'p1', nombre: 'PAULA SEGURA', jugadorIds: ['j1'] }, { id: 'p2', nombre: 'MATILDE KLICHE', jugadorIds: ['j2'] }, { id: 'p3', nombre: 'TATIANA JORGE', jugadorIds: ['j3'] }],
    grupos: [{ id: 'g', nombre: 'A' }],
    partidosGrupo: [
      { id: 'm1', grupoId: 'g', aId: 'p1', bId: 'p2', puntosA: 11, puntosB: 7 },
      { id: 'm2', grupoId: 'g', aId: 'p1', bId: 'p3', puntosA: 11, puntosB: 9 },
      { id: 'm3', grupoId: 'g', aId: 'p2', bId: 'p3', puntosA: null, puntosB: null },
    ],
    partidosLlave: null,
  });
  type Revision = { partidos: { partidoId: string; estado: string; motivo: string | null; error: string | null }[]; resumen: Record<string, number>; hecho?: { subidos: number; actualizados: number; borrados: number; errores: unknown[]; pendientes: number } };
  const estados = (r: { cuerpo: unknown }) => (r.cuerpo as Revision).partidos.map((p) => `${p.partidoId} ${p.estado}${p.motivo ? ` (${p.motivo})` : ''}`);

  beforeEach(() => {
    base.equipo = 'brian@volea.test';
    tabla('rk_torneos').push({ id: 'sfem', data: cuadro() });
    tabla('rk_jugadores').push({ id: 'j1', nombre: 'Paula Segura', dupr_id: 'AAA111' }, { id: 'j2', nombre: 'Matilde Kliche', dupr_id: 'bbb222 ' }, { id: 'j3', nombre: 'Tatiana Jorge', dupr_id: 'CCC333' });
    const al_dia = new Date().toISOString();
    tabla('dupr_conexiones').push(
      { entorno: 'uat', dupr_id: 'AAA111', habilitado: true, suscripto: true, entitlements_at: al_dia },
      { entorno: 'uat', dupr_id: 'BBB222', habilitado: true, suscripto: false, entitlements_at: al_dia },
    );
  });

  it('sin sesión del equipo no responde nada', async () => {
    base.equipo = null;
    expect((await llamar(admin, { body: { accion: 'estado' } })).codigo).toBe(401);
    expect(dupr.llamadas).toEqual([]);
  });

  it('estado: sin claves avisa que faltan; con claves cuenta conexiones y muestra el webhook sin el secreto', async () => {
    const r = await llamar(admin, { body: { accion: 'estado' } });
    expect(r.cuerpo).toEqual({
      configurado: true, entorno: 'uat', clubId: null, webhook: 'https://volea.vercel.app/api/dupr/webhook?k=•••',
      conexiones: 2, sinSuscribir: 1, miCuenta: null,
    });
    vi.stubEnv('DUPR_WEBHOOK_SECRET', '');
    expect((await llamar(admin, { body: { accion: 'estado' } })).cuerpo).toEqual({ configurado: false });
    expect((await llamar(admin, { body: { accion: 'registrar-webhook' } })).codigo).toBe(503);
  });

  it('registra el webhook con el secreto en la URL y suscribe lo pendiente', async () => {
    expect((await llamar(admin, { body: { accion: 'registrar-webhook' } })).cuerpo).toEqual({ ok: true });
    expect(dupr.llamadas.find((l) => l.ruta === 'uat.mydupr.com/api/v1.0/webhook')!.cuerpo)
      .toEqual({ webhookUrl: 'https://volea.vercel.app/api/dupr/webhook?k=secreto-webhook', topics: ['RATING'] });
    expect((await llamar(admin, { body: { accion: 'suscribir-pendientes' } })).cuerpo).toEqual({ ok: true, suscriptos: 1 });
    expect(dupr.llamadas.find((l) => l.ruta.endsWith('/subscribe/webhook-event'))!.cuerpo).toEqual({ duprIds: ['BBB222'], topic: 'RATING' });
    expect(tabla('dupr_conexiones').every((x) => x.suscripto === true)).toBe(true);
  });

  it('revisa un cuadro sin subir nada: qué va, qué no y por qué', async () => {
    const r = await llamar(admin, { body: { accion: 'torneo', ...PEDIDO } });
    expect(estados(r)).toEqual(['m1 por subir', 'm2 no va (Tatiana Jorge todavía no conectó su cuenta DUPR)', 'm3 no va (Sin resultado)']);
    expect((r.cuerpo as Revision).resumen).toEqual({ subidos: 0, porSubir: 1, cambiaron: 0, porBorrar: 0, noVan: 2 });
    expect(dupr.llamadas).toEqual([]);
    expect((await llamar(admin, { body: { accion: 'torneo', ...PEDIDO, fecha: '9/10' } })).codigo).toBe(400);
    expect((await llamar(admin, { body: { accion: 'torneo', ...PEDIDO, fecha: '2099-01-01' } })).cuerpo).toEqual({ error: 'DUPR no acepta partidos con fecha futura' });
    expect((await llamar(admin, { body: { accion: 'torneo', ...PEDIDO, torneoId: 'no-existe' } })).codigo).toBe(404);
  });

  it('sube, después corrige lo que cambió y borra lo que pasó a W.O.', async () => {
    tabla('dupr_conexiones').push({ entorno: 'uat', dupr_id: 'CCC333', habilitado: true, suscripto: true, entitlements_at: new Date().toISOString() });
    const r1 = await llamar(admin, { body: { accion: 'sincronizar', ...PEDIDO } });
    expect((r1.cuerpo as Revision).hecho).toEqual({ subidos: 2, actualizados: 0, borrados: 0, errores: [], pendientes: 0 });
    expect(estados(r1)).toEqual(['m1 subido', 'm2 subido', 'm3 no va (Sin resultado)']);
    const lote = dupr.llamadas.find((l) => l.ruta.endsWith('/match/v1.0/batch'))!.cuerpo as Record<string, unknown>[];
    expect(lote.map((p) => p.identifier)).toEqual(['volea-uat-sfem-m1-1', 'volea-uat-sfem-m2-1']);
    expect(lote[0]).toMatchObject({ teamA: { player1: 'AAA111', game1: 11 }, teamB: { player1: 'BBB222', game1: 7 }, format: 'SINGLES', matchSource: 'PARTNER', matchDate: '2026-09-20' });
    expect(tabla('dupr_partidos').map((f) => `${f.partido_id} ${f.estado} ${f.match_code} ${f.por}`)).toEqual(['m1 subido 5001 brian@volea.test', 'm2 subido 5002 brian@volea.test']);

    // otra pasada sin cambios: no le pide nada a DUPR
    dupr.llamadas.length = 0;
    const r2 = await llamar(admin, { body: { accion: 'sincronizar', ...PEDIDO } });
    expect((r2.cuerpo as Revision).hecho).toMatchObject({ subidos: 0, actualizados: 0, borrados: 0 });
    expect(dupr.llamadas.filter((l) => l.ruta.includes('/match/'))).toEqual([]);

    // se corrige el resultado del m1 y el m2 pasa a W.O.
    const t = tabla('rk_torneos')[0].data as ReturnType<typeof cuadro>;
    t.partidosGrupo[0].puntosB = 9;
    Object.assign(t.partidosGrupo[1], { wo: true });
    const r3 = await llamar(admin, { body: { accion: 'sincronizar', ...PEDIDO } });
    expect((r3.cuerpo as Revision).hecho).toMatchObject({ subidos: 0, actualizados: 1, borrados: 1, errores: [] });
    expect(dupr.llamadas.find((l) => l.ruta.endsWith('/match/v1.0/update'))!.cuerpo).toMatchObject({ matchId: 5001, identifier: 'volea-uat-sfem-m1-1', teamB: { game1: 9 } });
    expect(dupr.llamadas.find((l) => l.ruta.endsWith('/match/v1.0/delete'))!).toMatchObject({ metodo: 'DELETE', cuerpo: { matchCode: '5002', identifier: 'volea-uat-sfem-m2-1' } });
    expect(estados(r3)).toEqual(['m1 subido', 'm2 no va (W.O.: no se jugó)', 'm3 no va (Sin resultado)']);
    expect(tabla('dupr_partidos').find((f) => f.partido_id === 'm2')!.estado).toBe('borrado');

    // si el m2 al final se jugó, vuelve a subir con OTRO identifier (DUPR no deja reutilizarlo)
    delete (t.partidosGrupo[1] as { wo?: boolean }).wo;
    dupr.llamadas.length = 0;
    await llamar(admin, { body: { accion: 'sincronizar', ...PEDIDO } });
    expect((dupr.llamadas.find((l) => l.ruta.endsWith('/match/v1.0/batch'))!.cuerpo as { identifier: string }[]).map((p) => p.identifier)).toEqual(['volea-uat-sfem-m2-2']);
  });

  it('lo que DUPR rechaza queda marcado con el motivo y se puede reintentar', async () => {
    dupr.rechazar['volea-uat-sfem-m1-1'] = 'player1 lacks BASIC_L1';
    const r = await llamar(admin, { body: { accion: 'sincronizar', ...PEDIDO } });
    expect((r.cuerpo as Revision).hecho).toMatchObject({ subidos: 0, errores: [{ partidoId: 'm1', error: 'player1 lacks BASIC_L1' }] });
    expect((r.cuerpo as Revision).partidos[0]).toMatchObject({ estado: 'por subir', error: 'player1 lacks BASIC_L1' });
    dupr.rechazar = {};
    const r2 = await llamar(admin, { body: { accion: 'sincronizar', ...PEDIDO } });
    expect((r2.cuerpo as Revision).partidos[0]).toMatchObject({ estado: 'subido', error: null });
  });

  it('antes de subir vuelve a pedir la habilitación vencida y deja afuera a quien la perdió', async () => {
    const hace2dias = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    tabla('dupr_conexiones')[1].entitlements_at = hace2dias;
    tabla('dupr_tokens').push({ entorno: 'uat', dupr_id: 'BBB222', access_token: 'token-matilde', refresh_token: null });
    dupr.jugadores['token-matilde'] = { duprId: 'BBB222', nombre: 'Matilde', habilitado: false };
    const r = await llamar(admin, { body: { accion: 'sincronizar', ...PEDIDO } });
    expect(estados(r)[0]).toBe('m1 no va (Matilde Kliche no está habilitado en DUPR)');
    expect(dupr.llamadas.filter((l) => l.ruta.includes('/match/'))).toEqual([]);
  });

  it('con club: solo sube quien es director u organizador de ese club en DUPR', async () => {
    vi.stubEnv('DUPR_CLUB_ID', '7614955351');
    const sinCuenta = await llamar(admin, { body: { accion: 'sincronizar', ...PEDIDO } });
    expect(sinCuenta.codigo).toBe(403);
    expect((sinCuenta.cuerpo as { error: string }).error).toContain('conectá tu cuenta DUPR');

    tabla('dupr_conexiones').push({ entorno: 'uat', dupr_id: 'BRI001', nombre: 'Brian', admin_email: 'brian@volea.test', suscripto: true });
    tabla('dupr_tokens').push({ entorno: 'uat', dupr_id: 'BRI001', access_token: 'token-brian', refresh_token: null });
    dupr.jugadores['token-brian'] = { duprId: 'BRI001', nombre: 'Brian', habilitado: true, clubes: [{ clubId: 7614955351, clubName: 'VOLEA', role: 'PLAYER' }] };
    const sinRol = await llamar(admin, { body: { accion: 'sincronizar', ...PEDIDO } });
    expect(sinRol.codigo).toBe(403);
    expect((sinRol.cuerpo as { error: string }).error).toContain('no es directora ni organizadora');
    expect(dupr.llamadas.filter((l) => l.ruta.includes('/match/'))).toEqual([]);
    expect(((await llamar(admin, { body: { accion: 'estado' } })).cuerpo as { miCuenta: unknown }).miCuenta).toEqual({ duprId: 'BRI001', nombre: 'Brian', club: 'sin-rol' });

    dupr.jugadores['token-brian'].clubes = [{ clubId: 7614955351, clubName: 'VOLEA', role: 'ORGANIZER' }];
    const ok = await llamar(admin, { body: { accion: 'sincronizar', ...PEDIDO } });
    expect((ok.cuerpo as Revision).hecho).toMatchObject({ subidos: 1 });
    expect((dupr.llamadas.find((l) => l.ruta.endsWith('/match/v1.0/batch'))!.cuerpo as Record<string, unknown>[])[0]).toMatchObject({ matchSource: 'CLUB', clubId: 7614955351 });
    expect(tabla('dupr_partidos')[0].huella).toBe(huellaDe(tabla('dupr_partidos')[0].payload as never));
  });
});
