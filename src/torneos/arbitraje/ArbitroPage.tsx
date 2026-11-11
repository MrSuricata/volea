// /arbitro: el árbitro pone el código del partido y lo marca punto a punto. Sin login.
// Todo lo marcado se guarda en el teléfono y se sube con una cola (sincro.ts) en cuanto hay señal;
// si se recarga la página sin señal, sigue desde lo guardado.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormatoArbitraje } from '../engine/tipos';
import { estadoDe, formatoDelPartido, resultadoFinal, resumen, type Jugada, type Lado } from './motor';
import { ladosDelPartido, nombreJugador, resultadoEnCuadro, type PartidoArbitrado } from './partido';
import { entrar, leerTorneo, marcar, terminar, type PartidoDelArbitro } from './servicio';
import {
  alEntrar, alEnviar, alResponder, colaGuardada, iguales, jugar as jugarCola, pendiente, proximoEnvio, reconciliar, textoAviso,
  type Aviso, type Cola, type Resultado,
} from './sincro';

// ---------------------------------------------------------------- lo guardado en el teléfono
const CLAVE = (codigo: string) => `volea_arbitro_${codigo}`;
const ULTIMO = 'volea_arbitro_ultimo';
type DatosPartido = Omit<PartidoDelArbitro, 'jugadas' | 'version'>;
type Guardado = { v: 2; codigo: string; partido: DatosPartido; datos: PartidoArbitrado | null; cola: Pick<Cola, 'jugadas' | 'subido' | 'version' | 'enviados'> };

function leerGuardado(codigo: string): { partido: DatosPartido | null; datos: PartidoArbitrado | null; cola: Guardado['cola'] } | null {
  try {
    const s = localStorage.getItem(CLAVE(codigo));
    if (!s) return null;
    const o = JSON.parse(s) as Partial<Guardado> & Record<string, unknown>;
    if (o.v === 2 && o.partido && o.cola) {
      const cola = colaGuardada(o.cola);
      return cola ? { partido: o.partido, datos: o.datos ?? null, cola } : null;
    }
    const cola = colaGuardada(o); // lo que guardaba la versión anterior de esta pantalla
    return cola ? { partido: null, datos: null, cola } : null;
  } catch { return null; }
}
function guardar(g: Guardado) {
  try { localStorage.setItem(CLAVE(g.codigo), JSON.stringify(g)); localStorage.setItem(ULTIMO, g.codigo); } catch { /* sin almacenamiento: sigue en memoria */ }
}
function olvidar(codigo: string) {
  try { localStorage.removeItem(CLAVE(codigo)); if (localStorage.getItem(ULTIMO) === codigo) localStorage.removeItem(ULTIMO); } catch { /* nada */ }
}
function olvidarUltimo() {
  try { localStorage.removeItem(ULTIMO); } catch { /* nada */ }
}

// confirmada = el servidor ya respondió al entrar (si no, se abrió desde lo guardado y se consulta apenas haya señal).
type Sesion = { codigo: string; partido: DatosPartido; cola: Cola; datos: PartidoArbitrado | null; leido: 'ok' | 'red' | 'no'; aviso: Aviso | null; sinSenal: boolean; confirmada: boolean };

function sesionGuardada(codigo: string, sinSenal: boolean): Sesion | null {
  const g = leerGuardado(codigo);
  if (!g?.partido) return null;
  return { codigo, partido: g.partido, cola: { ...g.cola, enVuelo: null }, datos: g.datos, leido: g.datos ? 'ok' : 'red', aviso: null, sinSenal, confirmada: false };
}
function sesionAlAbrir(): Sesion | null {
  try { const c = localStorage.getItem(ULTIMO); return c ? sesionGuardada(c, false) : null; } catch { return null; }
}

const vibrar = () => { try { navigator.vibrate?.(30); } catch { /* no hay */ } };

// Mantiene la pantalla prendida mientras se marca (si el navegador lo permite).
function usePantallaPrendida(activa: boolean) {
  useEffect(() => {
    if (!activa || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let vivo = true;
    let lock: WakeLockSentinel | null = null;
    const pedir = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const l = await navigator.wakeLock.request('screen');
        if (vivo) lock = l; else void l.release();
      } catch { /* sin permiso o sin batería: no pasa nada */ }
    };
    void pedir();
    const alVolver = () => { if (document.visibilityState === 'visible') void pedir(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { vivo = false; document.removeEventListener('visibilitychange', alVolver); void lock?.release().catch(() => {}); };
  }, [activa]);
}

const textoResultado = (r: Resultado) => (r.wo ? 'W.O.' : r.games?.length ? r.games.map((g) => `${g.a}-${g.b}`).join(' / ') : `${r.puntosA}-${r.puntosB}`);

// ---------------------------------------------------------------- pantalla del código
export default function ArbitroPage() {
  const [sesion, setSesion] = useState<Sesion | null>(sesionAlAbrir);
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function ingresar(c: string) {
    if (!/^(\d{4}|\d{6})$/.test(c)) { setError('El código tiene 6 números (4 si es de los primeros que se repartieron).'); return; }
    setCargando(true); setError(null);
    const r = await entrar(c);
    if (!r.ok) {
      setCargando(false);
      // Sin señal pero con el partido guardado en el teléfono: se sigue marcando y se sube después.
      const local = r.red ? sesionGuardada(c, true) : null;
      if (local) { setSesion(local); return; }
      setError(r.error);
      return;
    }
    const { jugadas, version, ...partido } = r.valor;
    // Lo guardado de otro partido con el mismo código (código reemitido) no se mezcla.
    const g = leerGuardado(c);
    const local = g && (!g.partido || (g.partido.torneoId === partido.torneoId && g.partido.partidoId === partido.partidoId)) ? g : null;
    const { cola, aviso } = alEntrar(local?.cola ?? null, jugadas, version);
    const t = await leerTorneo(partido.torneoId);
    const datos = t && t !== 'red' ? ladosDelPartido(t, partido.partidoId) : local?.datos ?? null;
    setCargando(false);
    setSesion({ codigo: c, partido, cola, datos, leido: t === 'red' ? 'red' : t ? 'ok' : 'no', aviso, sinSenal: false, confirmada: true });
  }

  if (sesion) {
    return <Partido key={sesion.codigo} sesion={sesion} onSalir={() => { olvidarUltimo(); setSesion(null); setCodigo(''); setError(null); }} />;
  }
  const completo = codigo.length === 4 || codigo.length === 6;
  return (
    <Marco>
      <h1 className="text-2xl font-black uppercase tracking-wide">Árbitro</h1>
      <p className="mt-1 text-sm opacity-75">Poné el código del partido.</p>
      <form className="mt-6 flex gap-2" onSubmit={(ev) => { ev.preventDefault(); void ingresar(codigo); }}>
        <input
          inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} placeholder="Código"
          onChange={(ev) => { setCodigo(ev.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }}
          aria-label="Código del partido" aria-describedby="ayuda-codigo"
          className="w-48 min-w-0 flex-1 rounded-xl bg-white/10 px-4 py-3 text-center text-3xl font-black tracking-[0.3em] text-white outline-none ring-2 ring-white/20 placeholder:text-lg placeholder:font-bold placeholder:tracking-normal placeholder:text-white/40 focus:ring-[#CCFF00]"
        />
        <button type="submit" disabled={cargando}
          className={`min-h-[44px] rounded-xl px-5 text-lg font-black ${completo ? 'bg-[#CCFF00] text-[#001F3F]' : 'bg-white/15 text-white'}`}>
          {cargando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p id="ayuda-codigo" className="mt-3 text-sm opacity-75">Pedí el código en la mesa de control.</p>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-500/20 p-3 text-sm">{error}</p>}
    </Marco>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh bg-[#001F3F] px-4 py-6 text-white"><div className="mx-auto max-w-md">{children}</div></main>;
}

// ---------------------------------------------------------------- el partido
type Final = { motivo: 'terminado' | 'cargado_en_mesa'; resultado: Resultado | null };
type Cierre = 'nada' | 'confirmar' | 'enviando' | 'esperando';

function Partido({ sesion, onSalir }: { sesion: Sesion; onSalir: () => void }) {
  const { codigo, partido: base } = sesion;
  const colaRef = useRef<Cola>(sesion.cola);
  const [cola, setColaEstado] = useState<Cola>(sesion.cola);
  const datosRef = useRef(sesion.datos);
  const [datos, setDatos] = useState(sesion.datos);
  const [leido, setLeido] = useState(sesion.leido);
  const [aviso, setAviso] = useState<Aviso | null>(sesion.aviso);
  const [sinSenal, setSinSenal] = useState(sesion.sinSenal);
  const [final, setFinal] = useState<Final | null>(base.estado === 'terminado' ? { motivo: base.motivo ?? 'terminado', resultado: base.resultado ?? null } : null);
  const finalRef = useRef(final);
  const [cierre, setCierreEstado] = useState<Cierre>('nada');
  const cierreRef = useRef<Cierre>('nada');
  const [tiempoPedido, setTiempoPedido] = useState<Lado | null>(null);
  const confirmada = useRef(sesion.confirmada);

  const jugadas = cola.jugadas;
  const f = useMemo(() => formatoDelPartido(base.formato, jugadas), [base.formato, jugadas]);
  const e = useMemo(() => estadoDe(f, base.dobles, jugadas), [f, base.dobles, jugadas]);
  // Lo último que eligió al empezar, para volver a la pantalla de inicio con eso marcado.
  const [ultimoInicio, setUltimoInicio] = useState<Extract<Jugada, { t: 'inicio' }> | null>(jugadas[0]?.t === 'inicio' ? jugadas[0] : null);

  const nombre = (l: Lado) => (l === 'A' ? datos?.a?.nombre : datos?.b?.nombre) ?? (l === 'A' ? 'Equipo A' : 'Equipo B');
  const jugadores = (l: Lado) => (l === 'A' ? datos?.a?.jugadores : datos?.b?.jugadores) ?? [];

  const setCierre = (c: Cierre) => { cierreRef.current = c; setCierreEstado(c); };
  const setCola = useCallback((c: Cola) => {
    colaRef.current = c;
    setColaEstado(c);
    if (finalRef.current) return;
    guardar({ v: 2, codigo, partido: base, datos: datosRef.current, cola: { jugadas: c.jugadas, subido: c.subido, version: c.version, enviados: c.enviados } });
  }, [codigo, base]);

  const terminarSesion = useCallback((fin: Final) => {
    finalRef.current = fin;
    setFinal(fin);
    setCierre('nada');
    olvidar(codigo);
  }, [codigo]);

  // ------------------------------------------------ cola de envío
  const corriendo = useRef(false);
  const reloj = useRef<number | null>(null);
  const programar = (fn: () => void, ms: number) => {
    if (reloj.current) window.clearTimeout(reloj.current);
    reloj.current = window.setTimeout(() => { reloj.current = null; fn(); }, ms);
  };

  const bombear = useCallback(async () => {
    if (corriendo.current || finalRef.current) return;
    corriendo.current = true;
    let desfasajes = 0;
    try {
      for (;;) {
        const envio = proximoEnvio(colaRef.current);
        if (!envio) break;
        setCola(alEnviar(colaRef.current, envio));
        const fe = formatoDelPartido(base.formato, envio.jugadas);
        const r = await marcar(codigo, envio.version, envio.jugadas, resumen(estadoDe(fe, base.dobles, envio.jugadas)));
        const s = alResponder(colaRef.current, envio, r);
        setCola(s.cola);
        if (s.aviso) setAviso(s.aviso);
        setSinSenal(r.tipo === 'red');
        if (r.tipo === 'ok') setAviso((a) => (a?.tipo === 'bloqueado' || a?.tipo === 'error' ? null : a));
        if (r.tipo === 'terminado') { terminarSesion({ motivo: r.motivo, resultado: r.resultado }); break; }
        if (s.siguiente === 'esperar') { programar(() => void bombear(), r.tipo === 'bloqueado' ? 30000 : 4000); break; }
        if (s.siguiente === 'parar') break;
        // Si el servidor rechaza una y otra vez, no se insiste en seguida (nunca un bucle contra la base).
        if (r.tipo === 'desfasado' && ++desfasajes >= 5) { programar(() => void bombear(), 4000); break; }
      }
    } finally {
      corriendo.current = false;
    }
    // Volvió la señal y todavía no se le preguntó al servidor por el partido (abierto desde lo guardado).
    if (!confirmada.current && !reloj.current) void refrescarRef.current();
  }, [codigo, base.formato, base.dobles, setCola, terminarSesion]);
  const refrescarRef = useRef<() => Promise<void>>(async () => {});

  /** Espera a que no haya nada viajando y, si se puede, a que todo esté subido. */
  const vaciarCola = useCallback(async () => {
    for (let i = 0; i < 3; i++) {
      while (corriendo.current) await new Promise((r) => setTimeout(r, 100));
      if (!pendiente(colaRef.current) || finalRef.current) return;
      await bombear();
      if (!pendiente(colaRef.current)) return;
      if (reloj.current) return; // quedó esperando señal
    }
  }, [bombear]);

  // ------------------------------------------------ terminar (espera la cola y reintenta solo)
  const dudoso = useRef(false); // un Terminar quedó sin respuesta: puede haber llegado
  const cerrar = useCallback(async () => {
    if (finalRef.current) return;
    setCierre('enviando');
    for (let intento = 0; intento < 4; intento++) {
      await vaciarCola();
      if (finalRef.current) return;
      const c = colaRef.current;
      const fc = formatoDelPartido(base.formato, c.jugadas);
      const ec = estadoDe(fc, base.dobles, c.jugadas);
      const res = resultadoFinal(fc, ec);
      if (!res) { setCierre('nada'); return; } // al ponerse al día el partido dejó de estar terminado
      if (pendiente(c)) { setSinSenal(true); setCierre('esperando'); programar(() => void cerrar(), 5000); return; }
      const r = await terminar(codigo, c.version, c.jugadas, resumen(ec), res);
      if (r.tipo === 'ok') { terminarSesion({ motivo: 'terminado', resultado: r.resultado ?? res }); return; }
      if (r.tipo === 'terminado') { terminarSesion({ motivo: r.motivo, resultado: r.resultado }); return; }
      if (r.tipo === 'desfasado') {
        const s = reconciliar(c, r.jugadas, r.version);
        setCola(s.cola);
        if (s.aviso && s.aviso.tipo !== 'traido') { setAviso(s.aviso); setCierre('nada'); return; }
        if (!iguales(s.cola.jugadas, c.jugadas)) { if (s.aviso) setAviso(s.aviso); setCierre('nada'); return; }
        continue; // era un punto nuestro todavía en camino: se reintenta con la versión nueva
      }
      if (r.tipo === 'red' || r.tipo === 'bloqueado') {
        if (r.tipo === 'red') dudoso.current = true;
        if (r.tipo === 'bloqueado') setAviso({ tipo: 'bloqueado', mensaje: r.mensaje });
        setSinSenal(r.tipo === 'red');
        setCierre('esperando');
        programar(() => void cerrar(), r.tipo === 'bloqueado' ? 30000 : 5000);
        return;
      }
      if (r.tipo === 'codigo' && dudoso.current) {
        // Base vieja (v36): el Terminar anterior pudo haber entrado y borrado el código. Se mira el cuadro.
        const t = await leerTorneo(base.torneoId);
        const enCuadro = t && t !== 'red' ? resultadoEnCuadro(t, base.partidoId) : null;
        if (enCuadro && enCuadro.puntosA === res.puntosA && enCuadro.puntosB === res.puntosB) { terminarSesion({ motivo: 'terminado', resultado: enCuadro }); return; }
      }
      setAviso(r.tipo === 'codigo' || r.tipo === 'error' ? { tipo: r.tipo, mensaje: r.mensaje } : null);
      setCierre('nada');
      return;
    }
    setCierre('esperando');
    programar(() => void cerrar(), 5000);
  }, [vaciarCola, base, codigo, setCola, terminarSesion]);

  // Abierta desde lo guardado (recarga sin señal): apenas hay señal se pregunta al servidor cómo está.
  const refrescar = useCallback(async () => {
    if (confirmada.current || finalRef.current) return;
    const r = await entrar(codigo);
    if (!r.ok) {
      if (r.red) { setSinSenal(true); programar(() => void refrescar(), 5000); } else setAviso({ tipo: 'error', mensaje: r.error });
      return;
    }
    confirmada.current = true;
    setSinSenal(false);
    if (r.valor.estado === 'terminado') { terminarSesion({ motivo: r.valor.motivo ?? 'terminado', resultado: r.valor.resultado ?? null }); return; }
    while (corriendo.current) await new Promise((ok) => setTimeout(ok, 100));
    const s = alEntrar(colaRef.current, r.valor.jugadas, r.valor.version);
    setCola(s.cola);
    if (s.aviso) setAviso(s.aviso);
    if (!datosRef.current) void releerCuadro();
    void bombear();
  }, [codigo, bombear, setCola, terminarSesion]);
  refrescarRef.current = refrescar;

  // Al abrir con cosas sin subir, al volver la señal y al volver a la pantalla: se reintenta.
  useEffect(() => {
    if (final) { olvidar(codigo); return; }
    guardar({ v: 2, codigo, partido: base, datos: datosRef.current, cola: { jugadas: colaRef.current.jugadas, subido: colaRef.current.subido, version: colaRef.current.version, enviados: colaRef.current.enviados } });
    if (confirmada.current) void bombear(); else void refrescar();
    const reintentar = () => {
      if (document.visibilityState !== 'visible') return;
      if (!confirmada.current) void refrescar();
      else if (cierreRef.current === 'esperando') void cerrar();
      else void bombear();
    };
    window.addEventListener('online', reintentar);
    document.addEventListener('visibilitychange', reintentar);
    return () => {
      window.removeEventListener('online', reintentar);
      document.removeEventListener('visibilitychange', reintentar);
      if (reloj.current) window.clearTimeout(reloj.current);
    };
    // Solo al montar: bombear/cerrar leen todo de refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function releerCuadro() {
    setLeido('red');
    const t = await leerTorneo(base.torneoId);
    if (t === 'red') return;
    const d = t ? ladosDelPartido(t, base.partidoId) : null;
    datosRef.current = d;
    setDatos(d);
    setLeido(t ? 'ok' : 'no');
  }

  function jugar(j: Jugada | 'deshacer') {
    if (j !== 'deshacer' && j.t === 'inicio') setUltimoInicio(j);
    if (j !== 'deshacer' && j.t === 'rally') vibrar();
    setTiempoPedido(null);
    setCola(jugarCola(colaRef.current, j));
    setAviso((a) => (a?.tipo === 'descartado' || a?.tipo === 'bloqueado' ? a : null));
    void bombear();
  }

  usePantallaPrendida(!final && e.iniciado);

  // ------------------------------------------------ pantallas
  if (final) {
    const r = final.resultado ?? resultadoFinal(f, e);
    return (
      <Marco>
        <p className="text-sm uppercase opacity-70">{datos?.titulo}</p>
        <h1 className="mt-2 text-3xl font-black">{final.motivo === 'cargado_en_mesa' ? 'Resultado cargado en la mesa' : 'Resultado cargado ✓'}</h1>
        {final.motivo === 'cargado_en_mesa' && (
          <p className="mt-2 text-sm opacity-80">La mesa de control cargó el resultado de este partido. No hace falta hacer nada más.</p>
        )}
        {r && <p className="mt-3 text-lg font-bold">{nombre('A')} <span className="text-[#CCFF00]">{textoResultado(r)}</span> {nombre('B')}</p>}
        <button onClick={onSalir} className="mt-6 min-h-[44px] rounded-xl bg-[#CCFF00] px-5 py-3 font-black text-[#001F3F]">Otro partido</button>
      </Marco>
    );
  }

  const cantPendiente = pendiente(cola) ? Math.max(1, Math.abs(cola.jugadas.length - cola.subido.length)) : 0;
  const bannerSenal = (sinSenal || (cantPendiente > 0 && typeof navigator !== 'undefined' && navigator.onLine === false)) && (
    <div role="status" className="sticky top-0 z-10 -mx-4 mb-3 bg-amber-400 px-4 py-2 text-center text-sm font-black text-[#001F3F]">
      SIN SEÑAL · {cantPendiente > 0 ? 'lo marcado queda guardado en el teléfono y se sube solo' : 'se reintenta solo'}
    </div>
  );
  const cajaAviso = aviso && (
    <div role="alert" className="mt-2 rounded-lg bg-red-500/30 p-3 text-sm">
      <p>{textoAviso(aviso)}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {aviso.tipo === 'descartado' && (
          <button className="min-h-[44px] rounded-lg bg-white/15 px-3 font-bold"
            onClick={() => { setCola({ ...colaRef.current, jugadas: aviso.respaldo }); setAviso(null); void bombear(); }}>
            Usar lo de este teléfono
          </button>
        )}
        <button className="min-h-[44px] rounded-lg bg-white/10 px-3 font-bold" onClick={() => setAviso(null)}>Entendido</button>
      </div>
    </div>
  );

  if (!e.iniciado) {
    const sinRivales = base.rivales === false || (!!datos && (!datos.a || !datos.b));
    return <Inicio datos={datos} dobles={base.dobles} jugadores={jugadores} nombre={nombre} base={base.formato} previo={ultimoInicio}
      sinRivales={sinRivales} sinCuadro={!datos} leyendo={leido === 'red' && !datos} onReleer={() => void releerCuadro()}
      encabezado={<>{bannerSenal}{cajaAviso}</>} onEmpezar={(j) => jugar(j)} onSalir={onSalir} />;
  }

  const recibe: Lado = e.saca === 'A' ? 'B' : 'A';
  const quienSaca = (l: Lado) => (base.dobles ? nombreJugador(jugadores(l), e.sirve) : nombre(l));
  const botonTiempo = (l: Lado) => (
    <button onClick={() => setTiempoPedido(l)} disabled={e.tiempos[l] >= e.maxTiempos || cierre !== 'nada'}
      className="min-h-[44px] min-w-[44px] rounded-lg bg-white/10 px-3 text-sm font-bold disabled:opacity-40">
      Tiempo {nombre(l).split(/\s+/)[0]} ({e.maxTiempos - e.tiempos[l]})
    </button>
  );
  const enCierre = cierre === 'enviando' || cierre === 'esperando';

  return (
    <Marco>
      {bannerSenal}
      <div className="flex items-center justify-between text-xs uppercase opacity-70">
        <span>{datos?.titulo ?? 'Partido'}</span>
        <span>{f.tipo === 'rally' ? 'Rally' : 'Saque'} a {f.a}{f.mejorDe === 3 ? ` · Game ${e.game}` : ''}</span>
      </div>
      {/* El marcador se anuncia a los lectores de pantalla cada vez que cambia. */}
      <div aria-live="polite" aria-atomic="true">
        <p className="sr-only">
          {nombre('A')} {e.puntos.a}, {nombre('B')} {e.puntos.b}{f.mejorDe === 3 ? `, games ${e.gamesA} a ${e.gamesB}` : ''}. Saca {nombre(e.saca)}. Canto {e.canto}.
        </p>
        <div aria-hidden>
          {f.mejorDe === 3 && <p className="mt-1 text-center text-sm font-bold">Games {e.gamesA}-{e.gamesB}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(['A', 'B'] as Lado[]).map((l) => (
              <div key={l} className={`rounded-2xl p-3 ${e.saca === l ? 'bg-[#CCFF00] text-[#001F3F]' : 'bg-white/10'}`}>
                <p className="text-xs font-bold uppercase leading-tight">{nombre(l)}</p>
                <p className="text-6xl font-black tabular-nums">{l === 'A' ? e.puntos.a : e.puntos.b}</p>
                {e.saca === l && <p className="text-xs font-bold">Saca {quienSaca(l)}</p>}
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-5xl font-black tracking-wider tabular-nums">{e.canto}</p>
        </div>
      </div>
      {e.cambiarLado && <p className="mt-2 rounded-lg bg-orange-500 p-2 text-center font-black">CAMBIO DE LADO</p>}
      {e.finDeGame && <p className="mt-2 rounded-lg bg-sky-500 p-2 text-center font-black">FIN DEL GAME {e.game - 1} · cambio de lado</p>}
      {cajaAviso}
      {!sinSenal && cantPendiente > 0 && <p className="mt-2 text-center text-xs opacity-70">Subiendo…</p>}

      {e.terminado ? (
        <div className="mt-6 grid gap-3">
          <p className="text-center text-lg font-black">Ganó {nombre(e.ganador as Lado)} · {e.games.map((g) => `${g.a}-${g.b}`).join(' / ')}</p>
          {cierre === 'nada' && (
            <>
              <button onClick={() => setCierre('confirmar')} className="rounded-2xl bg-[#CCFF00] py-5 text-xl font-black text-[#001F3F]">Terminar partido</button>
              <button onClick={() => jugar('deshacer')} className="min-h-[44px] rounded-xl bg-white/10 py-3 font-bold">↶ Deshacer último punto</button>
            </>
          )}
          {cierre === 'confirmar' && <Confirmacion texto={`¿Cargar ${nombre('A')} ${e.games.map((g) => `${g.a}-${g.b}`).join(' / ')} ${nombre('B')}?`}
            onNo={() => setCierre('nada')} onSi={() => void cerrar()} />}
          {enCierre && (
            <div className="rounded-2xl bg-white/10 p-4 text-center" role="status">
              <p className="font-black">{cierre === 'enviando' ? 'Cargando el resultado…' : 'Sin señal: el resultado se carga solo apenas vuelva.'}</p>
              {cierre === 'esperando' && (
                <button onClick={() => { if (reloj.current) window.clearTimeout(reloj.current); setCierre('nada'); }} className="mt-3 min-h-[44px] rounded-lg bg-white/10 px-4 font-bold">
                  Cancelar
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          <button onClick={() => jugar({ t: 'rally', gana: e.saca })} className="rounded-2xl bg-[#CCFF00] px-3 py-6 text-[#001F3F] active:scale-95">
            <span className="block text-xs font-bold uppercase opacity-70">Ganó el que saca</span>
            <span className="block break-words text-2xl font-black leading-tight">{nombre(e.saca)}</span>
          </button>
          <button onClick={() => jugar({ t: 'rally', gana: recibe })} className="rounded-2xl bg-white px-3 py-6 text-[#001F3F] active:scale-95">
            <span className="block text-xs font-bold uppercase opacity-70">Ganó el que recibe</span>
            <span className="block break-words text-2xl font-black leading-tight">{nombre(recibe)}</span>
          </button>
          {tiempoPedido ? (
            <div className="flex items-center gap-2 rounded-xl bg-white/10 p-2">
              <span className="flex-1 text-sm font-bold">¿Tiempo para {nombre(tiempoPedido)}?</span>
              <button onClick={() => setTiempoPedido(null)} className="min-h-[44px] rounded-lg bg-white/10 px-4 font-bold">No</button>
              <button onClick={() => jugar({ t: 'tiempo', equipo: tiempoPedido })} className="min-h-[44px] rounded-lg bg-white px-4 font-black text-[#001F3F]">Sí, tiempo</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button onClick={() => jugar('deshacer')} className="min-h-[44px] rounded-lg bg-white/10 px-4 font-bold">
                {jugadas.length <= 1 ? '↶ Cambiar saque o formato' : '↶ Deshacer'}
              </button>
              <div className="flex gap-2">{botonTiempo('A')}{botonTiempo('B')}</div>
            </div>
          )}
        </div>
      )}
    </Marco>
  );
}

// Confirmación del resultado: el "Sí" no queda donde estaba "Terminar" (un doble toque no cierra el
// partido) y se habilita recién un instante después de aparecer.
function Confirmacion({ texto, onNo, onSi }: { texto: string; onNo: () => void; onSi: () => void }) {
  const [listo, setListo] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setListo(true), 700); return () => window.clearTimeout(t); }, []);
  return (
    <div className="grid gap-3 rounded-2xl border-2 border-white/30 p-3">
      <button onClick={onNo} className="min-h-[44px] rounded-xl bg-white/10 py-4 text-lg font-bold">No, seguir marcando</button>
      <p className="text-center font-bold">{texto}</p>
      <button onClick={onSi} disabled={!listo} className="mt-6 min-h-[44px] rounded-xl bg-emerald-400 py-4 text-lg font-black text-[#001F3F] disabled:opacity-50">
        Sí, cargar resultado
      </button>
    </div>
  );
}

const textoFormato = (f: FormatoArbitraje) => `${f.tipo === 'rally' ? 'Rally' : 'Saque tradicional'} a ${f.a} · ${f.mejorDe === 3 ? 'al mejor de 3' : 'un game'}`;
const mismoFormato = (a: FormatoArbitraje, b: FormatoArbitraje) => a.tipo === b.tipo && a.a === b.a && a.mejorDe === b.mejorDe;

function Inicio({ datos, dobles, jugadores, nombre, base, previo, sinRivales, sinCuadro, leyendo, onReleer, encabezado, onEmpezar, onSalir }: {
  datos: PartidoArbitrado | null; dobles: boolean; jugadores: (l: Lado) => string[]; nombre: (l: Lado) => string;
  base: FormatoArbitraje; previo: Extract<Jugada, { t: 'inicio' }> | null; sinRivales: boolean; sinCuadro: boolean; leyendo: boolean;
  onReleer: () => void; encabezado: React.ReactNode; onEmpezar: (j: Jugada) => void; onSalir: () => void;
}) {
  const [saca, setSaca] = useState<Lado | null>(previo?.saca ?? null);
  const [der, setDer] = useState<{ A: 0 | 1; B: 0 | 1 }>({ A: previo?.derechaA ?? 0, B: previo?.derechaB ?? 0 });
  const [formato, setFormato] = useState<FormatoArbitraje>(previo?.formato ?? base);
  const [cambiando, setCambiando] = useState(!!previo?.formato && !mismoFormato(previo.formato, base));
  const opcion = (activa: boolean) => `min-h-[44px] rounded-xl p-3 text-sm font-bold ${activa ? 'bg-white text-[#001F3F]' : 'bg-white/10'}`;
  const salir = <button onClick={onSalir} className="mt-6 min-h-[44px] rounded-xl bg-white/10 px-5 py-3 font-bold">Volver</button>;

  if (sinRivales) {
    return (
      <Marco>
        {encabezado}
        <p className="text-sm uppercase opacity-70">{datos?.titulo}</p>
        <h1 className="mt-2 text-2xl font-black">Todavía no se sabe quién juega</h1>
        <p className="mt-2 text-sm opacity-80">Este cruce depende de un partido anterior. Volvé a entrar cuando termine.</p>
        {salir}
      </Marco>
    );
  }
  if (sinCuadro) {
    // Sin los nombres no se sabe quién es quién: no se puede arrancar a ciegas.
    return (
      <Marco>
        {encabezado}
        <h1 className="text-2xl font-black">No se pudo leer el cuadro del torneo</h1>
        <p className="mt-2 text-sm opacity-80">
          {leyendo ? 'Parece que no hay señal. ' : 'El torneo no está publicado o el partido ya no está en el cuadro. '}
          Sin saber quién juega no se puede empezar. Si sigue así, avisá en la mesa de control.
        </p>
        <div className="flex gap-2">
          <button onClick={onReleer} className="mt-6 min-h-[44px] rounded-xl bg-[#CCFF00] px-5 py-3 font-black text-[#001F3F]">Probar de nuevo</button>
          {salir}
        </div>
      </Marco>
    );
  }

  const cambiado = !mismoFormato(formato, base);
  return (
    <Marco>
      {encabezado}
      <p className="text-sm uppercase opacity-70">{datos?.titulo ?? 'Partido'}</p>
      <h1 className="mt-1 text-xl font-black">{nombre('A')} <span className="text-[#CCFF00]">vs</span> {nombre('B')}</h1>

      <div className="mt-5 rounded-xl bg-white/10 p-3">
        <p className="text-xs font-bold uppercase opacity-75">{cambiado ? 'Formato elegido por el árbitro' : 'Formato que puso la organización'}</p>
        <p className="mt-1 text-lg font-black">{textoFormato(formato)}</p>
        {cambiado && <p className="mt-1 text-xs text-amber-300">La organización había puesto: {textoFormato(base)}.</p>}
        {!cambiando && (
          <button onClick={() => setCambiando(true)} className="mt-2 min-h-[44px] text-sm font-bold underline opacity-80">Cambiar formato…</button>
        )}
      </div>
      {cambiando && (
        <div className="mt-2 rounded-xl border border-amber-300/60 p-3">
          <p className="text-xs text-amber-200">Cambialo solo si la mesa de control lo indicó.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={() => setFormato({ ...formato, tipo: 'sideout' })} className={opcion(formato.tipo === 'sideout')}>Saque tradicional</button>
            <button onClick={() => setFormato({ ...formato, tipo: 'rally' })} className={opcion(formato.tipo === 'rally')}>Rally</button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {([11, 15, 21] as const).map((a) => (
              <button key={a} onClick={() => setFormato({ ...formato, a })} className={opcion(formato.a === a)}>A {a}</button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={() => setFormato({ ...formato, mejorDe: 1 })} className={opcion(formato.mejorDe === 1)}>Un game</button>
            <button onClick={() => setFormato({ ...formato, mejorDe: 3 })} className={opcion(formato.mejorDe === 3)}>Mejor de 3</button>
          </div>
          <button onClick={() => { setFormato(base); setCambiando(false); }} className="mt-2 min-h-[44px] text-sm font-bold underline opacity-80">
            Volver al de la organización
          </button>
        </div>
      )}

      <p className="mt-5 text-sm font-bold uppercase opacity-75">¿Quién saca primero?</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(['A', 'B'] as Lado[]).map((l) => (
          <button key={l} onClick={() => setSaca(l)} className={`min-h-[44px] rounded-xl p-3 text-left text-sm font-bold ${saca === l ? 'bg-[#CCFF00] text-[#001F3F]' : 'bg-white/10'}`}>{nombre(l)}</button>
        ))}
      </div>
      {dobles && (['A', 'B'] as Lado[]).map((l) => (
        <div key={l} className="mt-4">
          <p className="text-sm font-bold uppercase opacity-75">¿Quién arranca a la derecha? · {nombre(l)}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {([0, 1] as const).map((i) => (
              <button key={i} onClick={() => setDer({ ...der, [l]: i })} className={`min-h-[44px] rounded-xl p-3 text-sm font-bold ${der[l] === i ? 'bg-white text-[#001F3F]' : 'bg-white/10'}`}>
                {nombreJugador(jugadores(l), i)}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button disabled={!saca} onClick={() => saca && onEmpezar({ t: 'inicio', saca, derechaA: der.A, derechaB: der.B, formato })}
        className="mt-6 w-full rounded-2xl bg-[#CCFF00] py-5 text-xl font-black text-[#001F3F] disabled:bg-white/15 disabled:text-white/60">
        {saca ? 'Empezar partido' : 'Elegí quién saca primero'}
      </button>
      <button onClick={onSalir} className="mt-3 min-h-[44px] w-full text-sm font-bold underline opacity-70">Salir / otro código</button>
    </Marco>
  );
}
