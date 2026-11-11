// Base Supabase FALSA en memoria para las pruebas de punta a punta.
//
// Se engancha a Playwright (context.route + context.routeWebSocket) e intercepta TODO lo que la app
// le manda a Supabase. Nada sale a la red: la URL del proyecto real está fijada en
// src/services/supabaseClient.ts (no lee VITE_SUPABASE_URL), así que acá se intercepta ESE host y
// cualquier otro host externo se aborta. Implementa lo mínimo que usa la parte de torneos:
//
//   · GoTrue: /auth/v1/health, token (password y refresh), user, logout.
//   · PostgREST: select/insert/upsert/update/delete con los filtros eq/neq/in/gt/gte/lt/lte/is,
//     maybeSingle/single (Accept object+json), Prefer return=representation, count=exact (HEAD).
//   · RLS aproximada (ver POLITICAS): rk_torneos anon solo visible=true, escritura solo equipo, etc.
//   · RPC: is_admin_email, arbitro_entrar, arbitro_marcar, arbitro_terminar (versión v36),
//     admin_codigos_torneo — traducción línea por línea del SQL de
//     supabase/migraciones_propuestas/v35_arbitraje.sql y v36_arbitraje_formato_por_partido.sql.
//   · Realtime (Phoenix vsn 2.0.0, el que usa realtime-js 2.99): join con ids de postgres_changes,
//     heartbeat y push de INSERT/UPDATE/DELETE en las tablas que cambian.
//
// Lo que NO es fiel está listado en e2e/README.md (sección "Aproximaciones").

const PROYECTO = 'scftuxrtflfowohiewsc';
const HOST = `${PROYECTO}.supabase.co`;

const CLAVES = {
  rk_torneos: ['id'],
  rk_jugadores: ['id'],
  rk_config: ['id'],
  rk_en_cancha: ['cancha'],
  rk_programa: ['clave'],
  arbitraje_partidos: ['torneo_id', 'partido_id'],
  arbitraje_codigos: ['codigo'],
  admins: ['email'],
};

// Columnas timestamptz: se guardan como ms y se devuelven como lo hace Postgres ("+00:00", nunca "Z").
const COLUMNAS_FECHA = new Set(['updated_at', 'actualizado', 'creado', 'created_at', 'cuando']);

// Tablas que el realtime publica (supabase_realtime). arbitraje_partidos sale de v35; las rk_* las
// escucha En vivo ('envivo-programacion') y se asumen publicadas.
const PUBLICADAS = new Set(['arbitraje_partidos', 'rk_torneos', 'rk_en_cancha', 'rk_programa']);

function isoPg(ms) {
  // "2026-11-11T12:34:56.789+00:00" (Postgres guarda µs; el cliente manda ms: quedan ms).
  return new Date(ms).toISOString().replace('Z', '+00:00');
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function clonar(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

class FakeSupabase {
  constructor(opciones = {}) {
    this.admins = opciones.admins ?? [{ email: 'brian@volea.uy', password: 'clave-e2e-123', name: 'Brian', role: 'owner', activo: true }];
    // Todos los celulares de la prueba salen por la MISMA IP pública (como en el wifi del club):
    // así se comporta el freno de arbitro_entrar en producción (x-forwarded-for). Se puede cambiar.
    this.ipPorContexto = opciones.ipPorContexto ?? (() => '190.64.0.1');
    this.ahoraMs = opciones.ahora ?? (() => Date.now());
    this.tablas = new Map();
    for (const t of Object.keys(CLAVES)) this.tablas.set(t, []);
    this.tablas.set('arbitraje_intentos', []);
    for (const a of this.admins) this.tablas.get('admins').push({ email: a.email, name: a.name, role: a.role, activo: a.activo });
    // Canchas del tablero de En vivo (rk_en_cancha) como las tiene producción para el evento.
    this.tablas.get('rk_en_cancha').push(
      { cancha: 'Cancha 1', torneo_id: null, partido_id: null, updated_at: this.ahoraMs(), habilitada: true },
      { cancha: 'Cancha 2', torneo_id: null, partido_id: null, updated_at: this.ahoraMs(), habilitada: true },
    );
    this.sesiones = new Map(); // access_token -> { email, refresh }
    this.refrescos = new Map(); // refresh_token -> email
    this.log = []; // { t, metodo, ruta, rol, status }
    this.sinImplementar = new Map(); // "GET products" -> veces
    this.sockets = new Set();
    this.siguienteIdBinding = 1000;
    this.rpcCaida = new Set(); // nombres de RPC que se fuerzan a fallar (500)
    this.demoraMs = 0;
    // Contextos "sin señal": Playwright no aplica setOffline a los pedidos que se resuelven con
    // route.fulfill, así que el corte de red se simula acá (abort = falla de red de verdad).
    this.cortados = new Set();
  }

  // ─── Enganche a Playwright ──────────────────────────────────────────────────

  async instalar(context, etiqueta = 'ctx') {
    context.__etiquetaFake = etiqueta;
    // El dev server de la prueba (E2E_BASE, por defecto 5311) se deja pasar; todo lo demás se intercepta.
    const puerto = new URL(process.env.E2E_BASE || 'http://127.0.0.1:5311').port || '80';
    const propio = new RegExp(`^https?://(127\\.0\\.0\\.1|localhost):${puerto}/`);
    await context.route((url) => !propio.test(url.href) && !url.href.startsWith('data:') && !url.href.startsWith('blob:'), async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (this.cortados.has(etiqueta)) {
        this.registrar({ metodo: req.method(), ruta: u.pathname, rol: '-', status: 'SIN RED (corte simulado)', ctx: etiqueta });
        return route.abort('internetdisconnected');
      }
      if (u.host !== HOST) {
        this.registrar({ metodo: req.method(), ruta: req.url(), rol: '-', status: 'ABORTADO (host externo)', ctx: etiqueta });
        return route.abort('blockedbyclient');
      }
      try {
        const r = await this.atender(req, etiqueta);
        if (this.demoraMs) await new Promise((res) => setTimeout(res, this.demoraMs));
        await route.fulfill(r);
      } catch (e) {
        this.registrar({ metodo: req.method(), ruta: u.pathname, rol: '-', status: `EXCEPCION ${e && e.message}`, ctx: etiqueta });
        await route.fulfill({ status: 500, headers: this.cors({ 'content-type': 'application/json' }), body: JSON.stringify({ message: String(e && e.stack) }) });
      }
    });
    await context.routeWebSocket((url) => url.host === HOST, (ws) => this.socketNuevo(ws, etiqueta));
  }

  cors(extra = {}) {
    return {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
      'access-control-expose-headers': 'content-range, x-supabase-api-version',
      ...extra,
    };
  }

  json(status, body, extra = {}) {
    return { status, headers: this.cors({ 'content-type': 'application/json; charset=utf-8', ...extra }), body: body === undefined ? '' : JSON.stringify(body) };
  }

  registrar(e) { this.log.push({ t: new Date().toISOString(), ...e }); }

  quien(req) {
    const h = req.headers();
    const auth = h.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const s = this.sesiones.get(token);
    if (s) {
      const admin = this.tablas.get('admins').find((a) => a.email === s.email);
      return { rol: 'authenticated', email: s.email, equipo: !!admin && admin.activo !== false && ['owner', 'admin'].includes(admin.role) };
    }
    return { rol: 'anon', email: null, equipo: false };
  }

  async atender(req, etiqueta) {
    const u = new URL(req.url());
    const metodo = req.method();
    if (metodo === 'OPTIONS') return { status: 204, headers: this.cors(), body: '' };
    const yo = this.quien(req);
    let r;
    if (u.pathname.startsWith('/auth/v1/')) r = this.auth(u, metodo, req);
    else if (u.pathname.startsWith('/rest/v1/rpc/')) r = this.rpc(u.pathname.slice('/rest/v1/rpc/'.length), this.cuerpo(req), yo, etiqueta);
    else if (u.pathname.startsWith('/rest/v1/')) r = this.rest(u, metodo, req, yo);
    else if (u.pathname.startsWith('/storage/v1/')) { this.anotarSinImplementar(`${metodo} storage`); r = this.json(404, { message: 'storage no implementado en la base falsa' }); }
    else { this.anotarSinImplementar(`${metodo} ${u.pathname}`); r = this.json(404, { message: 'no implementado' }); }
    this.registrar({ metodo, ruta: u.pathname + (u.search.length < 160 ? u.search : u.search.slice(0, 160) + '…'), rol: yo.rol, status: r.status, ctx: etiqueta });
    return r;
  }

  cuerpo(req) {
    const t = req.postData();
    if (!t) return null;
    try { return JSON.parse(t); } catch { return t; }
  }

  anotarSinImplementar(clave) { this.sinImplementar.set(clave, (this.sinImplementar.get(clave) ?? 0) + 1); }

  // ─── GoTrue ─────────────────────────────────────────────────────────────────

  sesionPara(email) {
    const ahora = Math.floor(this.ahoraMs() / 1000);
    const id = `user-${Buffer.from(email).toString('hex').slice(0, 12)}`;
    const access = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: id, email, role: 'authenticated', aud: 'authenticated', exp: ahora + 3600, iat: ahora, session_id: `s${Math.random().toString(36).slice(2)}` })}.firma-falsa`;
    const refresh = `r${Math.random().toString(36).slice(2)}`;
    this.sesiones.set(access, { email });
    this.refrescos.set(refresh, email);
    return {
      access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: ahora + 3600, refresh_token: refresh,
      user: this.usuario(email),
    };
  }

  usuario(email) {
    return {
      id: `user-${Buffer.from(email).toString('hex').slice(0, 12)}`, aud: 'authenticated', role: 'authenticated', email,
      email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, identities: [],
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    };
  }

  auth(u, metodo, req) {
    const p = u.pathname.slice('/auth/v1/'.length);
    if (p === 'health') return this.json(200, { version: 'fake', name: 'GoTrue', description: 'base falsa e2e' });
    if (p === 'token' && metodo === 'POST') {
      const tipo = u.searchParams.get('grant_type');
      const b = this.cuerpo(req) || {};
      if (tipo === 'password') {
        const a = this.admins.find((x) => x.email === String(b.email || '').toLowerCase());
        if (!a || a.password !== b.password) return this.json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials', error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return this.json(200, this.sesionPara(a.email));
      }
      if (tipo === 'refresh_token') {
        const email = this.refrescos.get(b.refresh_token);
        if (!email) return this.json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
        return this.json(200, this.sesionPara(email));
      }
    }
    if (p === 'user' && metodo === 'GET') {
      const yo = this.quien(req);
      if (!yo.email) return this.json(401, { code: 401, msg: 'invalid JWT' });
      return this.json(200, this.usuario(yo.email));
    }
    if (p === 'logout') return { status: 204, headers: this.cors(), body: '' };
    this.anotarSinImplementar(`${metodo} auth/${p}`);
    return this.json(404, { msg: `auth ${p} no implementado en la base falsa` });
  }

  // ─── PostgREST ──────────────────────────────────────────────────────────────

  filas(tabla) {
    if (!this.tablas.has(tabla)) this.tablas.set(tabla, []);
    return this.tablas.get(tabla);
  }

  // RLS aproximada. Devuelve { leer(fila), escribir } para el rol.
  politica(tabla, yo) {
    switch (tabla) {
      case 'rk_torneos':
        // anon: SELECT solo visible = true. Escritura: is_admin() (owner/admin).
        return { leer: (f) => yo.equipo || f.visible === true, escribir: yo.equipo };
      case 'rk_jugadores':
      case 'rk_config':
      case 'rk_programa':
        return { leer: () => true, escribir: yo.equipo };
      case 'rk_en_cancha':
        return { leer: () => true, escribir: yo.equipo }; // v22: solo el equipo
      case 'arbitraje_partidos':
        return { leer: () => true, escribir: false }; // v35: solo por RPC
      case 'arbitraje_codigos':
      case 'arbitraje_intentos':
        return { leer: () => false, escribir: false, sinGrant: true }; // REVOKE ALL
      case 'admins':
        return { leer: (f) => !!yo.email && f.email === yo.email, escribir: false };
      default:
        return null; // tabla fuera del alcance de torneos
    }
  }

  serializar(tabla, fila) {
    const o = {};
    for (const [k, v] of Object.entries(fila)) o[k] = COLUMNAS_FECHA.has(k) && typeof v === 'number' ? isoPg(v) : clonar(v);
    if (tabla === 'rk_torneos') o.evento = (fila.data && typeof fila.data.evento === 'string' && fila.data.evento.trim()) ? fila.data.evento.trim() : null; // APROXIMACION: columna derivada del documento
    return o;
  }

  normalizarEntrada(fila) {
    const o = {};
    for (const [k, v] of Object.entries(fila)) o[k] = COLUMNAS_FECHA.has(k) && typeof v === 'string' ? Date.parse(v) : clonar(v);
    return o;
  }

  aplicaFiltro(fila, col, expr) {
    const neg = expr.startsWith('not.');
    const e = neg ? expr.slice(4) : expr;
    const i = e.indexOf('.');
    const op = e.slice(0, i);
    const val = e.slice(i + 1);
    let v = fila[col];
    if (col === 'evento' && fila.data) v = fila.data.evento ?? null;
    const comoTexto = (x) => (x === null || x === undefined ? null : typeof x === 'object' ? JSON.stringify(x) : String(x));
    const igual = (x, y) => {
      if (COLUMNAS_FECHA.has(col)) return typeof x === 'number' && Date.parse(y) === x;
      return comoTexto(x) === y;
    };
    let ok;
    switch (op) {
      case 'eq': ok = igual(v, val); break;
      case 'neq': ok = !igual(v, val); break;
      case 'in': {
        const lista = val.replace(/^\(/, '').replace(/\)$/, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
        ok = lista.some((x) => igual(v, x));
        break;
      }
      case 'is': ok = val === 'null' ? v === null || v === undefined : val === 'true' ? v === true : val === 'false' ? v === false : false; break;
      case 'gt': case 'gte': case 'lt': case 'lte': {
        const a = COLUMNAS_FECHA.has(col) ? v : Number(v);
        const b = COLUMNAS_FECHA.has(col) ? Date.parse(val) : Number(val);
        ok = op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
        break;
      }
      default: throw new Error(`filtro ${op} no implementado en la base falsa`);
    }
    return neg ? !ok : ok;
  }

  filtrar(tabla, filas, u) {
    const reservados = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
    let res = filas;
    for (const [col, expr] of u.searchParams) {
      if (reservados.has(col)) continue;
      res = res.filter((f) => this.aplicaFiltro(f, col, expr));
    }
    return res;
  }

  proyectar(tabla, fila, select) {
    const o = this.serializar(tabla, fila);
    if (!select || select.trim() === '*') return o;
    const cols = select.split(',').map((s) => s.trim()).filter(Boolean);
    const r = {};
    for (const c of cols) {
      if (c === '*') Object.assign(r, o);
      else r[c] = o[c] === undefined ? null : o[c];
    }
    return r;
  }

  errorRls(tabla) {
    return this.json(401, { code: '42501', details: null, hint: null, message: `new row violates row-level security policy for table "${tabla}"` });
  }

  rest(u, metodo, req, yo) {
    const tabla = u.pathname.slice('/rest/v1/'.length);
    const h = req.headers();
    const prefer = h.prefer || '';
    const accept = h.accept || '';
    const pol = this.politica(tabla, yo);
    if (!pol) {
      // Fuera del alcance (tienda, caja, inscripciones…): vacío y se anota.
      this.anotarSinImplementar(`${metodo} ${tabla}`);
      if (metodo === 'GET' || metodo === 'HEAD') return this.json(200, [], { 'content-range': '*/0' });
      return this.json(201, []);
    }
    if (pol.sinGrant) return this.json(401, { code: '42501', message: `permission denied for table ${tabla}` });
    const todas = this.filas(tabla);
    const select = u.searchParams.get('select');
    const representacion = /return=representation/.test(prefer);

    if (metodo === 'GET' || metodo === 'HEAD') {
      let res = this.filtrar(tabla, todas.filter(pol.leer), u);
      const order = u.searchParams.get('order');
      if (order) {
        const [col, dir] = order.split('.');
        res = [...res].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      const salida = res.map((f) => this.proyectar(tabla, f, select));
      const extra = { 'content-range': `0-${Math.max(0, salida.length - 1)}/${salida.length}` };
      if (metodo === 'HEAD') return { status: 200, headers: this.cors(extra), body: '' };
      if (accept.includes('vnd.pgrst.object+json')) {
        if (salida.length !== 1) return this.json(406, { code: 'PGRST116', details: `The result contains ${salida.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' });
        return this.json(200, salida[0], extra);
      }
      return this.json(200, salida, extra);
    }

    if (!pol.escribir) return this.errorRls(tabla);
    const claves = CLAVES[tabla] ?? ['id'];
    const claveDe = (f) => claves.map((k) => String(f[k])).join('|');
    const cambios = [];

    if (metodo === 'POST') {
      const cuerpo = this.cuerpo(req);
      const lista = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
      const merge = /resolution=merge-duplicates/.test(prefer);
      const ignorar = /resolution=ignore-duplicates/.test(prefer);
      const afectadas = [];
      for (const crudo of lista) {
        const f = this.normalizarEntrada(crudo);
        if (tabla === 'rk_torneos' && f.updated_at === undefined) f.updated_at = this.ahoraMs();
        const i = todas.findIndex((x) => claveDe(x) === claveDe(f));
        if (i >= 0) {
          if (ignorar) continue;
          if (!merge) return this.json(409, { code: '23505', details: `Key (${claves.join(', ')})=(${claveDe(f)}) already exists.`, hint: null, message: `duplicate key value violates unique constraint "${tabla}_pkey"` });
          const vieja = todas[i];
          todas[i] = { ...vieja, ...f };
          cambios.push({ tipo: 'UPDATE', nueva: todas[i], vieja });
          afectadas.push(todas[i]);
        } else {
          todas.push(f);
          cambios.push({ tipo: 'INSERT', nueva: f, vieja: null });
          afectadas.push(f);
        }
      }
      this.difundir(tabla, cambios);
      if (representacion) return this.json(201, afectadas.map((f) => this.proyectar(tabla, f, select)));
      return { status: 201, headers: this.cors(), body: '' };
    }

    if (metodo === 'PATCH') {
      const parche = this.normalizarEntrada(this.cuerpo(req) || {});
      const objetivo = this.filtrar(tabla, todas.filter(pol.leer), u);
      for (const f of objetivo) {
        const vieja = { ...f };
        Object.assign(f, parche);
        cambios.push({ tipo: 'UPDATE', nueva: f, vieja });
      }
      this.difundir(tabla, cambios);
      if (representacion) return this.json(200, objetivo.map((f) => this.proyectar(tabla, f, select)));
      return { status: 204, headers: this.cors(), body: '' };
    }

    if (metodo === 'DELETE') {
      const objetivo = new Set(this.filtrar(tabla, todas.filter(pol.leer), u));
      const quedan = todas.filter((f) => !objetivo.has(f));
      this.tablas.set(tabla, quedan);
      for (const f of objetivo) cambios.push({ tipo: 'DELETE', nueva: null, vieja: f });
      this.difundir(tabla, cambios);
      if (representacion) return this.json(200, [...objetivo].map((f) => this.proyectar(tabla, f, select)));
      return { status: 204, headers: this.cors(), body: '' };
    }
    return this.json(405, { message: `método ${metodo} no implementado` });
  }

  // ─── RPC (traducción del SQL) ───────────────────────────────────────────────

  rpc(nombre, args, yo, etiqueta) {
    args = args || {};
    if (this.rpcCaida.has(nombre)) return this.json(500, { code: 'XX000', message: `caída forzada de ${nombre}` });
    switch (nombre) {
      case 'is_admin_email': {
        const a = this.tablas.get('admins').find((x) => x.email === String(args.p_email || '').trim().toLowerCase());
        return this.json(200, !!a && a.activo !== false);
      }
      case 'arbitro_entrar': return this.json(200, this.arbitroEntrar(args, etiqueta));
      case 'arbitro_marcar': return this.json(200, this.arbitroMarcar(args));
      case 'arbitro_terminar': return this.json(200, this.arbitroTerminar(args));
      case 'admin_codigos_torneo':
        if (yo.rol !== 'authenticated') return this.json(401, { code: '42501', message: 'permission denied for function admin_codigos_torneo' });
        return this.json(200, this.adminCodigos(args, yo));
      default:
        this.anotarSinImplementar(`rpc ${nombre}`);
        return this.json(404, { code: 'PGRST202', details: null, hint: null, message: `Could not find the function public.${nombre} in the schema cache` });
    }
  }

  partidoArb(torneoId, partidoId) {
    return this.filas('arbitraje_partidos').find((p) => p.torneo_id === torneoId && p.partido_id === partidoId);
  }

  arbitroEntrar({ p_codigo }, etiqueta) {
    const origen = this.ipPorContexto(etiqueta) || 'sin-origen';
    const intentos = this.filas('arbitraje_intentos');
    const ahora = this.ahoraMs();
    if (intentos.filter((i) => i.origen === origen && i.cuando > ahora - 10 * 60000).length >= 10) {
      return { ok: false, error: 'Demasiados códigos incorrectos: esperá unos minutos.' };
    }
    const c = this.filas('arbitraje_codigos').find((x) => x.codigo === String(p_codigo ?? '').trim());
    if (!c) {
      intentos.push({ origen, cuando: ahora });
      this.tablas.set('arbitraje_intentos', intentos.filter((i) => i.cuando >= ahora - 86400000));
      return { ok: false, error: 'Código incorrecto o el partido ya terminó.' };
    }
    const p = this.partidoArb(c.torneo_id, c.partido_id) || {};
    return { ok: true, torneo_id: c.torneo_id, partido_id: c.partido_id, formato: clonar(p.formato ?? null), dobles: p.dobles ?? null, jugadas: clonar(p.jugadas ?? null), version: p.version ?? null, estado: p.estado ?? null };
  }

  arbitroMarcar({ p_codigo, p_version, p_jugadas, p_marcador }) {
    const c = this.filas('arbitraje_codigos').find((x) => x.codigo === String(p_codigo ?? '').trim());
    if (!c) return { ok: false, error: 'El código ya no es válido.' };
    if (!Array.isArray(p_jugadas) || p_jugadas.length > 1500) return { ok: false, error: 'Jugadas inválidas.' };
    const p = this.partidoArb(c.torneo_id, c.partido_id);
    if (p && p.version === p_version && p.estado !== 'terminado') {
      const vieja = { ...p };
      p.jugadas = clonar(p_jugadas);
      p.marcador = clonar(p_marcador);
      p.version += 1;
      p.estado = p_jugadas.length > 0 ? 'en_juego' : 'pendiente';
      p.actualizado = this.ahoraMs();
      this.difundir('arbitraje_partidos', [{ tipo: 'UPDATE', nueva: p, vieja }]);
      return { ok: true, version: p.version };
    }
    return { ok: false, error: 'desfasado', jugadas: clonar(p ? p.jugadas : null), version: p ? p.version : null };
  }

  static resultadoLegal(f, r) {
    const obj = Number(f && f.a);
    const pa = r && r.puntosA != null ? Math.trunc(Number(r.puntosA)) : null;
    const pb = r && r.puntosB != null ? Math.trunc(Number(r.puntosB)) : null;
    if (pa === null || pb === null || pa === pb) return false;
    if (Number((f && f.mejorDe) ?? 1) === 1) return Math.max(pa, pb) >= obj && Math.abs(pa - pb) >= 2;
    if (Math.max(pa, pb) !== 2 || Math.min(pa, pb) > 1 || !Array.isArray(r.games)) return false;
    let ga = 0; let gb = 0;
    for (const g of r.games) {
      const a = Math.trunc(Number(g.a)); const b = Math.trunc(Number(g.b));
      if (!(Math.max(a, b) >= obj && Math.abs(a - b) >= 2)) return false;
      if (a > b) ga++; else gb++;
    }
    return ga === pa && gb === pb;
  }

  arbitroTerminar({ p_codigo, p_version, p_jugadas, p_marcador, p_resultado }) {
    const c = this.filas('arbitraje_codigos').find((x) => x.codigo === String(p_codigo ?? '').trim());
    if (!c) return { ok: false, error: 'El código ya no es válido.' };
    const p = this.partidoArb(c.torneo_id, c.partido_id);
    if (!p || p.version !== p_version) return { ok: false, error: 'desfasado', jugadas: clonar(p ? p.jugadas : null), version: p ? p.version : null };
    let formato = Array.isArray(p_jugadas) && p_jugadas[0] ? p_jugadas[0].formato : undefined;
    const valido = formato && typeof formato === 'object' && ['rally', 'sideout'].includes(formato.tipo)
      && ['11', '15', '21'].includes(String(formato.a)) && ['1', '3'].includes(String(formato.mejorDe ?? '1'));
    if (!valido) formato = p.formato;
    if (!FakeSupabase.resultadoLegal(formato, p_resultado)) return { ok: false, error: 'El resultado no cierra con el formato del partido.' };
    const fila = this.filas('rk_torneos').find((t) => t.id === c.torneo_id);
    if (!fila || !fila.data) return { ok: false, error: 'El torneo ya no existe.' };
    let lista = null; let idx = -1;
    for (const l of ['partidosGrupo', 'partidosLlave']) {
      const arr = Array.isArray(fila.data[l]) ? fila.data[l] : [];
      idx = arr.findIndex((x) => x && x.id === c.partido_id);
      if (idx >= 0) { lista = l; break; }
    }
    if (!lista) return { ok: false, error: 'El partido ya no está en el cuadro (¿se rearmó?).' };
    const elem = fila.data[lista][idx];
    if (elem.puntosA !== null && elem.puntosA !== undefined) return { ok: false, error: 'Ese partido ya tiene un resultado cargado.' };
    const ahora = this.ahoraMs();
    const nuevoElem = { ...elem, puntosA: Math.trunc(Number(p_resultado.puntosA)), puntosB: Math.trunc(Number(p_resultado.puntosB)), cargadoEl: new Date(ahora).toISOString() };
    if (Array.isArray(p_resultado.games)) nuevoElem.games = clonar(p_resultado.games);
    const viejaT = { ...fila };
    const data = clonar(fila.data);
    data[lista][idx] = nuevoElem;
    fila.data = data;
    fila.updated_at = ahora;
    this.difundir('rk_torneos', [{ tipo: 'UPDATE', nueva: fila, vieja: viejaT }]);
    const cambiosCancha = [];
    for (const ec of this.filas('rk_en_cancha')) {
      if (ec.partido_id === c.partido_id) { const v = { ...ec }; ec.torneo_id = null; ec.partido_id = null; ec.updated_at = ahora; cambiosCancha.push({ tipo: 'UPDATE', nueva: ec, vieja: v }); }
    }
    this.difundir('rk_en_cancha', cambiosCancha);
    const viejaP = { ...p };
    p.jugadas = clonar(p_jugadas); p.marcador = clonar(p_marcador); p.formato = clonar(formato); p.estado = 'terminado'; p.version += 1; p.actualizado = ahora;
    this.difundir('arbitraje_partidos', [{ tipo: 'UPDATE', nueva: p, vieja: viejaP }]);
    this.tablas.set('arbitraje_codigos', this.filas('arbitraje_codigos').filter((x) => x.codigo !== c.codigo));
    return { ok: true };
  }

  adminCodigos({ p_torneo_id, p_dobles, p_partidos }, yo) {
    if (!yo.equipo) return { ok: false, error: 'solo el equipo' };
    if (!Array.isArray(p_partidos)) return { ok: false, error: 'lista inválida' };
    const partidos = this.filas('arbitraje_partidos');
    const codigos = this.filas('arbitraje_codigos');
    const cambios = [];
    for (const x of p_partidos) {
      let p = this.partidoArb(p_torneo_id, x.partido_id);
      if (!p) {
        p = { torneo_id: p_torneo_id, partido_id: x.partido_id, estado: 'pendiente', formato: clonar(x.formato), dobles: p_dobles, jugadas: [], marcador: null, version: 0, actualizado: this.ahoraMs() };
        partidos.push(p);
        cambios.push({ tipo: 'INSERT', nueva: p, vieja: null });
      } else if (p.estado === 'pendiente') {
        const v = { ...p };
        p.formato = clonar(x.formato); p.dobles = p_dobles;
        cambios.push({ tipo: 'UPDATE', nueva: p, vieja: v });
      }
      if (p.estado !== 'terminado' && !codigos.some((c) => c.torneo_id === p_torneo_id && c.partido_id === x.partido_id)) {
        let cod;
        do { cod = String(Math.floor(Math.random() * 10000)).padStart(4, '0'); } while (codigos.some((c) => c.codigo === cod));
        codigos.push({ codigo: cod, torneo_id: p_torneo_id, partido_id: x.partido_id, creado: this.ahoraMs() });
      }
    }
    this.difundir('arbitraje_partidos', cambios);
    return { ok: true, codigos: codigos.filter((c) => c.torneo_id === p_torneo_id).map((c) => ({ partido_id: c.partido_id, codigo: c.codigo })) };
  }

  // ─── Realtime (Phoenix, vsn 2.0.0: mensajes como arrays) ────────────────────

  socketNuevo(ws, etiqueta) {
    const cliente = { ws, etiqueta, canales: new Map() };
    this.sockets.add(cliente);
    const enviar = (joinRef, ref, topic, evento, payload) => {
      try { ws.send(JSON.stringify([joinRef, ref, topic, evento, payload])); } catch { /* cerrado */ }
    };
    ws.onMessage((crudo) => {
      let m;
      try { m = JSON.parse(typeof crudo === 'string' ? crudo : Buffer.from(crudo).toString()); } catch { return; }
      if (!Array.isArray(m)) return;
      const [joinRef, ref, topic, evento, payload] = m;
      if (topic === 'phoenix' && evento === 'heartbeat') return enviar(null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} });
      if (evento === 'phx_join') {
        const filtros = (payload && payload.config && payload.config.postgres_changes) || [];
        const conIds = filtros.map((f) => ({ ...f, id: this.siguienteIdBinding++ }));
        cliente.canales.set(topic, { joinRef, bindings: conIds });
        this.registrar({ metodo: 'WS', ruta: `join ${topic} (${conIds.map((b) => b.table).join(',')})`, rol: '-', status: 'ok', ctx: etiqueta });
        return enviar(joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: conIds } });
      }
      if (evento === 'phx_leave') {
        cliente.canales.delete(topic);
        return enviar(joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} });
      }
      if (evento === 'access_token') return undefined;
      if (ref) enviar(joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} });
      return undefined;
    });
    ws.onClose(() => this.sockets.delete(cliente));
  }

  difundir(tabla, cambios) {
    if (!PUBLICADAS.has(tabla) || cambios.length === 0) return;
    for (const cliente of this.sockets) {
      for (const [topic, canal] of cliente.canales) {
        for (const ch of cambios) {
          const ids = canal.bindings.filter((b) => (b.table === tabla) && (b.schema === 'public' || !b.schema) && (b.event === '*' || String(b.event).toUpperCase() === ch.tipo)).map((b) => b.id);
          if (ids.length === 0) continue;
          const data = {
            schema: 'public', table: tabla, commit_timestamp: new Date().toISOString(), type: ch.tipo, errors: null,
            columns: [], record: ch.nueva ? this.serializar(tabla, ch.nueva) : null, old_record: ch.vieja ? this.serializar(tabla, ch.vieja) : null,
          };
          try { cliente.ws.send(JSON.stringify([null, null, topic, 'postgres_changes', { ids, data }])); } catch { /* cerrado */ }
        }
      }
    }
  }

  // ─── Atajos para las pruebas ────────────────────────────────────────────────

  torneo(id) { const f = this.filas('rk_torneos').find((t) => t.id === id); return f ? clonar(f.data) : null; }
  torneos() { return this.filas('rk_torneos').map((f) => clonar(f.data)); }
  codigos(torneoId) { return this.filas('arbitraje_codigos').filter((c) => !torneoId || c.torneo_id === torneoId).map((c) => ({ ...c })); }
  partidoArbitrado(torneoId, partidoId) { return clonar(this.partidoArb(torneoId, partidoId)); }
}

module.exports = { FakeSupabase, HOST, PROYECTO };
