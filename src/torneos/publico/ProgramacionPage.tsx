import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SlotLlave, Torneo } from '../engine/tipos';
import { resultadoValido } from '../engine/tipos';
import { nombreDe } from '../ui/util';
import { listarTorneosPublicos } from './datos';
import { RkCargando, RkError } from './Estados';
import '../torneos.css';

// ─── Programación en vivo del Racket Roll ────────────────────────────────────
// Proyecta hora y cancha de TODOS los partidos pendientes con un greedy sobre las
// 5 canchas, anclado en la hora actual: cada resultado que el admin carga en el
// gestor saca ese partido de la cola y el resto se reacomoda solo (la página se
// refresca cada 60s). Los horarios son estimados, no promesas — se dice arriba.

type Dia = 'SAB' | 'DOM';

const CANCHAS = ['Cancha 1', 'Cancha 2', 'Cancha 3', 'Cancha 4 (ext)', 'Cancha 5 (ext)'];
const FECHA_DIA: Record<Dia, string> = { SAB: '2026-08-22', DOM: '2026-08-23' };
const NOMBRE_DIA: Record<Dia, string> = { SAB: 'Sábado 22', DOM: 'Domingo 23' };
// Duración estimada por partido, en minutos (grupos a 11 puntos, llave a 15).
const DUR = { grupoDobles: 18, grupoSingles: 15, llaveDobles: 22, llaveSingles: 18 };
// OPC del sábado 18:00-19:30: ocupa todas las canchas; los singles arrancan después.
const OPC_INICIO = 18 * 60;
const OPC_FIN = 19 * 60 + 30;

// Hora de inicio de cada categoría según el flyer (minutos desde las 00:00).
const PROGRAMA: Record<string, { dia: Dia; inicio: number; singles?: boolean }> = {
  'FEMENINO C RACKET ROLL': { dia: 'SAB', inicio: 10 * 60 },
  'MIXTO C RACKET ROLL': { dia: 'SAB', inicio: 12 * 60 },
  'MIXTO +50 RACKET ROLL': { dia: 'SAB', inicio: 12 * 60 },
  'MASCULINO C RACKET ROLL': { dia: 'SAB', inicio: 14 * 60 },
  'MASCULINO +50 RACKET ROLL': { dia: 'SAB', inicio: 14 * 60 },
  'SINGLES MASCULINO B RACKET ROLL': { dia: 'SAB', inicio: OPC_FIN, singles: true },
  'SINGLES FEMENINO RACKET ROLL': { dia: 'SAB', inicio: OPC_FIN, singles: true },
  'SINGLES MASCULINO A RACKET ROLL': { dia: 'SAB', inicio: 21 * 60, singles: true },
  'FEMENINO B RACKET ROLL': { dia: 'DOM', inicio: 9 * 60 + 30 },
  'MIXTO B RACKET ROLL': { dia: 'DOM', inicio: 11 * 60 },
  'MASCULINO B RACKET ROLL': { dia: 'DOM', inicio: 12 * 60 + 30 },
  'FEMENINO A RACKET ROLL': { dia: 'DOM', inicio: 14 * 60 },
  'MIXTO A RACKET ROLL': { dia: 'DOM', inicio: 15 * 60 + 30 },
  'MASCULINO A RACKET ROLL': { dia: 'DOM', inicio: 17 * 60 },
};

type PartidoProg = { etiqueta: string; fase: string };
type CatProg = {
  nombre: string;
  dia: Dia;
  inicio: number;
  singles: boolean;
  rondas: PartidoProg[][][]; // [grupo][ronda][partidos en paralelo]
  llave: PartidoProg[][]; // olas: 4tos → semis → final
  jugados: number;
  total: number;
  terminado: boolean;
};
type Fila = { dia: Dia; ini: number; cancha: string; categoria: string; fase: string; partido: string };

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

function slotNombre(t: Torneo, s: SlotLlave | null): string {
  if (!s) return 'BYE';
  if (s.tipo === 'seed') return nombreDe(t, s.parejaId);
  return s.tipo === 'ganadorDe' ? 'Ganador ronda previa' : 'Perdedor ronda previa';
}

function llaveProyectada(nGrupos: number): PartidoProg[][] {
  if (nGrupos <= 1) return [[{ etiqueta: '1° vs 2° de la liga', fase: 'FINAL' }]];
  if (nGrupos === 2) {
    return [
      [{ etiqueta: '1° G1 vs 2° G2', fase: 'SEMIS' }, { etiqueta: '1° G2 vs 2° G1', fase: 'SEMIS' }],
      [{ etiqueta: 'Ganadores de semis', fase: 'FINAL' }],
    ];
  }
  return [
    Array.from({ length: 4 }, (_, i) => ({ etiqueta: `Cruce ${i + 1} según tabla`, fase: '4TOS' })),
    [{ etiqueta: 'Ganadores de 4tos', fase: 'SEMIS' }, { etiqueta: 'Ganadores de 4tos', fase: 'SEMIS' }],
    [{ etiqueta: 'Ganadores de semis', fase: 'FINAL' }],
  ];
}

// Extrae del torneo lo pendiente, con datos reales si existen y proyección si no.
function armarCategoria(t: Torneo, cfg: { dia: Dia; inicio: number; singles?: boolean }): CatProg {
  const rondas: PartidoProg[][][] = [];
  let llave: PartidoProg[][] = [];
  let jugados = 0;
  let total = 0;

  if (t.partidosGrupo.length > 0) {
    // Fixture real del gestor: por grupo, por ronda, solo lo que falta jugar.
    for (const g of t.grupos) {
      const delGrupo = t.partidosGrupo.filter((p) => p.grupoId === g.id);
      total += delGrupo.length;
      const porRonda = new Map<number, PartidoProg[]>();
      for (const p of delGrupo) {
        if (resultadoValido(p.puntosA, p.puntosB)) { jugados += 1; continue; }
        const lista = porRonda.get(p.ronda) ?? [];
        lista.push({ etiqueta: `${nombreDe(t, p.aId)} vs ${nombreDe(t, p.bId)}`, fase: `Grupo ${g.nombre}` });
        porRonda.set(p.ronda, lista);
      }
      rondas.push([...porRonda.entries()].sort((a, b) => a[0] - b[0]).map(([, lista]) => lista));
    }
  } else if (t.grupos.length > 0) {
    // Grupos sorteados pero fixture aún no generado: se proyecta el todos-contra-todos.
    for (const g of t.grupos) {
      const n = Math.min(g.parejaIds.length, 5);
      const plan = (RONDAS_RR[n] ?? []).map((ronda) =>
        ronda.map(([a, b]) => ({
          etiqueta: `${nombreDe(t, g.parejaIds[a - 1])} vs ${nombreDe(t, g.parejaIds[b - 1])}`,
          fase: `Grupo ${g.nombre}`,
        })),
      );
      rondas.push(plan);
      total += plan.reduce((s, r) => s + r.length, 0);
    }
  } else {
    // Ni grupos: proyección pura por cantidad de anotados.
    const tams = tamanosProyectados(t.parejas.length);
    tams.forEach((n, gi) => {
      const plan = (RONDAS_RR[Math.min(n, 5)] ?? []).map((ronda) =>
        ronda.map(([a, b]) => ({
          etiqueta: `${t.formato === 'individual' || cfg.singles ? 'J' : 'Dupla '}${a} vs ${cfg.singles ? 'J' : 'Dupla '}${b}`,
          fase: `Grupo ${gi + 1}`,
        })),
      );
      rondas.push(plan);
      total += plan.reduce((s, r) => s + r.length, 0);
    });
  }

  if (t.partidosLlave && t.partidosLlave.length > 0) {
    const jugables = t.partidosLlave.filter((p) => p.a !== null && p.b !== null);
    total += jugables.length;
    const maxRonda = Math.max(...t.partidosLlave.map((p) => p.ronda));
    const porRonda = new Map<number, PartidoProg[]>();
    for (const p of jugables) {
      if (resultadoValido(p.puntosA, p.puntosB)) { jugados += 1; continue; }
      const fase = p.esTercerPuesto ? '3er PUESTO'
        : p.ronda === maxRonda ? 'FINAL'
        : p.ronda === maxRonda - 1 ? 'SEMIS' : '4TOS';
      const lista = porRonda.get(p.ronda) ?? [];
      lista.push({ etiqueta: `${slotNombre(t, p.a)} vs ${slotNombre(t, p.b)}`, fase });
      porRonda.set(p.ronda, lista);
    }
    llave = [...porRonda.entries()].sort((a, b) => a[0] - b[0]).map(([, lista]) => lista);
  } else if (t.fase !== 'terminado') {
    const nGrupos = Math.max(t.grupos.length, tamanosProyectados(t.parejas.length).length);
    llave = llaveProyectada(nGrupos);
    llave.forEach((ola) => { total += ola.length; });
  }

  return {
    nombre: t.nombre, dia: cfg.dia, inicio: cfg.inicio, singles: cfg.singles === true,
    rondas, llave, jugados, total, terminado: t.fase === 'terminado',
  };
}

// Greedy de canchas: mismo criterio que el plan impreso — cada partido toma la
// cancha que antes se libere; una ronda de un grupo no arranca sin cerrar la anterior.
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
          filas.push({ dia, ini: Math.max(OPC_INICIO, ancla.SAB), cancha: 'TODAS', categoria: 'ONE POINT CHALLENGE', fase: 'Punto único', partido: 'Eliminación directa — todos los anotados' });
          for (let i = 0; i < canchas.length; i++) canchas[i] = Math.max(canchas[i], OPC_FIN);
        }
      }
      const durG = cat.singles ? DUR.grupoSingles : DUR.grupoDobles;
      const durL = cat.singles ? DUR.llaveSingles : DUR.llaveDobles;
      const disp = cat.rondas.map(() => Math.max(cat.inicio, Math.min(...canchas)));
      const maxRondas = Math.max(0, ...cat.rondas.map((g) => g.length));
      for (let r = 0; r < maxRondas; r++) {
        cat.rondas.forEach((grupo, gi) => {
          if (r >= grupo.length) return;
          let finRonda = disp[gi];
          for (const p of grupo[r]) {
            const ci = canchas.indexOf(Math.min(...canchas));
            const ini = Math.max(disp[gi], canchas[ci], cat.inicio);
            canchas[ci] = ini + durG;
            finRonda = Math.max(finRonda, ini + durG);
            filas.push({ dia, ini, cancha: CANCHAS[ci], categoria: cat.nombre, fase: p.fase, partido: p.etiqueta });
          }
          disp[gi] = finRonda;
        });
      }
      let listo = Math.max(cat.inicio, ...disp);
      for (const ola of cat.llave) {
        let finOla = listo;
        for (const p of ola) {
          const d = p.fase === 'FINAL' ? durL + 5 : durL;
          const ci = canchas.indexOf(Math.min(...canchas));
          const ini = Math.max(listo, canchas[ci]);
          canchas[ci] = ini + d;
          finOla = Math.max(finOla, ini + d);
          filas.push({ dia, ini, cancha: CANCHAS[ci], categoria: cat.nombre, fase: p.fase, partido: p.etiqueta });
        }
        listo = finOla;
      }
    }
  }
  return filas.sort((a, b) => a.ini - b.ini || a.cancha.localeCompare(b.cancha));
}

type Estado = 'cargando' | 'ok' | 'error';

export default function ProgramacionPage() {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [mensajeError, setMensajeError] = useState('');
  const [torneos, setTorneos] = useState<Torneo[]>([]);
  const [actualizado, setActualizado] = useState<Date | null>(null);
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

  const delDia = filas.filter((f) => f.dia === dia && (!filtro || f.categoria === filtro));
  const catsDelDia = cats.filter((c) => c.dia === dia).sort((a, b) => a.inicio - b.inicio);

  return (
    <div className="rk">
      <main className="contenedor">
        <header className="cabecera">
          <h1><span className="marca">PROGRAMACIÓN</span> RACKET ROLL</h1>
          <div className="acciones">
            <Link className="boton secundario" to="/torneos">Resultados</Link>
            <button className="boton secundario" onClick={() => void cargar(false)}>Actualizar</button>
          </div>
        </header>

        <p style={{ opacity: 0.75, margin: '0 0 12px' }}>
          Horarios <strong>estimados</strong>: se recalculan solos a medida que se cargan resultados
          {actualizado ? ` · actualizado ${actualizado.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {(['SAB', 'DOM'] as Dia[]).map((d) => (
            <button key={d} className={`boton ${dia === d ? '' : 'secundario'}`} onClick={() => setDia(d)}>
              {NOMBRE_DIA[d]}
            </button>
          ))}
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ marginLeft: 'auto' }}>
            <option value="">Todas las categorías</option>
            {catsDelDia.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre.replace(' RACKET ROLL', '')}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, fontSize: '0.85rem', opacity: 0.85 }}>
          {catsDelDia.map((c) => (
            <span key={c.nombre}>
              {c.nombre.replace(' RACKET ROLL', '')}: {c.terminado ? '✅' : `${c.jugados}/${c.total}`}
            </span>
          ))}
        </div>

        {delDia.length === 0 ? (
          <p className="vacio">No queda nada pendiente para este día. 🎉</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.92rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--borde)' }}>
                  <th style={{ padding: '6px 8px' }}>Hora</th>
                  <th style={{ padding: '6px 8px' }}>Cancha</th>
                  <th style={{ padding: '6px 8px' }}>Categoría</th>
                  <th style={{ padding: '6px 8px' }}>Fase</th>
                  <th style={{ padding: '6px 8px' }}>Partido</th>
                </tr>
              </thead>
              <tbody>
                {delDia.map((f, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--borde)', fontWeight: f.fase === 'FINAL' ? 700 : 400 }}>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', fontWeight: 700 }}>{aHora(f.ini)}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{f.cancha}</td>
                    <td style={{ padding: '6px 8px' }}>{f.categoria.replace(' RACKET ROLL', '')}</td>
                    <td style={{ padding: '6px 8px' }}>{f.fase}</td>
                    <td style={{ padding: '6px 8px' }}>{f.partido}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
