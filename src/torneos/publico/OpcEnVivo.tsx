// One Point Challenge en En vivo: la pantalla gigante (/programacion?tv) y el tablero de
// /programacion, donde cada árbitro carga su cancha con UN toque sobre el que ganó el punto.
// Qué cruce va en qué cancha lo decide ./opcCanchas (planOpc); acá solo se pinta y se toca.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { almacenLocal } from '../../utils/almacen';
import type { ConfigTv } from './programa';
import { Cartel, TiraSponsors, Vidriera, useCartel, useVidriera } from './PantallaTv';
import { marcarOpcEnServidor, type CanchaOpc, type PartidoOpc, type PlanOpc } from './opcCanchas';

const LIMA = '#CCFF00';
const NAVY = '#001328';
const CARTA = 'rgba(0, 31, 63, 0.92)';
const BORDE = 'rgba(255,255,255,0.12)';
const rotulo: CSSProperties = { fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: '0.78em', color: LIMA };

const perdedor = (p: PartidoOpc) => (p.ganador === 'a' ? p.b : p.a);
const ganador = (p: PartidoOpc) => (p.ganador === 'a' ? p.a : p.b);

// ─── Pantalla gigante ────────────────────────────────────────────────────────

export function PantallaOpcTv({ plan, colores, ahora, tv }: { plan: PlanOpc; colores: string[]; ahora: Date; tv?: ConfigTv }) {
  const [c1, c2, c3] = colores;
  const vidriera = useVidriera();
  const sponsors = tv?.sponsors ?? [];
  const { anuncio, cerrar } = useCartel(tv);
  const [tiraSponsors, setTiraSponsors] = useState(false);
  useEffect(() => {
    if (sponsors.length === 0) return;
    const t = window.setInterval(() => setTiraSponsors((v) => !v), 30 * 1000);
    return () => window.clearInterval(t);
  }, [sponsors.length]);
  const hora = ahora.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false });
  const n = plan.canchas.length;
  // Con una sola cancha (semis y final) el cruce ocupa toda la pantalla: letra más grande.
  const escala = n <= 1 ? 1.75 : n === 2 ? 1.25 : 1;
  const colaMax = n <= 1 ? 6 : 5;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: NAVY, color: '#fff', overflow: 'hidden', cursor: 'none',
      fontSize: 'min(1.5vw, 2.7vh)', fontFamily: 'Lexend, Montserrat, system-ui, sans-serif',
      display: 'grid', gridTemplateRows: 'auto 1fr auto auto', gap: '0.7em', padding: '0.9em 1.2em 1em',
    }}>
      <div aria-hidden style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: [
          `radial-gradient(40vw 30vw at 90% -10%, ${c1}29, transparent 70%)`,
          `radial-gradient(45vw 35vw at -10% 40%, ${c2}1f, transparent 70%)`,
          `radial-gradient(40vw 40vw at 70% 115%, ${c3}17, transparent 70%)`,
        ].join(', '),
      }} />
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '0.22em', background: `linear-gradient(90deg, ${c1}, ${c2} 55%, ${c3})` }} />

      <header style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.8em' }}>
        <img src="/logo-white.png" alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} style={{ height: '1.6em' }} />
        <div style={{ lineHeight: 1.05 }}>
          <h1 style={{ margin: 0, fontSize: '1.45em', fontWeight: 900, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
            <span style={{ color: LIMA }}>EN VIVO</span> {plan.nombre}
          </h1>
          <div style={{ fontSize: '0.8em', fontWeight: 700, opacity: 0.85, marginTop: '0.2em', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Un punto · el que lo gana sigue, el que lo pierde queda afuera
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1em' }}>
          {plan.ronda && !plan.campeon && (
            <div style={{ textAlign: 'right', lineHeight: 1.15 }}>
              <div style={{ color: LIMA, fontWeight: 900, fontSize: '1.2em', textTransform: 'uppercase' }}>{plan.ronda.nombre}</div>
              <div style={{ fontSize: '0.72em', fontWeight: 700, opacity: 0.85 }}>
                {plan.ronda.jugados} de {plan.ronda.total} cruces · quedan {plan.vivos} en carrera
              </div>
            </div>
          )}
          <div style={{ fontSize: '1.6em', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{hora}</div>
        </div>
      </header>

      {plan.campeon ? (
        <section style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: CARTA, border: `3px solid ${LIMA}`, borderRadius: '0.8em', boxShadow: `0 0 2em ${LIMA}44`, padding: '1em' }}>
          <div style={{ fontSize: '4em', lineHeight: 1 }}>🏆</div>
          <div style={{ ...rotulo, fontSize: '1.3em', marginTop: '0.4em' }}>Campeón del One Point Challenge</div>
          <div style={{ fontSize: '4.2em', fontWeight: 900, textTransform: 'uppercase', lineHeight: 1.05, marginTop: '0.15em' }}>{plan.campeon}</div>
          {plan.subcampeon && (
            <div style={{ fontSize: '1.4em', fontWeight: 700, opacity: 0.85, marginTop: '0.6em', textTransform: 'uppercase' }}>
              Subcampeón: <b>{plan.subcampeon}</b>
            </div>
          )}
        </section>
      ) : (
        <section style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, n)}, 1fr)`, gap: '0.7em', minHeight: 0 }}>
          {plan.canchas.map((c) => <CanchaTv key={c.numero} c={c} escala={escala} colaMax={colaMax} unica={n <= 1} />)}
          {n === 0 && <div style={{ opacity: 0.7, fontSize: '1.4em', alignSelf: 'center', textAlign: 'center' }}>Todavía no hay cruces para jugar.</div>}
        </section>
      )}

      <section style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.6em', overflow: 'hidden', minHeight: '2.1em' }}>
        {plan.resultados.length > 0 ? (
          <>
            <span style={{ ...rotulo, whiteSpace: 'nowrap' }}>Últimos puntos</span>
            {plan.resultados.slice(0, 3).map((p) => (
              <span key={p.id} style={{ background: CARTA, border: `1px solid ${BORDE}`, borderRadius: '0.45em', padding: '0.25em 0.6em', fontSize: '0.74em', whiteSpace: 'nowrap', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <b style={{ color: LIMA }}>✔ {ganador(p)}</b>
                <span style={{ opacity: 0.55 }}> {p.wo ? 'pasó por W.O. ante' : 'le ganó a'} </span>
                <span style={{ opacity: 0.7, textDecoration: 'line-through' }}>{perdedor(p)}</span>
              </span>
            ))}
          </>
        ) : plan.pasanDirecto.length > 0 ? (
          <div style={{ fontSize: '0.74em', lineHeight: 1.3, textTransform: 'uppercase', maxHeight: '2.7em', overflow: 'hidden' }}>
            <span style={{ ...rotulo, fontSize: '1em' }}>Pasan directo a la 2ª ronda: </span>
            <span style={{ opacity: 0.85, fontWeight: 600 }}>{plan.pasanDirecto.join(' · ')}</span>
          </div>
        ) : null}
      </section>

      {tiraSponsors && sponsors.length > 0 ? <TiraSponsors sponsors={sponsors} /> : <Vidriera productos={vidriera} />}
      {anuncio && <Cartel anuncio={anuncio} sponsors={sponsors} colores={colores} cerrar={cerrar} />}
    </div>
  );
}

function CanchaTv({ c, escala, colaMax, unica }: { c: CanchaOpc; escala: number; colaMax: number; unica: boolean }) {
  const p = c.ahora;
  // Los cruces que todavía no tienen ningún nombre no dicen nada en la tele.
  const conNombre = c.siguen.filter((s) => !(s.a === 'A definir' && s.b === 'A definir'));
  const cola = conNombre.slice(0, colaMax);
  return (
    <div style={{
      background: CARTA, borderRadius: '0.6em', padding: '0.6em 0.8em', minHeight: 0, overflow: 'hidden',
      border: `2px solid ${p ? LIMA : BORDE}`, boxShadow: p ? `0 0 1.2em ${LIMA}33` : 'none',
      display: 'flex', flexDirection: 'column', fontSize: `${escala}em`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6em' }}>
        <span style={{ background: p ? LIMA : 'rgba(255,255,255,0.15)', color: p ? NAVY : '#fff', fontWeight: 900, padding: '0.1em 0.6em', borderRadius: 999, fontSize: '1.05em', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          {p ? '▶ ' : ''}{c.nombre}
        </span>
        {p && <span style={{ ...rotulo, color: '#fff', opacity: 0.8, fontSize: '0.7em' }}>{p.nombreRonda} · {p.numero}/{p.deRonda}</span>}
      </div>
      {p ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', margin: '0.3em 0', fontWeight: 900, fontSize: '2.1em', lineHeight: 1.08, textTransform: 'uppercase', textAlign: 'center', overflowWrap: 'anywhere' }}>
          <div>{p.a}</div>
          <div style={{ color: LIMA, fontSize: '0.5em', fontWeight: 800, margin: '0.35em 0' }}>VS</div>
          <div>{p.b}</div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2em', fontWeight: 800, opacity: 0.7 }}>Esperando el cruce anterior…</div>
      )}
      {cola.length > 0 && (
        <div style={{ borderTop: `1px solid ${BORDE}`, paddingTop: '0.35em', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ ...rotulo, fontSize: '0.68em', marginBottom: '0.2em' }}>Siguen en esta cancha{conNombre.length > cola.length ? ` (+${conNombre.length - cola.length} más)` : ''}</div>
          <div style={{ display: 'grid', gridTemplateColumns: unica ? '1fr 1fr' : '1fr', gap: '0.12em 1.2em' }}>
            {cola.map((s, i) => (
              <div key={s.id} style={{ fontSize: '0.74em', fontWeight: i === 0 ? 800 : 600, lineHeight: 1.3, textTransform: 'uppercase', opacity: s.estado === 'listo' ? (i === 0 ? 1 : 0.85) : 0.55, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ color: LIMA, fontWeight: 900 }}>{i + 1}.</span> {s.a} <span style={{ color: LIMA }}>vs</span> {s.b}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tablero de /programacion (público y carga de los árbitros) ──────────────

const CLAVE_CANCHA = 'volea_opc_mi_cancha';

export function SeccionOpc({ plan, modoCarga, onCambio }: { plan: PlanOpc; modoCarga: boolean; onCambio: () => void }) {
  const [miCancha, setMiCanchaEstado] = useState<number | null>(() => {
    const v = Number(almacenLocal.leer(CLAVE_CANCHA));
    return Number.isInteger(v) && v > 0 ? v : null;
  });
  const setMiCancha = (v: number | null) => { setMiCanchaEstado(v); almacenLocal.guardar(CLAVE_CANCHA, v ? String(v) : ''); };
  // Después de un toque no se acepta otro por un rato: en el mismo lugar aparece el cruce
  // siguiente y un doble toque lo marcaría sin querer.
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  async function tocar(p: PartidoOpc, lado: 'a' | 'b' | null, wo = false) {
    if (ocupado) return;
    setOcupado(true);
    setError('');
    const problema = await marcarOpcEnServidor(plan.torneoId, p.id, lado, wo);
    if (problema) setError(problema);
    onCambio();
    timer.current = window.setTimeout(() => { timer.current = null; setOcupado(false); }, problema ? 0 : 900);
  }

  const visibles = modoCarga && miCancha && plan.canchas.some((c) => c.numero === miCancha)
    ? plan.canchas.filter((c) => c.numero === miCancha)
    : plan.canchas;
  const chip = (activo: boolean): CSSProperties => ({ padding: '5px 12px', fontSize: '0.82rem', opacity: activo ? 1 : 0.9 });
  return (
    <section style={{ background: 'var(--navy-1)', border: '1px solid var(--lima)', borderRadius: 14, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          <span style={{ color: 'var(--lima)' }}>⚡</span> {plan.nombre}
        </h2>
        {plan.ronda && !plan.campeon && (
          <span style={{ fontSize: '0.85rem', opacity: 0.8, fontWeight: 700 }}>
            {plan.ronda.nombre} · {plan.ronda.jugados} de {plan.ronda.total} cruces · quedan {plan.vivos} en carrera
          </span>
        )}
      </div>

      {plan.campeon && (
        <div style={{ textAlign: 'center', padding: '14px 8px' }}>
          <div style={{ fontSize: '2rem' }}>🏆</div>
          <div style={{ color: 'var(--lima)', fontWeight: 900, letterSpacing: '0.1em', fontSize: '0.8rem', textTransform: 'uppercase' }}>Campeón</div>
          <div style={{ fontSize: '1.7rem', fontWeight: 900, textTransform: 'uppercase' }}>{plan.campeon}</div>
          {plan.subcampeon && <div style={{ opacity: 0.8, marginTop: 4 }}>Subcampeón: <b>{plan.subcampeon}</b></div>}
        </div>
      )}

      {modoCarga && plan.canchas.length > 1 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: '0.8rem', opacity: 0.75, fontWeight: 700 }}>Arbitro la:</span>
          {plan.canchas.map((c) => (
            <button key={c.numero} className={`boton ${miCancha === c.numero ? '' : 'secundario'}`} style={chip(miCancha === c.numero)} onClick={() => setMiCancha(c.numero)}>{c.nombre}</button>
          ))}
          <button className={`boton ${miCancha === null ? '' : 'secundario'}`} style={chip(miCancha === null)} onClick={() => setMiCancha(null)}>Todas</button>
        </div>
      )}
      {error && <div role="alert" style={{ color: '#ff8fa8', fontWeight: 700, marginBottom: 10 }}>{error}</div>}

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(auto-fit, minmax(${modoCarga ? 280 : 240}px, 1fr))` }}>
        {visibles.map((c) => (
          <CanchaTablero key={c.numero} c={c} modoCarga={modoCarga} ocupado={ocupado} onTocar={(p, lado, wo) => void tocar(p, lado, wo)} />
        ))}
      </div>

      {plan.resultados.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: '0.75rem', opacity: 0.65, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Últimos puntos</div>
          <div style={{ display: 'grid', gap: 4 }}>
            {plan.resultados.slice(0, 6).map((p) => (
              <div key={p.id} style={{ fontSize: '0.9rem', textTransform: 'uppercase' }}>
                <b style={{ color: 'var(--lima)' }}>✔ {ganador(p)}</b>
                <span style={{ opacity: 0.55, textTransform: 'none' }}> {p.wo ? 'pasó por W.O. ante' : 'le ganó a'} </span>
                <span style={{ opacity: 0.7, textDecoration: 'line-through' }}>{perdedor(p)}</span>
                <span style={{ opacity: 0.45, fontSize: '0.75rem' }}> · {p.nombreRonda}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {plan.jugados === 0 && plan.pasanDirecto.length > 0 && (
        <p style={{ margin: '12px 0 0', fontSize: '0.85rem', opacity: 0.8 }}>
          <b>Pasan directo a la 2ª ronda:</b> {plan.pasanDirecto.join(' · ')}
        </p>
      )}
    </section>
  );
}

function CanchaTablero({ c, modoCarga, ocupado, onTocar }: {
  c: CanchaOpc;
  modoCarga: boolean;
  ocupado: boolean;
  onTocar: (p: PartidoOpc, lado: 'a' | 'b' | null, wo?: boolean) => void;
}) {
  const p = c.ahora;
  const botonJugador: CSSProperties = {
    width: '100%', padding: '18px 12px', fontSize: '1.25rem', fontWeight: 900, textTransform: 'uppercase', lineHeight: 1.15,
    borderRadius: 12, border: '2px solid var(--lima)', background: 'rgba(204,255,0,0.1)', color: '#fff', cursor: 'pointer',
    opacity: ocupado ? 0.45 : 1,
  };
  const enlace: CSSProperties = { background: 'none', border: 'none', color: '#fff', opacity: 0.7, textDecoration: 'underline', cursor: 'pointer', fontSize: '0.78rem', padding: '4px 0' };
  return (
    <div style={{ border: `1px solid ${p ? 'var(--lima)' : 'var(--borde)'}`, borderRadius: 12, padding: '12px 14px', background: 'rgba(0,0,0,0.18)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--lima)', textTransform: 'uppercase' }}>{p ? '▶ ' : ''}{c.nombre}</span>
        {p && <span style={{ fontSize: '0.75rem', opacity: 0.7, fontWeight: 700, textTransform: 'uppercase' }}>{p.nombreRonda} · {p.numero}/{p.deRonda}</span>}
      </div>
      {p ? (
        modoCarga ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: '0.78rem', opacity: 0.75, fontWeight: 700 }}>Tocá al que GANÓ el punto:</div>
            <button type="button" style={botonJugador} disabled={ocupado} onClick={() => onTocar(p, 'a')}>{p.a}</button>
            <button type="button" style={botonJugador} disabled={ocupado} onClick={() => onTocar(p, 'b')}>{p.b}</button>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <button type="button" style={enlace} disabled={ocupado}
                onClick={() => { if (window.confirm(`¿${p.a} no se presentó? Pasa ${p.b} por W.O.`)) onTocar(p, 'b', true); }}>No vino: {p.a}</button>
              <button type="button" style={enlace} disabled={ocupado}
                onClick={() => { if (window.confirm(`¿${p.b} no se presentó? Pasa ${p.a} por W.O.`)) onTocar(p, 'a', true); }}>No vino: {p.b}</button>
            </div>
          </div>
        ) : (
          <div style={{ fontWeight: 900, fontSize: '1.2rem', textTransform: 'uppercase', lineHeight: 1.25 }}>
            <div>{p.a}</div>
            <div style={{ color: 'var(--lima)', fontSize: '0.75rem' }}>VS</div>
            <div>{p.b}</div>
          </div>
        )
      ) : (
        <div style={{ opacity: 0.6, fontWeight: 600 }}>Esperando el cruce anterior…</div>
      )}
      {modoCarga && c.ultimo && (
        <button type="button" style={{ ...enlace, marginTop: 8, display: 'block', textAlign: 'left' }} disabled={ocupado}
          onClick={() => { if (window.confirm(`¿Deshacer «${ganador(c.ultimo!)} le ganó a ${perdedor(c.ultimo!)}»? El cruce vuelve a jugarse.`)) onTocar(c.ultimo!, null); }}>
          ↩ Deshacer: {ganador(c.ultimo)} le ganó a {perdedor(c.ultimo)}
        </button>
      )}
      {c.siguen.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--borde)', paddingTop: 8 }}>
          <div style={{ fontSize: '0.7rem', opacity: 0.6, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Siguen en esta cancha ({c.siguen.length})
          </div>
          {c.siguen.slice(0, modoCarga ? 3 : 6).map((s, i) => (
            <div key={s.id} style={{ fontSize: '0.84rem', lineHeight: 1.4, textTransform: 'uppercase', opacity: s.estado === 'listo' ? 0.95 : 0.55 }}>
              <span style={{ color: 'var(--lima)', fontWeight: 800 }}>{i + 1}.</span> {s.a} <span style={{ color: 'var(--lima)' }}>vs</span> {s.b}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
