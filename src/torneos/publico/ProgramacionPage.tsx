import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PartidoLlave, SlotLlave, Torneo } from '../engine/tipos';
import { resultadoDe } from '../engine/tipos';
import { nombreDe } from '../ui/util';
import { listarTorneosPublicos } from './datos';
import { RkCargando, RkError } from './Estados';
import '../torneos.css';

// ─── Programación en vivo del Racket Roll ────────────────────────────────────
// Dos vistas en una: los partidos PENDIENTES con hora y cancha proyectadas
// (greedy sobre las canchas, anclado en la hora actual) y los RESULTADOS que se
// van cargando en el gestor, con puntaje. Pensada para el celular en la cancha:
// tarjetas grandes, filtro por categoría con un toque, refresh cada 60s.

type Dia = 'SAB' | 'DOM';

// 3 canchas (definido por Brian la víspera): el greedy reparte sobre estas.
const CANCHAS = ['Cancha 1', 'Cancha 2', 'Cancha 3'];
// El domingo depende de cuántas canchas haya (se define el sábado): hasta entonces
// NO se publican horarios por partido, solo los inicios de bloque del flyer.
const DOM_CONFIRMADO = false;
const BLOQUES_DOM: [string, string][] = [
  ['9:30', 'Femenino B'], ['11:00', 'Mixto B'], ['12:30', 'Masculino B'],
  ['14:00', 'Femenino A'], ['15:30', 'Mixto A'], ['17:00', 'Masculino A'],
];
const FECHA_DIA: Record<Dia, string> = { SAB: '2026-08-22', DOM: '2026-08-23' };
const NOMBRE_DIA: Record<Dia, string> = { SAB: 'Sábado 22', DOM: 'Domingo 23' };
// Duración real por partido con calentamiento (dato de Brian, 22/08): ~15 min
// tanto a 11 standard como a 21 rally (las C). La final lleva 5 min extra.
const DUR_PARTIDO = 15;
// OPC del sábado 18:00-19:30: ocupa todas las canchas; los singles arrancan después.
const OPC_INICIO = 18 * 60;
const OPC_FIN = 19 * 60 + 30;

// Hora de inicio de cada categoría según el flyer (minutos desde las 00:00).
const PROGRAMA: Record<string, { dia: Dia; inicio: number }> = {
  'FEMENINO C RACKET ROLL': { dia: 'SAB', inicio: 10 * 60 },
  'MIXTO C RACKET ROLL': { dia: 'SAB', inicio: 12 * 60 },
  'MIXTO +50 RACKET ROLL': { dia: 'SAB', inicio: 12 * 60 },
  'MASCULINO C RACKET ROLL': { dia: 'SAB', inicio: 14 * 60 },
  'MASCULINO +50 RACKET ROLL': { dia: 'SAB', inicio: 14 * 60 },
  'SINGLES MASCULINO B RACKET ROLL': { dia: 'SAB', inicio: OPC_FIN },
  'SINGLES FEMENINO RACKET ROLL': { dia: 'SAB', inicio: OPC_FIN },
  'SINGLES MASCULINO A RACKET ROLL': { dia: 'SAB', inicio: 21 * 60 },
  'FEMENINO B RACKET ROLL': { dia: 'DOM', inicio: 9 * 60 + 30 },
  'MIXTO B RACKET ROLL': { dia: 'DOM', inicio: 11 * 60 },
  'MASCULINO B RACKET ROLL': { dia: 'DOM', inicio: 12 * 60 + 30 },
  'FEMENINO A RACKET ROLL': { dia: 'DOM', inicio: 14 * 60 },
  'MIXTO A RACKET ROLL': { dia: 'DOM', inicio: 15 * 60 + 30 },
  'MASCULINO A RACKET ROLL': { dia: 'DOM', inicio: 17 * 60 },
};

type PartidoProg = { a: string; b: string; fase: string };
type ResultadoItem = { fase: string; a: string; b: string; pa: number; pb: number };
type CatProg = {
  nombre: string;
  corto: string;
  dia: Dia;
  inicio: number;
  rondas: PartidoProg[][][]; // [grupo][ronda][partidos en paralelo]
  llave: PartidoProg[][]; // olas: 4tos → semis → final
  resultados: ResultadoItem[];
  jugados: number;
  total: number;
  terminado: boolean;
};
type Fila = { dia: Dia; ini: number; cancha: string; categoria: string; fase: string; a: string; b: string };

const aHora = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Rondas todos-contra-todos con descansos repartidos (método del círculo), por tamaño.
const RONDAS_RR: Record<number, [number, number][][]> = {
  2: [[[1, 2]]],
  3: [[[1, 2]], [[1, 3]], [[2, 3]]],
  4: [[[1, 2], [3, 4]], [[1, 3], [2, 4]], [[1, 4], [2, 3]]],
  5: [[[2, 5], [3, 4]], [[1, 3], [4, 5]], [[2, 4], [1, 5]], [[3, 5], [1, 2]], [[1, 4], [2, 3]]],
};

// Tamaños de grupo si todavía no se sorteó (mismas reglas que usó el organizador).
function tamanosProyectados(n: number): number[] {
  if (n <= 5) return [n];
  const mapa: Record<number, number[]> = {
    6: [3, 3], 7: [4, 3], 8: [4, 4], 9: [3, 3, 3], 10: [4, 3, 3],
    11: [4, 4, 3], 12: [4, 4, 4], 13: [4, 3, 3, 3], 14: [4, 4, 3, 3],
  };
  return mapa[n] ?? [4, 4, 4, 4];
}

// Sigue la cadena ganadorDe/perdedorDe hasta la pareja real, si ya se puede saber.
function parejaDeSlot(s: SlotLlave | null, porId: Map<string, PartidoLlave>): string | null {
  if (!s) return null;
  if (s.tipo === 'seed') return s.parejaId;
  const p = porId.get(s.partidoId);
  if (!p) return null;
  const r = resultadoDe(p);
  if (!r) return null;
  const ganoA = r.a > r.b;
  const siguiente = (s.tipo === 'ganadorDe') === ganoA ? p.a : p.b;
  return parejaDeSlot(siguiente, porId);
}

function llaveProyectada(nGrupos: number): PartidoProg[][] {
  if (nGrupos <= 1) return [[{ a: '1° de la liga', b: '2° de la liga', fase: 'FINAL' }]];
  if (nGrupos === 2) {
    return [
      [{ a: '1° Grupo A', b: '2° Grupo B', fase: 'SEMIS' }, { a: '1° Grupo B', b: '2° Grupo A', fase: 'SEMIS' }],
      [{ a: 'Ganador SF1', b: 'Ganador SF2', fase: 'FINAL' }],
    ];
  }
  return [
    Array.from({ length: 4 }, (_, i) => ({ a: `Cruce ${i + 1}`, b: 'según tabla', fase: '4TOS' })),
    [{ a: 'Ganador QF1', b: 'Ganador QF2', fase: 'SEMIS' }, { a: 'Ganador QF3', b: 'Ganador QF4', fase: 'SEMIS' }],
    [{ a: 'Ganador SF1', b: 'Ganador SF2', fase: 'FINAL' }],
  ];
}

// Extrae del torneo lo pendiente (real si existe, proyectado si no) y lo jugado.
function armarCategoria(t: Torneo, cfg: { dia: Dia; inicio: number }): CatProg {
  const rondas: PartidoProg[][][] = [];
  let llave: PartidoProg[][] = [];
  const resultados: ResultadoItem[] = [];
  let jugados = 0;
  let total = 0;

  if (t.partidosGrupo.length > 0) {
    for (const g of t.grupos) {
      const delGrupo = t.partidosGrupo.filter((p) => p.grupoId === g.id);
      total += delGrupo.length;
      const porRonda = new Map<number, PartidoProg[]>();
      for (const p of delGrupo) {
        const r = resultadoDe(p);
        if (r) {
          jugados += 1;
          resultados.push({ fase: `Grupo ${g.nombre}`, a: nombreDe(t, p.aId), b: nombreDe(t, p.bId), pa: r.a, pb: r.b });
          continue;
        }
        const lista = porRonda.get(p.ronda) ?? [];
        lista.push({ a: nombreDe(t, p.aId), b: nombreDe(t, p.bId), fase: `Grupo ${g.nombre}` });
        porRonda.set(p.ronda, lista);
      }
      rondas.push([...porRonda.entries()].sort((x, y) => x[0] - y[0]).map(([, lista]) => lista));
    }
  } else if (t.grupos.length > 0) {
    for (const g of t.grupos) {
      const n = Math.min(g.parejaIds.length, 5);
      const plan = (RONDAS_RR[n] ?? []).map((ronda) =>
        ronda.map(([a, b]) => ({
          a: nombreDe(t, g.parejaIds[a - 1]), b: nombreDe(t, g.parejaIds[b - 1]), fase: `Grupo ${g.nombre}`,
        })),
      );
      rondas.push(plan);
      total += plan.reduce((s, r) => s + r.length, 0);
    }
  } else {
    const tams = tamanosProyectados(t.parejas.length);
    tams.forEach((n, gi) => {
      const plan = (RONDAS_RR[Math.min(n, 5)] ?? []).map((ronda) =>
        ronda.map(([a, b]) => ({ a: `Dupla ${a}`, b: `Dupla ${b}`, fase: `Grupo ${gi + 1}` })),
      );
      rondas.push(plan);
      total += plan.reduce((s, r) => s + r.length, 0);
    });
  }

  if (t.partidosLlave && t.partidosLlave.length > 0) {
    const porId = new Map(t.partidosLlave.map((p) => [p.id, p]));
    const jugables = t.partidosLlave.filter((p) => p.a !== null && p.b !== null);
    total += jugables.length;
    const maxRonda = Math.max(...t.partidosLlave.map((p) => p.ronda));
    const nombreSlot = (s: SlotLlave | null): string => {
      const id = parejaDeSlot(s, porId);
      if (id) return nombreDe(t, id);
      if (!s) return 'BYE';
      return s.tipo === 'ganadorDe' ? 'Ganador ronda previa' : 'Perdedor ronda previa';
    };
    const porRonda = new Map<number, PartidoProg[]>();
    for (const p of jugables) {
      const fase = p.esTercerPuesto ? '3er PUESTO'
        : p.ronda === maxRonda ? 'FINAL'
        : p.ronda === maxRonda - 1 ? 'SEMIS' : '4TOS';
      const r = resultadoDe(p);
      if (r) {
        jugados += 1;
        resultados.push({ fase, a: nombreSlot(p.a), b: nombreSlot(p.b), pa: r.a, pb: r.b });
        continue;
      }
      const lista = porRonda.get(p.ronda) ?? [];
      lista.push({ a: nombreSlot(p.a), b: nombreSlot(p.b), fase });
      porRonda.set(p.ronda, lista);
    }
    llave = [...porRonda.entries()].sort((x, y) => x[0] - y[0]).map(([, lista]) => lista);
  } else if (t.fase !== 'terminado') {
    const nGrupos = Math.max(t.grupos.length, tamanosProyectados(t.parejas.length).length);
    llave = llaveProyectada(nGrupos);
    llave.forEach((ola) => { total += ola.length; });
  }

  // Lo último que se juega (llave) arriba: los resultados se apilan al revés.
  resultados.reverse();

  return {
    nombre: t.nombre, corto: t.nombre.replace(' RACKET ROLL', ''), dia: cfg.dia, inicio: cfg.inicio,
    rondas, llave, resultados, jugados, total, terminado: t.fase === 'terminado',
  };
}

// Greedy de canchas: cada partido toma la cancha que antes se libere; una ronda
// de un grupo no arranca sin cerrar la anterior.
function programar(cats: CatProg[], ancla: Record<Dia, number>): Fila[] {
  const filas: Fila[] = [];
  for (const dia of ['SAB', 'DOM'] as Dia[]) {
    const canchas = CANCHAS.map(() => ancla[dia]);
    let opcMarcado = false;
    const delDia = cats.filter((c) => c.dia === dia && !c.terminado).sort((a, b) => a.inicio - b.inicio);
    for (const cat of delDia) {
      if (dia === 'SAB' && cat.inicio >= OPC_FIN && !opcMarcado) {
        opcMarcado = true;
        if (ancla.SAB < OPC_FIN) {
          filas.push({ dia, ini: Math.max(OPC_INICIO, ancla.SAB), cancha: 'TODAS', categoria: 'ONE POINT CHALLENGE', fase: 'Punto único', a: 'Todos los anotados', b: 'eliminación directa' });
          for (let i = 0; i < canchas.length; i++) canchas[i] = Math.max(canchas[i], OPC_FIN);
        }
      }
      const disp = cat.rondas.map(() => Math.max(cat.inicio, Math.min(...canchas)));
      const maxRondas = Math.max(0, ...cat.rondas.map((g) => g.length));
      for (let r = 0; r < maxRondas; r++) {
        cat.rondas.forEach((grupo, gi) => {
          if (r >= grupo.length) return;
          let finRonda = disp[gi];
          for (const p of grupo[r]) {
            const ci = canchas.indexOf(Math.min(...canchas));
            const ini = Math.max(disp[gi], canchas[ci], cat.inicio);
            canchas[ci] = ini + DUR_PARTIDO;
            finRonda = Math.max(finRonda, ini + DUR_PARTIDO);
            filas.push({ dia, ini, cancha: CANCHAS[ci], categoria: cat.corto, fase: p.fase, a: p.a, b: p.b });
          }
          disp[gi] = finRonda;
        });
      }
      let listo = Math.max(cat.inicio, ...disp);
      for (const ola of cat.llave) {
        let finOla = listo;
        for (const p of ola) {
          const d = p.fase === 'FINAL' ? DUR_PARTIDO + 5 : DUR_PARTIDO;
          const ci = canchas.indexOf(Math.min(...canchas));
          const ini = Math.max(listo, canchas[ci]);
          canchas[ci] = ini + d;
          finOla = Math.max(finOla, ini + d);
          filas.push({ dia, ini, cancha: CANCHAS[ci], categoria: cat.corto, fase: p.fase, a: p.a, b: p.b });
        }
        listo = finOla;
      }
    }
  }
  return filas.sort((a, b) => a.ini - b.ini || a.cancha.localeCompare(b.cancha));
}

type Estado = 'cargando' | 'ok' | 'error';

const chip: React.CSSProperties = {
  fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
  padding: '3px 9px', borderRadius: 999, border: '1px solid var(--borde)', whiteSpace: 'nowrap',
};
const carta: React.CSSProperties = {
  background: 'var(--navy-1)', border: '1px solid var(--borde)', borderRadius: 14, padding: '12px 14px',
};

export default function ProgramacionPage() {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [mensajeError, setMensajeError] = useState('');
  const [torneos, setTorneos] = useState<Torneo[]>([]);
  const [actualizado, setActualizado] = useState<Date | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const hoyISO = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const [dia, setDia] = useState<Dia>(hoyISO === FECHA_DIA.DOM ? 'DOM' : 'SAB');
  const [filtro, setFiltro] = useState('');

  const cargar = useCallback(async (primera: boolean) => {
    if (primera) setEstado('cargando');
    const r = await listarTorneosPublicos();
    if (r.error) {
      if (primera) { setMensajeError(r.error); setEstado('error'); }
      return; // refresh silencioso fallido: se mantiene lo último que se vio
    }
    setTorneos(r.torneos);
    setActualizado(new Date());
    setEstado('ok');
  }, []);

  useEffect(() => {
    void cargar(true);
    const timer = window.setInterval(() => void cargar(false), 60000);
    return () => window.clearInterval(timer);
  }, [cargar]);

  const { filas, cats } = useMemo(() => {
    const cats = torneos
      .filter((t) => PROGRAMA[t.nombre])
      .map((t) => armarCategoria(t, PROGRAMA[t.nombre]));
    const ahora = new Date();
    const nowMin = ahora.getHours() * 60 + ahora.getMinutes();
    const ancla: Record<Dia, number> = {
      SAB: hoyISO === FECHA_DIA.SAB ? Math.max(10 * 60, nowMin) : 10 * 60,
      DOM: hoyISO === FECHA_DIA.DOM ? Math.max(9 * 60 + 30, nowMin) : 9 * 60 + 30,
    };
    return { filas: programar(cats, ancla), cats };
  }, [torneos, hoyISO, actualizado]); // eslint-disable-line react-hooks/exhaustive-deps

  if (estado === 'cargando') return <RkCargando texto="Armando la programación…" />;
  if (estado === 'error') return <RkError mensaje={mensajeError} onReintentar={() => void cargar(true)} />;

  const catsDelDia = cats.filter((c) => c.dia === dia).sort((a, b) => a.inicio - b.inicio);
  const pendientes = filas.filter((f) => f.dia === dia && (!filtro || f.categoria === filtro || f.categoria === 'ONE POINT CHALLENGE'));
  const visibles = verTodos || filtro ? pendientes : pendientes.slice(0, 12);
  const conResultados = catsDelDia.filter((c) => c.resultados.length > 0 && (!filtro || c.corto === filtro));
  const domSinConfirmar = dia === 'DOM' && !DOM_CONFIRMADO;

  return (
    <div className="rk">
      <main className="contenedor">
        <header className="cabecera">
          <h1><span className="marca">EN VIVO</span> RACKET ROLL</h1>
          <div className="acciones">
            <Link className="boton secundario" to="/torneos">Cuadros</Link>
            <button className="boton secundario" onClick={() => void cargar(false)}>Actualizar</button>
          </div>
        </header>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          {(['SAB', 'DOM'] as Dia[]).map((d) => (
            <button key={d} className={`boton ${dia === d ? '' : 'secundario'}`} onClick={() => { setDia(d); setFiltro(''); setVerTodos(false); }}>
              {NOMBRE_DIA[d]}
            </button>
          ))}
          <span style={{ fontSize: '0.8rem', opacity: 0.65, marginLeft: 'auto' }}>
            Horarios estimados{actualizado ? ` · ${actualizado.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
        </div>

        {/* Filtro por categoría: un toque y ves solo lo tuyo */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 16 }}>
          <button onClick={() => setFiltro('')}
            style={{ ...chip, cursor: 'pointer', background: filtro === '' ? 'var(--lima)' : 'transparent', color: filtro === '' ? '#101c33' : 'var(--texto)' }}>
            Todas
          </button>
          {catsDelDia.map((c) => (
            <button key={c.corto} onClick={() => { setFiltro(filtro === c.corto ? '' : c.corto); setVerTodos(false); }}
              style={{ ...chip, cursor: 'pointer', background: filtro === c.corto ? 'var(--lima)' : 'transparent', color: filtro === c.corto ? '#101c33' : 'var(--texto)' }}>
              {c.corto} {c.terminado ? '✓' : `${c.jugados}/${c.total}`}
            </button>
          ))}
        </div>

        {domSinConfirmar ? (
          <div style={{ ...carta, marginBottom: 20 }}>
            <p style={{ margin: '0 0 10px', fontSize: '1.05rem' }}>
              <strong>Programación del domingo a confirmar</strong> — depende de las canchas
              disponibles; el detalle por partido se publica el sábado a la noche.
            </p>
            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 2, fontSize: '1.05rem' }}>
              {BLOQUES_DOM.map(([h, c]) => <li key={c}><strong>{h}</strong> — {c}</li>)}
            </ul>
          </div>
        ) : (
          <>
            <h2 style={{ fontSize: '1.05rem', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.8, margin: '0 0 10px' }}>
              Próximos partidos
            </h2>
            {pendientes.length === 0 ? (
              <p className="vacio">No queda nada pendiente para este día 🎉</p>
            ) : (
              <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
                {visibles.map((f, i) => (
                  <div key={i} style={carta}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--lima)' }}>{aHora(f.ini)}</span>
                      <span style={chip}>{f.cancha}</span>
                      <span style={chip}>{f.categoria}</span>
                      <span style={{ ...chip, border: 'none', opacity: 0.7, fontWeight: f.fase === 'FINAL' ? 800 : 700 }}>{f.fase}</span>
                    </div>
                    <div style={{ fontSize: '1.02rem', fontWeight: 600, lineHeight: 1.45 }}>
                      {f.a}
                      <span style={{ opacity: 0.55, fontWeight: 400 }}> vs </span>
                      {f.b}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!verTodos && !filtro && pendientes.length > visibles.length && (
              <button className="boton secundario" style={{ width: '100%', marginBottom: 20 }} onClick={() => setVerTodos(true)}>
                Ver los {pendientes.length} pendientes del día
              </button>
            )}
          </>
        )}

        {conResultados.length > 0 && (
          <>
            <h2 style={{ fontSize: '1.05rem', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.8, margin: '18px 0 10px' }}>
              Resultados
            </h2>
            <div style={{ display: 'grid', gap: 14 }}>
              {conResultados.map((c) => (
                <div key={c.corto} style={carta}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 8 }}>
                    <strong style={{ fontSize: '1.02rem' }}>{c.corto}</strong>
                    <span style={{ fontSize: '0.78rem', opacity: 0.6 }}>{c.jugados}/{c.total} jugados</span>
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {c.resultados.map((r, i) => {
                      const ganaA = r.pa > r.pb;
                      return (
                        <div key={i} style={{ borderTop: i ? '1px solid var(--borde)' : 'none', paddingTop: i ? 8 : 0 }}>
                          <div style={{ fontSize: '0.72rem', opacity: 0.6, textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>{r.fase}</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '1rem', fontWeight: ganaA ? 700 : 400 }}>
                            <span>{r.a}</span>
                            <span style={{ color: ganaA ? 'var(--lima)' : 'inherit', fontWeight: 800 }}>{r.pa}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '1rem', fontWeight: ganaA ? 400 : 700 }}>
                            <span>{r.b}</span>
                            <span style={{ color: ganaA ? 'inherit' : 'var(--lima)', fontWeight: 800 }}>{r.pb}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
