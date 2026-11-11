// RPC del tanteador según supabase/migraciones_propuestas/v37_arbitraje_blindaje.sql, traducidas
// función por función (mismos nombres que en el SQL, sin el prefijo _arbitraje_). Se instalan en
// FakeSupabase cuando la base falsa corre en modo 'v37' (E2E_ARBITRAJE=v37, el modo por defecto).
//
// Diferencias con la base real: sin transacciones ni FOR UPDATE (todo corre en un hilo), el replay
// usa el motor de la app (motorApp.cjs) en vez de la traducción en plpgsql (la paridad entre los dos
// la prueba supabase/pruebas/paridad_motor.sql) y el azar de los códigos es Math.random.
const { estadoDe, resumen } = require('./motorApp.cjs');

const MIN = 60000;
const DIA = 86400000;
const clonar = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const MSG_FRENO = 'Demasiados códigos incorrectos desde esta conexión: esperá unos minutos. Lo marcado queda guardado en el teléfono.';
const esNum = (x) => typeof x === 'number' && Number.isFinite(x);
const esDigitos = (x) => x !== null && x !== undefined && /^[0-9]{1,3}$/.test(typeof x === 'object' ? '' : String(x));

const metodos = {
  // ─── freno ──────────────────────────────────────────────────────────────────
  v37Origen(etiqueta) { return String(this.ipPorContexto(etiqueta) || 'sin-origen').slice(0, 64); },

  v37Freno(origen) {
    const ahora = this.ahoraMs();
    const ints = this.filas('arbitraje_intentos');
    const v15 = ints.filter((i) => i.origen === origen && i.cuando > ahora - 15 * MIN).length;
    const vdia = ints.filter((i) => i.origen === origen && i.cuando > ahora - DIA).length;
    if (v15 >= 30 || vdia >= 150) return MSG_FRENO;
    const vglobal = Math.min(3000, ints.filter((i) => i.cuando > ahora - 15 * MIN).length);
    if (vglobal >= 300) {
      const conocido = this.filas('arbitraje_origenes_ok').some((o) => o.origen === origen && o.ultimo > ahora - DIA);
      if (!conocido && (vglobal >= 3000 || v15 >= 3)) return MSG_FRENO;
    }
    return null;
  },

  v37AnotarFallo(origen) {
    const ahora = this.ahoraMs();
    const ints = this.filas('arbitraje_intentos');
    ints.push({ origen, cuando: ahora });
    this.tablas.set('arbitraje_intentos', ints.filter((i) => i.cuando >= ahora - DIA));
  },

  v37AnotarOk(origen) {
    const ahora = this.ahoraMs();
    const oks = this.filas('arbitraje_origenes_ok');
    const o = oks.find((x) => x.origen === origen);
    if (!o) oks.push({ origen, ultimo: ahora });
    else if (o.ultimo < ahora - 10 * MIN) o.ultimo = ahora;
  },

  v37Codigo(pCodigo) {
    const v = String(pCodigo ?? '').trim();
    const c = this.filas('arbitraje_codigos').find((x) => x.codigo === v);
    if (c) return { estado: 'ok', c };
    if (this.filas('arbitraje_codigos_baja').some((b) => b.codigo === v && b.baja > this.ahoraMs() - DIA)) return { estado: 'baja' };
    return { estado: 'no' };
  },

  v37BajaCodigo(codigo) {
    const c = this.filas('arbitraje_codigos').find((x) => x.codigo === codigo);
    if (!c) return;
    const bajas = this.filas('arbitraje_codigos_baja').filter((b) => b.codigo !== codigo);
    bajas.push({ codigo, torneo_id: c.torneo_id, partido_id: c.partido_id, baja: this.ahoraMs() });
    this.tablas.set('arbitraje_codigos_baja', bajas);
    this.tablas.set('arbitraje_codigos', this.filas('arbitraje_codigos').filter((x) => x.codigo !== codigo));
  },

  v37CodigoNuevo() {
    for (let i = 0; i < 40; i++) {
      const v = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
      if (!this.filas('arbitraje_codigos').some((c) => c.codigo === v) && !this.filas('arbitraje_codigos_baja').some((c) => c.codigo === v)) return v;
    }
    return null;
  },

  // ─── validaciones ───────────────────────────────────────────────────────────
  v37FormatoValido(f) {
    return !!f && typeof f === 'object' && !Array.isArray(f) && ['rally', 'sideout'].includes(f.tipo)
      && esNum(f.a) && [11, 15, 21].includes(f.a) && esNum(f.mejorDe) && [1, 3].includes(f.mejorDe);
  },

  v37FormatoBase(f) {
    if (!f || typeof f !== 'object' || !['rally', 'sideout'].includes(f.tipo) || !['11', '15', '21'].includes(String(f.a))) return null;
    const m = f.mejorDe === undefined || f.mejorDe === null ? '1' : String(f.mejorDe);
    if (!['1', '3'].includes(m)) return null;
    return { tipo: f.tipo, a: Number(f.a), mejorDe: Number(m) };
  },

  v37FormatoDe(j, base) {
    const ini = Array.isArray(j) ? j[0] : null;
    if (ini && ini.t === 'inicio' && Object.prototype.hasOwnProperty.call(ini, 'formato') && ini.formato !== null) {
      return this.v37FormatoValido(ini.formato) ? { tipo: ini.formato.tipo, a: ini.formato.a, mejorDe: ini.formato.mejorDe } : null;
    }
    return this.v37FormatoBase(base);
  },

  v37JugadasValidas(j) {
    if (!Array.isArray(j) || j.length > 1500) return false;
    for (let n = 0; n < j.length; n++) {
      const x = j[n];
      if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
      if (n === 0) {
        if (!(x.t === 'inicio' && ['A', 'B'].includes(x.saca) && ['0', '1'].includes(String(x.derechaA)) && ['0', '1'].includes(String(x.derechaB)))) return false;
        if (Object.prototype.hasOwnProperty.call(x, 'formato') && x.formato !== null && !this.v37FormatoValido(x.formato)) return false;
      } else if (x.t === 'rally') {
        if (!['A', 'B'].includes(x.gana)) return false;
      } else if (x.t === 'tiempo') {
        if (!['A', 'B'].includes(x.equipo)) return false;
      } else return false;
    }
    return true;
  },

  v37MarcadorValido(m) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
    const par = (p) => p && typeof p === 'object' && esNum(p.a) && esNum(p.b);
    return par(m.puntos) && Array.isArray(m.games) && m.games.length <= 3 && m.games.every(par)
      && esNum(m.gamesA) && esNum(m.gamesB) && esNum(m.game) && ['A', 'B'].includes(m.saca);
  },

  v37Replay(f, dobles, j) { return clonar(resumen(estadoDe(f, dobles !== false, j || []))); },

  v37ResultadoDe(f, m) {
    if (!m || !m.terminado) return null;
    if (Number((f && f.mejorDe) ?? 1) === 1) return { puntosA: m.games[0].a, puntosB: m.games[0].b };
    return { puntosA: m.gamesA, puntosB: m.gamesB, games: clonar(m.games) };
  },

  v37ResultadoLegal(f, r) {
    if (!this.v37FormatoValido(f) || !r || typeof r !== 'object') return false;
    if (!esDigitos(r.puntosA) || !esDigitos(r.puntosB)) return false;
    const obj = f.a;
    const pa = Number(r.puntosA); const pb = Number(r.puntosB);
    if (pa === pb) return false;
    const gameOk = (a, b) => Math.max(a, b) >= obj && Math.abs(a - b) >= 2 && (Math.max(a, b) === obj || Math.abs(a - b) === 2);
    if (f.mejorDe === 1) {
      if (Object.prototype.hasOwnProperty.call(r, 'games') && r.games !== null) return false;
      return gameOk(pa, pb);
    }
    if (!Array.isArray(r.games) || ![2, 3].includes(r.games.length)) return false;
    let ga = 0; let gb = 0;
    for (const g of r.games) {
      if (ga === 2 || gb === 2) return false; // game después de definido
      if (!g || typeof g !== 'object' || !esDigitos(g.a) || !esDigitos(g.b)) return false;
      const a = Number(g.a); const b = Number(g.b);
      if (!gameOk(a, b)) return false;
      if (a > b) ga++; else gb++;
    }
    return Math.max(ga, gb) === 2 && ga === pa && gb === pb;
  },

  // ─── el partido en el cuadro ────────────────────────────────────────────────
  v37DataTorneo(id) { const f = this.filas('rk_torneos').find((t) => t.id === id); return f ? f.data : null; },

  v37PartidoCuadro(data, pid) {
    if (!data) return null;
    for (const lista of ['partidosGrupo', 'partidosLlave']) {
      const arr = Array.isArray(data[lista]) ? data[lista] : [];
      const idx = arr.findIndex((x) => x && x.id === pid);
      if (idx >= 0) return { lista, idx, elem: arr[idx] };
    }
    return null;
  },

  v37ResultadoCuadro(e) {
    if (!e || ((e.puntosA === null || e.puntosA === undefined) && e.wo !== true)) return null;
    const r = { puntosA: e.puntosA ?? null, puntosB: e.puntosB ?? null };
    if (Array.isArray(e.games)) r.games = clonar(e.games);
    if (e.wo === true) r.wo = true;
    // jsonb_strip_nulls
    for (const k of Object.keys(r)) if (r[k] === null) delete r[k];
    return r;
  },

  v37ResultadoValido(e) {
    return !!e && Number.isInteger(e.puntosA) && Number.isInteger(e.puntosB) && e.puntosA >= 0 && e.puntosB >= 0 && e.puntosA !== e.puntosB;
  },

  v37SlotPareja(llave, slot, prof = 0) {
    if (prof > 30 || !slot || typeof slot !== 'object') return null;
    if (slot.tipo === 'seed') return slot.parejaId || null;
    if (!['ganadorDe', 'perdedorDe'].includes(slot.tipo)) return null;
    const p = (llave || []).find((x) => x && x.id === slot.partidoId);
    if (!p) return null;
    const a = this.v37SlotPareja(llave, p.a, prof + 1);
    const b = this.v37SlotPareja(llave, p.b, prof + 1);
    let gan;
    if (p.a == null && b !== null) gan = b;
    else if (p.b == null && a !== null) gan = a;
    else if (a === null || b === null || !this.v37ResultadoValido(p)) return null;
    else gan = p.puntosA > p.puntosB ? a : b;
    if (slot.tipo === 'ganadorDe') return gan;
    return gan === a ? b : a;
  },

  v37RivalesDefinidos(data, ubic) {
    if (!ubic) return false;
    const e = ubic.elem;
    if (ubic.lista === 'partidosGrupo') return !!e.aId && !!e.bId;
    return this.v37SlotPareja(data.partidosLlave, e.a) !== null && this.v37SlotPareja(data.partidosLlave, e.b) !== null;
  },

  v37Cuadro(data, ubic) {
    if (!data || !ubic) return null;
    const e = ubic.elem;
    let a; let b; let titulo;
    if (ubic.lista === 'partidosGrupo') {
      a = e.aId || null; b = e.bId || null;
      const gr = (data.grupos || []).find((g) => g.id === e.grupoId);
      titulo = `Grupo ${gr ? gr.nombre ?? '' : ''} · Ronda ${e.ronda ?? ''}${e.etiqueta ? ` · ${e.etiqueta}` : ''}`;
    } else {
      a = this.v37SlotPareja(data.partidosLlave, e.a);
      b = this.v37SlotPareja(data.partidosLlave, e.b);
      if (e.esTercerPuesto) titulo = 'Tercer puesto';
      else {
        const n = (data.partidosLlave || []).filter((x) => String(x.ronda) === String(e.ronda) && !x.esTercerPuesto).length;
        titulo = { 1: 'Final', 2: 'Semifinal', 4: 'Cuartos', 8: 'Octavos' }[n] ?? `Ronda ${e.ronda ?? ''}`;
      }
    }
    const lado = (pid) => { const p = (data.parejas || []).find((x) => x.id === pid); return p ? { parejaId: p.id, nombre: p.nombre } : null; };
    return { fase: ubic.lista === 'partidosGrupo' ? 'grupo' : 'llave', titulo, a: lado(a), b: lado(b) };
  },

  v37Cerrado(p, res) {
    return {
      ok: false, error: 'desfasado', estado: 'terminado', motivo: p.cierre === 'mesa' ? 'cargado_en_mesa' : 'terminado',
      resultado: res ?? this.v37ResultadoDe(p.formato, p.marcador), jugadas: clonar(p.jugadas), version: p.version,
    };
  },

  v37CerrarMesa(p) {
    const vieja = { ...p };
    p.estado = 'terminado'; p.cierre = 'mesa'; p.version += 1; p.actualizado = this.ahoraMs();
    this.difundir('arbitraje_partidos', [{ tipo: 'UPDATE', nueva: p, vieja }]);
  },

  // Entrada común de las tres RPC del árbitro: freno + código. Devuelve { respuesta } o { c, origen }.
  v37Puerta(pCodigo, etiqueta, textoNo) {
    const origen = this.v37Origen(etiqueta);
    const freno = this.v37Freno(origen);
    if (freno) return { respuesta: { ok: false, error: freno, bloqueado: true } };
    const k = this.v37Codigo(pCodigo);
    if (k.estado === 'baja') return { respuesta: { ok: false, error: textoNo.baja, baja: true } };
    if (k.estado !== 'ok') { this.v37AnotarFallo(origen); return { respuesta: { ok: false, error: textoNo.no } }; }
    this.v37AnotarOk(origen);
    return { c: k.c, origen };
  },

  // ─── RPC del árbitro ────────────────────────────────────────────────────────
  v37Entrar({ p_codigo }, etiqueta) {
    const pu = this.v37Puerta(p_codigo, etiqueta, {
      baja: 'Ese código ya no se usa (el cuadro cambió). Pedí el nuevo en la mesa de control.',
      no: 'Código incorrecto. Revisalo o pedilo en la mesa de control.',
    });
    if (pu.respuesta) return pu.respuesta;
    const { c } = pu;
    if (!c.usado) c.usado = this.ahoraMs();
    const p = this.partidoArb(c.torneo_id, c.partido_id);
    if (!p) return { ok: false, error: 'El partido no está preparado: avisá en la mesa de control.' };
    const data = this.v37DataTorneo(c.torneo_id);
    const ubic = this.v37PartidoCuadro(data, c.partido_id);
    const res = this.v37ResultadoCuadro(ubic && ubic.elem);
    if (p.estado !== 'terminado' && res) this.v37CerrarMesa(p);
    const terminado = p.estado === 'terminado';
    return {
      ok: true, torneo_id: c.torneo_id, partido_id: c.partido_id, formato: clonar(p.formato), dobles: p.dobles, jugadas: clonar(p.jugadas), version: p.version, estado: p.estado,
      motivo: !terminado ? null : p.cierre === 'mesa' ? 'cargado_en_mesa' : 'terminado',
      resultado: terminado ? (res ?? this.v37ResultadoDe(p.formato, p.marcador)) : null,
      rivales: data ? this.v37RivalesDefinidos(data, ubic) : null,
      cuadro: this.v37Cuadro(data, ubic),
    };
  },

  v37Marcar({ p_codigo, p_version, p_jugadas, p_marcador }, etiqueta) {
    const pu = this.v37Puerta(p_codigo, etiqueta, { baja: 'El código ya no es válido.', no: 'El código ya no es válido.' });
    if (pu.respuesta) return pu.respuesta;
    const { c } = pu;
    const p = this.partidoArb(c.torneo_id, c.partido_id);
    if (!p) return { ok: false, error: 'El partido no está preparado: avisá en la mesa de control.' };
    if (p.estado === 'terminado') return this.v37Cerrado(p, null);
    const data = this.v37DataTorneo(c.torneo_id);
    const ubic = this.v37PartidoCuadro(data, c.partido_id);
    if (data && !ubic) return { ok: false, error: 'Este partido ya no está en el cuadro (se rearmó): avisá en la mesa de control.', sin_partido: true };
    const res = this.v37ResultadoCuadro(ubic && ubic.elem);
    if (res) { this.v37CerrarMesa(p); return this.v37Cerrado(p, res); }
    if (!this.v37JugadasValidas(p_jugadas)) return { ok: false, error: 'Jugadas inválidas.' };
    if (!this.v37MarcadorValido(p_marcador)) return { ok: false, error: 'Marcador inválido.' };
    const f = this.v37FormatoDe(p_jugadas, p.formato);
    if (!f) return { ok: false, error: 'Formato inválido.' };
    if (p.version !== p_version) return { ok: false, error: 'desfasado', estado: p.estado, jugadas: clonar(p.jugadas), version: p.version };
    const vieja = { ...p };
    p.jugadas = clonar(p_jugadas);
    p.marcador = this.v37Replay(f, p.dobles, p_jugadas);
    p.version += 1;
    p.estado = p_jugadas.length > 0 ? 'en_juego' : 'pendiente';
    p.actualizado = this.ahoraMs();
    this.difundir('arbitraje_partidos', [{ tipo: 'UPDATE', nueva: p, vieja }]);
    return { ok: true, version: p.version };
  },

  v37Terminar({ p_codigo, p_version, p_jugadas, p_marcador, p_resultado }, etiqueta) {
    const pu = this.v37Puerta(p_codigo, etiqueta, { baja: 'El código ya no es válido.', no: 'El código ya no es válido.' });
    if (pu.respuesta) return pu.respuesta;
    const { c } = pu;
    const p = this.partidoArb(c.torneo_id, c.partido_id);
    if (!p) return { ok: false, error: 'El partido no está preparado: avisá en la mesa de control.' };
    const fila = this.filas('rk_torneos').find((t) => t.id === c.torneo_id);
    const data = fila ? fila.data : null;
    const ubic = this.v37PartidoCuadro(data, c.partido_id);
    const res = this.v37ResultadoCuadro(ubic && ubic.elem);
    const enMesa = 'El resultado ya se cargó desde la mesa de control.';
    if (p.estado === 'terminado') {
      if (p.cierre === 'mesa') return { ...this.v37Cerrado(p, res), error: enMesa };
      return { ok: true, ya_cargado: true, estado: 'terminado', motivo: 'terminado', resultado: res ?? this.v37ResultadoDe(p.formato, p.marcador) };
    }
    if (!data) return { ok: false, error: 'El torneo ya no existe.' };
    if (!ubic) return { ok: false, error: 'El partido ya no está en el cuadro (¿se rearmó?).', sin_partido: true };
    if (res) { this.v37CerrarMesa(p); return { ...this.v37Cerrado(p, res), error: enMesa }; }
    if (p.version !== p_version) return { ok: false, error: 'desfasado', estado: p.estado, jugadas: clonar(p.jugadas), version: p.version };
    if (!this.v37JugadasValidas(p_jugadas)) return { ok: false, error: 'Jugadas inválidas.' };
    if (p_marcador !== null && p_marcador !== undefined && !this.v37MarcadorValido(p_marcador)) return { ok: false, error: 'Marcador inválido.' };
    const f = this.v37FormatoDe(p_jugadas, p.formato);
    if (!f) return { ok: false, error: 'Formato inválido.' };
    const marcador = this.v37Replay(f, p.dobles, p_jugadas);
    const calc = this.v37ResultadoDe(f, marcador);
    if (!calc) return { ok: false, error: 'Según lo marcado el partido todavía no terminó.' };
    if (!this.v37ResultadoLegal(f, p_resultado) || !this.v37ResultadoLegal(f, calc)
      || Number(p_resultado.puntosA) !== calc.puntosA || Number(p_resultado.puntosB) !== calc.puntosB
      || (f.mejorDe === 3 && JSON.stringify((p_resultado.games || []).map((g) => [Number(g.a), Number(g.b)])) !== JSON.stringify(calc.games.map((g) => [g.a, g.b])))) {
      return { ok: false, error: 'El resultado no cierra con lo marcado y el formato del partido.' };
    }
    if (!this.v37RivalesDefinidos(data, ubic)) return { ok: false, error: 'Todavía no están definidos los dos rivales de este cruce.' };
    const ahora = this.ahoraMs();
    const elem = { ...ubic.elem, puntosA: calc.puntosA, puntosB: calc.puntosB, cargadoEl: new Date(ahora).toISOString() };
    if (f.mejorDe === 3) elem.games = clonar(calc.games);
    const viejaT = { ...fila };
    const nueva = clonar(data);
    nueva[ubic.lista][ubic.idx] = elem;
    fila.data = nueva; fila.updated_at = ahora;
    this.difundir('rk_torneos', [{ tipo: 'UPDATE', nueva: fila, vieja: viejaT }]);
    const cambiosCancha = [];
    for (const ec of this.filas('rk_en_cancha')) {
      if (ec.torneo_id === c.torneo_id && ec.partido_id === c.partido_id) {
        const v = { ...ec }; ec.torneo_id = null; ec.partido_id = null; ec.updated_at = ahora; cambiosCancha.push({ tipo: 'UPDATE', nueva: ec, vieja: v });
      }
    }
    this.difundir('rk_en_cancha', cambiosCancha);
    const viejaP = { ...p };
    Object.assign(p, { jugadas: clonar(p_jugadas), marcador, formato: f, estado: 'terminado', cierre: 'arbitro', version: p.version + 1, actualizado: ahora });
    this.difundir('arbitraje_partidos', [{ tipo: 'UPDATE', nueva: p, vieja: viejaP }]);
    // el código queda (2 días) para que reintentar o volver a entrar respondan "terminado"
    return { ok: true, estado: 'terminado', motivo: 'terminado', resultado: calc };
  },

  // ─── RPC del gestor ─────────────────────────────────────────────────────────
  v37AdminCodigos({ p_torneo_id, p_dobles, p_partidos }, yo) {
    if (!yo.equipo) return { ok: false, error: 'solo el equipo' };
    if (!Array.isArray(p_partidos)) return { ok: false, error: 'lista inválida' };
    const ahora = this.ahoraMs();
    const data = this.v37DataTorneo(p_torneo_id);
    const ids = p_partidos.map((e) => e && e.partido_id).filter((x) => x != null);
    // limpieza general
    this.tablas.set('arbitraje_codigos_baja', this.filas('arbitraje_codigos_baja').filter((b) => b.baja >= ahora - DIA));
    this.tablas.set('arbitraje_codigos', this.filas('arbitraje_codigos').filter((c) => {
      const p = this.partidoArb(c.torneo_id, c.partido_id);
      if (p && p.estado === 'terminado' && p.actualizado < ahora - 2 * DIA) return false;
      return !(c.creado < ahora - 90 * DIA);
    }));
    // huérfanos
    for (const c of this.filas('arbitraje_codigos').filter((x) => x.torneo_id === p_torneo_id && !ids.includes(x.partido_id) && (!data || !this.v37PartidoCuadro(data, x.partido_id)))) {
      this.v37BajaCodigo(c.codigo);
      this.tablas.set('arbitraje_partidos', this.filas('arbitraje_partidos').filter((p) => !(p.torneo_id === p_torneo_id && p.partido_id === c.partido_id && p.estado !== 'terminado')));
    }
    const cambios = [];
    let sinLugar = 0;
    for (const x of p_partidos) {
      const id = x && x.partido_id;
      if (id == null) continue;
      const ubic = this.v37PartidoCuadro(data, id);
      if (data && !ubic) continue;
      const formato = this.v37FormatoBase(x.formato) || { tipo: 'rally', a: 15, mejorDe: 1 };
      let p = this.partidoArb(p_torneo_id, id);
      if (this.v37ResultadoCuadro(ubic && ubic.elem)) {
        if (p && p.estado === 'en_juego') this.v37CerrarMesa(p);
        else if (p && p.estado === 'pendiente') for (const c of this.filas('arbitraje_codigos').filter((k) => k.torneo_id === p_torneo_id && k.partido_id === id)) this.v37BajaCodigo(c.codigo);
        continue;
      }
      if (!p) {
        p = { torneo_id: p_torneo_id, partido_id: id, estado: 'pendiente', formato, dobles: p_dobles, jugadas: [], marcador: null, version: 0, actualizado: ahora, cierre: null };
        this.filas('arbitraje_partidos').push(p);
        cambios.push({ tipo: 'INSERT', nueva: p, vieja: null });
      } else if (p.estado === 'pendiente') {
        const v = { ...p }; p.formato = formato; p.dobles = p_dobles; cambios.push({ tipo: 'UPDATE', nueva: p, vieja: v });
      }
      if (p.estado !== 'terminado' && !this.filas('arbitraje_codigos').some((c) => c.torneo_id === p_torneo_id && c.partido_id === id)) {
        const cod = this.v37CodigoNuevo();
        if (!cod) { sinLugar++; continue; }
        this.filas('arbitraje_codigos').push({ codigo: cod, torneo_id: p_torneo_id, partido_id: id, creado: ahora, usado: null });
      }
    }
    this.difundir('arbitraje_partidos', cambios);
    if (sinLugar > 0) return { ok: false, error: `No hay códigos libres para ${sinLugar} partidos: probá de nuevo.` };
    const vigentes = this.filas('arbitraje_codigos').filter((c) => {
      const p = this.partidoArb(c.torneo_id, c.partido_id);
      return c.torneo_id === p_torneo_id && ids.includes(c.partido_id) && p && p.estado !== 'terminado';
    }).sort((a, b) => (a.partido_id < b.partido_id ? -1 : 1));
    const cuatro = this.filas('arbitraje_codigos').filter((c) => {
      const p = this.partidoArb(c.torneo_id, c.partido_id);
      return c.torneo_id === p_torneo_id && c.codigo.length === 4 && p && p.estado === 'pendiente';
    }).length;
    return { ok: true, codigos: vigentes.map((c) => ({ partido_id: c.partido_id, codigo: c.codigo })), cuatro_cifras: cuatro };
  },

  v37AdminRenovar({ p_torneo_id }, yo) {
    if (!yo.equipo) return { ok: false, error: 'solo el equipo' };
    let n = 0;
    for (const c of this.filas('arbitraje_codigos').filter((k) => k.torneo_id === p_torneo_id && k.codigo.length === 4 && !k.usado)) {
      const p = this.partidoArb(c.torneo_id, c.partido_id);
      if (!p || p.estado !== 'pendiente') continue;
      const cod = this.v37CodigoNuevo();
      if (!cod) continue;
      this.v37BajaCodigo(c.codigo);
      this.filas('arbitraje_codigos').push({ codigo: cod, torneo_id: p_torneo_id, partido_id: c.partido_id, creado: this.ahoraMs(), usado: null });
      n++;
    }
    return { ok: true, renovados: n };
  },
};

function instalarV37(Clase) { Object.assign(Clase.prototype, metodos); }

module.exports = { instalarV37 };
