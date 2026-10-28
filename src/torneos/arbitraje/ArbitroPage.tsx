// /arbitro: el árbitro pone el código del partido y lo marca punto a punto. Sin login.
// Lo marcado se guarda en el teléfono y se sube en cuanto hay señal.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormatoArbitraje, Torneo } from '../engine/tipos';
import { estadoDe, formatoDelPartido, resultadoFinal, resumen, type Jugada, type Lado } from './motor';
import { ladosDelPartido, type PartidoArbitrado } from './partido';
import { entrar, leerTorneo, marcar, terminar, type PartidoDelArbitro } from './servicio';

const GUARDADO = (codigo: string) => `volea_arbitro_${codigo}`;
type Local = { jugadas: Jugada[]; version: number; pendiente: boolean };

function leerLocal(codigo: string): Local | null {
  try { const s = localStorage.getItem(GUARDADO(codigo)); return s ? (JSON.parse(s) as Local) : null; } catch { return null; }
}
function guardarLocal(codigo: string, l: Local) {
  try { localStorage.setItem(GUARDADO(codigo), JSON.stringify(l)); } catch { /* sin almacenamiento: sigue en memoria */ }
}

export default function ArbitroPage() {
  const [codigo, setCodigo] = useState('');
  const [partido, setPartido] = useState<PartidoDelArbitro | null>(null);
  const [torneo, setTorneo] = useState<Torneo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [pendiente, setPendiente] = useState(false);

  async function ingresar(c: string) {
    setCargando(true); setError(null);
    const r = await entrar(c);
    setCargando(false);
    if (!r.ok) { setError(r.error); return; }
    const local = leerLocal(c);
    // Si en el teléfono hay más jugadas sin subir que en el servidor, mandan las del teléfono.
    const usaLocal = !!local && local.pendiente && local.jugadas.length > r.valor.jugadas.length;
    const p = usaLocal ? { ...r.valor, jugadas: local!.jugadas } : r.valor;
    setPendiente(usaLocal);
    setPartido(p);
    setTorneo(await leerTorneo(p.torneoId));
  }

  if (!partido) {
    return (
      <Marco>
        <h1 className="text-2xl font-black uppercase tracking-wide">Árbitro</h1>
        <p className="mt-1 text-sm opacity-75">Poné el código de 4 números del partido.</p>
        <form className="mt-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); void ingresar(codigo); }}>
          <input
            inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 4))}
            aria-label="Código del partido"
            className="w-40 rounded-xl bg-white/10 px-4 py-3 text-center text-3xl font-black tracking-[0.4em] text-white outline-none ring-2 ring-white/20 focus:ring-[#CCFF00]"
          />
          <button disabled={codigo.length !== 4 || cargando} className="rounded-xl bg-[#CCFF00] px-5 text-lg font-black text-[#001F3F] disabled:opacity-40">
            {cargando ? '…' : 'Entrar'}
          </button>
        </form>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-500/20 p-3 text-sm">{error}</p>}
      </Marco>
    );
  }
  return <Partido codigo={codigo} inicial={partido} pendiente={pendiente} torneo={torneo} onSalir={() => { setPartido(null); setCodigo(''); }} />;
}

function Marco({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh bg-[#001F3F] px-4 py-6 text-white"><div className="mx-auto max-w-md">{children}</div></main>;
}

function Partido({ codigo, inicial, pendiente, torneo, onSalir }: { codigo: string; inicial: PartidoDelArbitro; pendiente: boolean; torneo: Torneo | null; onSalir: () => void }) {
  const [jugadas, setJugadas] = useState<Jugada[]>(inicial.jugadas);
  // El formato lo puede cambiar el árbitro al empezar (viaja en la jugada de inicio).
  const f = useMemo(() => formatoDelPartido(inicial.formato, jugadas), [inicial.formato, jugadas]);
  // Lo último que eligió al empezar, para volver a la pantalla de inicio con eso marcado.
  const [ultimoInicio, setUltimoInicio] = useState<Extract<Jugada, { t: 'inicio' }> | null>(
    inicial.jugadas[0]?.t === 'inicio' ? inicial.jugadas[0] : null);
  const [version, setVersion] = useState(inicial.version);
  // Al reabrir con puntos marcados sin señal, quedan para subir enseguida.
  const [sinSubir, setSinSubir] = useState(pendiente);
  const [aviso, setAviso] = useState<string | null>(null);
  const [terminado, setTerminado] = useState(inicial.estado === 'terminado');
  const [confirmar, setConfirmar] = useState(false);
  const enviando = useRef(false);
  const datos: PartidoArbitrado | null = useMemo(() => (torneo ? ladosDelPartido(torneo, inicial.partidoId) : null), [torneo, inicial.partidoId]);
  const e = useMemo(() => estadoDe(f, inicial.dobles, jugadas), [f, inicial.dobles, jugadas]);
  const nombre = (l: Lado) => (l === 'A' ? datos?.a?.nombre : datos?.b?.nombre) ?? (l === 'A' ? 'Equipo A' : 'Equipo B');
  const jugadores = (l: Lado) => (l === 'A' ? datos?.a?.jugadores : datos?.b?.jugadores) ?? ['Jugador 1', 'Jugador 2'];

  const subir = useCallback(async (lista: Jugada[], ver: number) => {
    if (enviando.current) return;
    enviando.current = true;
    const r = await marcar(codigo, ver, lista, resumen(estadoDe(formatoDelPartido(inicial.formato, lista), inicial.dobles, lista)));
    enviando.current = false;
    if (r.ok) {
      setVersion(r.valor); setSinSubir(false); guardarLocal(codigo, { jugadas: lista, version: r.valor, pendiente: false });
    } else if (r.error === 'desfasado' && r.jugadas && typeof r.version === 'number') {
      setJugadas(r.jugadas); setVersion(r.version); setSinSubir(false);
      setAviso('Otro dispositivo cambió este partido: se trajo lo que había en el servidor.');
    } else {
      setSinSubir(true); guardarLocal(codigo, { jugadas: lista, version: ver, pendiente: true });
    }
  }, [codigo, inicial.formato, inicial.dobles]);

  // Reintento si quedó algo sin subir (cada 5 s y al volver la señal).
  useEffect(() => {
    if (!sinSubir) return;
    const intentar = () => void subir(jugadas, version);
    const reloj = window.setInterval(intentar, 5000);
    window.addEventListener('online', intentar);
    return () => { window.clearInterval(reloj); window.removeEventListener('online', intentar); };
  }, [sinSubir, subir, jugadas, version]);

  function jugar(j: Jugada | 'deshacer') {
    if (j !== 'deshacer' && j.t === 'inicio') setUltimoInicio(j);
    const lista = j === 'deshacer' ? jugadas.slice(0, -1) : [...jugadas, j];
    setJugadas(lista); setAviso(null);
    guardarLocal(codigo, { jugadas: lista, version, pendiente: true });
    void subir(lista, version);
  }

  async function cerrar() {
    const res = resultadoFinal(f, e);
    if (!res) return;
    const r = await terminar(codigo, version, jugadas, resumen(e), res);
    if (r.ok) { setTerminado(true); setConfirmar(false); try { localStorage.removeItem(GUARDADO(codigo)); } catch { /* nada */ } }
    else setAviso(r.error === 'red' ? 'Sin señal: probá de nuevo en un momento.' : r.error);
  }

  if (terminado) {
    return (
      <Marco>
        <p className="text-sm uppercase opacity-70">{datos?.titulo}</p>
        <h1 className="mt-2 text-3xl font-black">Resultado cargado ✓</h1>
        <p className="mt-2">{nombre('A')} {e.games.map((g) => `${g.a}-${g.b}`).join(' / ')} {nombre('B')}</p>
        <button onClick={onSalir} className="mt-6 rounded-xl bg-[#CCFF00] px-5 py-3 font-black text-[#001F3F]">Otro partido</button>
      </Marco>
    );
  }

  if (!e.iniciado) {
    return <Inicio datos={datos} dobles={inicial.dobles} jugadores={jugadores} nombre={nombre} base={inicial.formato} previo={ultimoInicio}
      onEmpezar={(j) => jugar(j)} onSalir={onSalir} faltanRivales={!!torneo && (!datos?.a || !datos?.b)} />;
  }

  const recibe: Lado = e.saca === 'A' ? 'B' : 'A';
  const tiempo = (l: Lado) => (
    <button onClick={() => jugar({ t: 'tiempo', equipo: l })} disabled={e.tiempos[l] >= e.maxTiempos}
      className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold disabled:opacity-40">
      Tiempo {nombre(l).split(' ')[0]} ({e.maxTiempos - e.tiempos[l]})
    </button>
  );

  return (
    <Marco>
      <div className="flex items-center justify-between text-xs uppercase opacity-70">
        <span>{datos?.titulo ?? 'Partido'}</span>
        <span>{f.tipo === 'rally' ? 'Rally' : 'Saque'} a {f.a}{f.mejorDe === 3 ? ` · Game ${e.game}` : ''}</span>
      </div>
      {f.mejorDe === 3 && <p className="mt-1 text-center text-sm font-bold">Games {e.gamesA}-{e.gamesB}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(['A', 'B'] as Lado[]).map((l) => (
          <div key={l} className={`rounded-2xl p-3 ${e.saca === l ? 'bg-[#CCFF00] text-[#001F3F]' : 'bg-white/10'}`}>
            <p className="text-xs font-bold uppercase leading-tight">{nombre(l)}</p>
            <p className="text-6xl font-black tabular-nums">{l === 'A' ? e.puntos.a : e.puntos.b}</p>
            {e.saca === l && <p className="text-xs font-bold">Saca {inicial.dobles ? jugadores(l)[e.sirve] : ''}</p>}
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-5xl font-black tracking-wider tabular-nums">{e.canto}</p>
      {e.cambiarLado && <p className="mt-2 rounded-lg bg-orange-500 p-2 text-center font-black">CAMBIO DE LADO</p>}
      {e.finDeGame && <p className="mt-2 rounded-lg bg-sky-500 p-2 text-center font-black">FIN DEL GAME {e.game - 1} · cambio de lado</p>}
      {aviso && <p role="alert" className="mt-2 rounded-lg bg-red-500/30 p-2 text-sm">{aviso}</p>}
      {sinSubir && <p className="mt-2 text-center text-xs text-yellow-300">Sin señal: lo marcado queda guardado y se sube solo.</p>}

      {e.terminado ? (
        <div className="mt-6 grid gap-2">
          <p className="text-center text-lg font-black">Ganó {nombre(e.ganador as Lado)}</p>
          {!confirmar
            ? <button onClick={() => setConfirmar(true)} className="rounded-2xl bg-[#CCFF00] py-5 text-xl font-black text-[#001F3F]">Terminar partido</button>
            : <button onClick={() => void cerrar()} className="rounded-2xl bg-[#CCFF00] py-5 text-xl font-black text-[#001F3F]">Confirmar {e.games.map((g) => `${g.a}-${g.b}`).join(' / ')}</button>}
          <button onClick={() => jugar('deshacer')} className="rounded-xl bg-white/10 py-3 font-bold">↶ Deshacer último punto</button>
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          <button onClick={() => jugar({ t: 'rally', gana: e.saca })} className="rounded-2xl bg-[#CCFF00] py-7 text-2xl font-black text-[#001F3F] active:scale-95">
            Ganó el que saca
          </button>
          <button onClick={() => jugar({ t: 'rally', gana: recibe })} className="rounded-2xl bg-white py-7 text-2xl font-black text-[#001F3F] active:scale-95">
            Ganó el que recibe
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button onClick={() => jugar('deshacer')} className="rounded-lg bg-white/10 px-4 py-2 font-bold">
              {jugadas.length <= 1 ? '↶ Cambiar saque o formato' : '↶ Deshacer'}
            </button>
            <div className="flex gap-2">{tiempo('A')}{tiempo('B')}</div>
          </div>
        </div>
      )}
    </Marco>
  );
}

function Inicio({ datos, dobles, jugadores, nombre, base, previo, onEmpezar, onSalir, faltanRivales }: {
  datos: PartidoArbitrado | null; dobles: boolean; jugadores: (l: Lado) => string[]; nombre: (l: Lado) => string;
  base: FormatoArbitraje; previo: Extract<Jugada, { t: 'inicio' }> | null;
  onEmpezar: (j: Jugada) => void; onSalir: () => void; faltanRivales: boolean;
}) {
  const [saca, setSaca] = useState<Lado | null>(previo?.saca ?? null);
  const [der, setDer] = useState<{ A: 0 | 1; B: 0 | 1 }>({ A: previo?.derechaA ?? 0, B: previo?.derechaB ?? 0 });
  const [formato, setFormato] = useState<FormatoArbitraje>(previo?.formato ?? base);
  const opcion = (activa: boolean) => `rounded-xl p-3 text-sm font-bold ${activa ? 'bg-white text-[#001F3F]' : 'bg-white/10'}`;
  if (faltanRivales) {
    return (
      <Marco>
        <p className="text-sm uppercase opacity-70">{datos?.titulo}</p>
        <h1 className="mt-2 text-2xl font-black">Todavía no se sabe quién juega</h1>
        <p className="mt-2 text-sm opacity-80">Este cruce depende de un partido anterior. Volvé a entrar cuando termine.</p>
        <button onClick={onSalir} className="mt-6 rounded-xl bg-white/10 px-5 py-3 font-bold">Volver</button>
      </Marco>
    );
  }
  return (
    <Marco>
      <p className="text-sm uppercase opacity-70">{datos?.titulo ?? 'Partido'}</p>
      <h1 className="mt-1 text-xl font-black">{nombre('A')} <span className="text-[#CCFF00]">vs</span> {nombre('B')}</h1>
      <p className="mt-5 text-sm font-bold uppercase opacity-75">¿Cómo se juega?</p>
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
      <p className="mt-5 text-sm font-bold uppercase opacity-75">¿Quién saca primero?</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(['A', 'B'] as Lado[]).map((l) => (
          <button key={l} onClick={() => setSaca(l)} className={`rounded-xl p-3 text-left text-sm font-bold ${saca === l ? 'bg-[#CCFF00] text-[#001F3F]' : 'bg-white/10'}`}>{nombre(l)}</button>
        ))}
      </div>
      {dobles && (['A', 'B'] as Lado[]).map((l) => (
        <div key={l} className="mt-4">
          <p className="text-sm font-bold uppercase opacity-75">¿Quién arranca a la derecha? · {nombre(l)}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {jugadores(l).slice(0, 2).map((j, i) => (
              <button key={j} onClick={() => setDer({ ...der, [l]: i as 0 | 1 })} className={`rounded-xl p-3 text-sm font-bold ${der[l] === i ? 'bg-white text-[#001F3F]' : 'bg-white/10'}`}>{j}</button>
            ))}
          </div>
        </div>
      ))}
      <button disabled={!saca} onClick={() => saca && onEmpezar({ t: 'inicio', saca, derechaA: der.A, derechaB: der.B, formato })}
        className="mt-6 w-full rounded-2xl bg-[#CCFF00] py-5 text-xl font-black text-[#001F3F] disabled:opacity-40">
        Empezar partido
      </button>
    </Marco>
  );
}
