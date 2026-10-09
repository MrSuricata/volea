// Modo TV de En vivo (/programacion?tv): pantalla completa para una tele del club, sin menú
// de la web ni controles, con letra que escala con el tamaño de la pantalla (vw/vh) para
// leerse a varios metros. Muestra las canchas, los próximos partidos, los últimos
// resultados y los campeones. Los datos los calcula ProgramacionPage; acá solo se pintan.
import { useEffect, useState, type CSSProperties } from 'react';
import { SupabaseService } from '../../services/supabaseService';
import { formatPrice } from '../../lib/formato';
import type { Product } from '../../types';
import { aHora } from './programa';

export type CanchaTv = { cancha: string; cat: string | null; a: string | null; b: string | null; minutos: number | null; sigue: { cat: string; a: string; b: string } | null };
export type ProximoTv = { ini: number; cancha: string; categoria: string; fase: string; a: string; b: string; bloque?: boolean };
export type ResultadoTv = { cat: string; fase: string; a: string; b: string; pa: number; pb: number; wo?: boolean };

type Props = {
  titulo: string;
  colores: string[];
  canchas: CanchaTv[];
  proximos: ProximoTv[];
  resultados: ResultadoTv[];
  campeones: { corto: string; campeon: string }[];
  termina: number | null;
  ahora: Date;
};

const LIMA = '#CCFF00';
const NAVY = '#001328';
const CARTA = 'rgba(0, 31, 63, 0.92)';
const BORDE = 'rgba(255,255,255,0.12)';

const rotulo: CSSProperties = { fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: '0.78em', color: LIMA };
const chip: CSSProperties = {
  display: 'inline-block', padding: '0.12em 0.55em', borderRadius: 999, border: `1px solid ${BORDE}`,
  fontWeight: 800, fontSize: '0.62em', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
};

// Publicidad VOLEA: lo que hay en stock de la tienda, destacados primero (se relee cada 10 min).
function useVidriera(): Product[] {
  const [lista, setLista] = useState<Product[]>([]);
  useEffect(() => {
    let vivo = true;
    const leer = () => void SupabaseService.getProducts().then((ps) => {
      if (!vivo || !ps) return;
      const conStock = ps.filter((p) => p.active !== false && p.images[0] && Object.values(p.stockBySize ?? {}).reduce((s, n) => s + (Number(n) || 0), 0) > 0);
      setLista([...conStock.filter((p) => p.isFeatured), ...conStock.filter((p) => !p.isFeatured)].slice(0, 16));
    });
    leer();
    const t = window.setInterval(leer, 10 * 60 * 1000);
    return () => { vivo = false; window.clearInterval(t); };
  }, []);
  return lista;
}

function Vidriera({ productos }: { productos: Product[] }) {
  if (productos.length === 0) return null;
  return (
    <section style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'stretch', background: '#fff', borderRadius: '0.6em', overflow: 'hidden', border: `2px solid ${LIMA}` }}>
      <div style={{ background: LIMA, color: NAVY, padding: '0.35em 0.9em', display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.05 }}>
        <span style={{ fontWeight: 900, fontSize: '1.15em', letterSpacing: '0.02em' }}>VESTÍ VOLEA</span>
        <span style={{ fontWeight: 700, fontSize: '0.55em', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ropa de pickleball · hecha en Uruguay</span>
        <span style={{ fontWeight: 900, fontSize: '0.7em', marginTop: '0.15em' }}>@volea.uy</span>
      </div>
      <div style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', width: 'max-content', whiteSpace: 'nowrap', animation: `rk-marquee ${Math.max(40, productos.length * 7)}s linear infinite`, willChange: 'transform' }}>
          {[...productos, ...productos].map((p, i) => (
            <div key={i} style={{ display: 'flex', flexShrink: 0, alignItems: 'center', gap: '0.5em', padding: '0.25em 1.2em 0.25em 0.4em', color: NAVY }}>
              <img src={p.images[0]} alt="" loading="eager" style={{ height: '3.4em', width: '3.4em', objectFit: 'contain', borderRadius: '0.3em', background: '#f2f4f7' }} />
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                <span style={{ fontWeight: 800, fontSize: '0.72em', textTransform: 'uppercase' }}>{p.name}</span>
                <span style={{ fontWeight: 900, fontSize: '0.95em' }}>{formatPrice(p.price)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function PantallaTv({ titulo, colores, canchas, proximos, resultados, campeones, termina, ahora }: Props) {
  const [c1, c2, c3] = colores;
  const vidriera = useVidriera();
  const hora = ahora.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: NAVY, color: '#fff', overflow: 'hidden', cursor: 'none',
      // Letra base: 1,5% del ancho, sin pasar el 2,7% del alto. En 1920×1080 ≈ 29px.
      fontSize: 'min(1.5vw, 2.7vh)', fontFamily: 'Lexend, Montserrat, system-ui, sans-serif',
      display: 'grid', gridTemplateRows: 'auto auto 1fr auto', gap: '0.7em', padding: '0.9em 1.2em 1em',
    }}>
      <div aria-hidden style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: [
          `radial-gradient(40vw 30vw at 90% -10%, ${c1}29, transparent 70%)`,
          `radial-gradient(45vw 35vw at -10% 40%, ${c2}1f, transparent 70%)`,
          `radial-gradient(40vw 40vw at 70% 115%, ${c3}17, transparent 70%)`,
        ].join(', '),
      }} />

      {/* Cabecera */}
      <header style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.8em' }}>
        <img src="/logo-white.png" alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          style={{ height: '1.6em' }} />
        <h1 style={{ margin: 0, fontSize: '1.45em', fontWeight: 900, letterSpacing: '0.02em', textTransform: 'uppercase', lineHeight: 1.05 }}>
          <span style={{ color: LIMA }}>EN VIVO</span> {titulo}
        </h1>
        <div style={{ marginLeft: 'auto', textAlign: 'right', lineHeight: 1.1 }}>
          <div style={{ fontSize: '1.6em', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{hora}</div>
          {termina !== null && <div style={{ fontSize: '0.62em', opacity: 0.75 }}>termina cerca de las {aHora(termina)}</div>}
        </div>
      </header>
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '0.22em', background: `linear-gradient(90deg, ${c1}, ${c2} 55%, ${c3})` }} />

      {/* Canchas */}
      <section style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, canchas.length)}, 1fr)`, gap: '0.7em' }}>
        {canchas.map((c) => (
          <div key={c.cancha} style={{
            background: CARTA, borderRadius: '0.6em', padding: '0.6em 0.8em',
            border: `2px solid ${c.a ? LIMA : BORDE}`, boxShadow: c.a ? `0 0 1.2em ${LIMA}33` : 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6em' }}>
              <span style={{ background: c.a ? LIMA : 'rgba(255,255,255,0.15)', color: c.a ? NAVY : '#fff', fontWeight: 900, padding: '0.1em 0.6em', borderRadius: 999, fontSize: '0.85em', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {c.a ? '▶ ' : ''}{c.cancha}
              </span>
              {c.cat && <span style={{ ...rotulo, color: '#fff', opacity: 0.8 }}>{c.cat}</span>}
              {c.minutos !== null && <span style={{ marginLeft: 'auto', color: LIMA, fontWeight: 900, fontSize: '1.05em', fontVariantNumeric: 'tabular-nums' }}>⏱ {c.minutos}′</span>}
            </div>
            {c.a ? (
              <div style={{ marginTop: '0.35em', fontWeight: 900, fontSize: '1.3em', lineHeight: 1.15, textTransform: 'uppercase' }}>
                <div>{c.a}</div>
                <div style={{ color: LIMA, fontSize: '0.6em', fontWeight: 800, margin: '0.1em 0' }}>VS</div>
                <div>{c.b}</div>
              </div>
            ) : (
              <div style={{ marginTop: '0.35em' }}>
                <div style={{ fontSize: '1.1em', fontWeight: 800, opacity: 0.7 }}>Libre</div>
                {c.sigue && (
                  <div style={{ marginTop: '0.25em', fontSize: '0.8em', lineHeight: 1.25 }}>
                    <span style={{ ...rotulo, fontSize: '0.75em' }}>Sigue · {c.sigue.cat}</span>
                    <div style={{ fontWeight: 800, textTransform: 'uppercase' }}>{c.sigue.a} <span style={{ color: LIMA }}>vs</span> {c.sigue.b}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Próximos | Resultados */}
      <section style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1.45fr 1fr', gap: '0.9em', minHeight: 0 }}>
        <div style={{ minHeight: 0, overflow: 'hidden' }}>
          <h2 style={{ ...rotulo, margin: '0 0 0.35em', fontSize: '0.85em' }}>Próximos partidos</h2>
          {proximos.length === 0 && <div style={{ opacity: 0.7 }}>No quedan partidos por jugar hoy.</div>}
          <div style={{ display: 'grid', gap: '0.35em' }}>
            {proximos.map((p, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '3.3em 1fr', alignItems: 'center', gap: '0.5em', background: CARTA, border: `1px solid ${BORDE}`, borderRadius: '0.45em', padding: '0.3em 0.6em' }}>
                <span style={{ color: LIMA, fontWeight: 900, fontSize: '1.05em', fontVariantNumeric: 'tabular-nums' }}>{aHora(p.ini)}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '0.4em', alignItems: 'center', flexWrap: 'wrap' }}>
                    {!p.bloque && <span style={chip}>{p.cancha}</span>}
                    <span style={chip}>{p.categoria}</span>
                    {p.fase && <span style={{ fontSize: '0.62em', fontWeight: 800, opacity: 0.65, textTransform: 'uppercase' }}>{p.fase}</span>}
                  </div>
                  <div style={{ fontWeight: 800, fontSize: '0.9em', textTransform: 'uppercase', lineHeight: 1.2, marginTop: '0.1em' }}>
                    {p.a}{p.b && <> <span style={{ color: LIMA, fontWeight: 600 }}>vs</span> {p.b}</>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '0.6em' }}>
          {campeones.length > 0 && (
            <div style={{ background: CARTA, border: `2px solid ${LIMA}`, borderRadius: '0.5em', padding: '0.45em 0.7em' }}>
              <h2 style={{ ...rotulo, margin: '0 0 0.2em', fontSize: '0.85em' }}>🏆 Campeones</h2>
              {campeones.slice(0, 4).map((c) => (
                <div key={c.corto} style={{ fontSize: '0.78em', lineHeight: 1.3 }}>
                  <span style={{ opacity: 0.75, fontWeight: 700 }}>{c.corto}:</span> <b style={{ textTransform: 'uppercase' }}>{c.campeon}</b>
                </div>
              ))}
            </div>
          )}
          <div style={{ minHeight: 0 }}>
            <h2 style={{ ...rotulo, margin: '0 0 0.35em', fontSize: '0.85em' }}>Últimos resultados</h2>
            {resultados.length === 0 && <div style={{ opacity: 0.7, fontSize: '0.85em' }}>Todavía no hay resultados.</div>}
            <div style={{ display: 'grid', gap: '0.3em' }}>
              {resultados.map((r, i) => {
                const ganaA = r.pa > r.pb;
                const lado = (nombre: string, gana: boolean, puntos: number) => (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5em', fontWeight: gana ? 900 : 500, opacity: gana ? 1 : 0.8 }}>
                    <span style={{ textTransform: 'uppercase', minWidth: 0 }}>{nombre}</span>
                    <span style={{ color: gana ? LIMA : '#fff', fontVariantNumeric: 'tabular-nums' }}>{puntos}</span>
                  </div>
                );
                return (
                  <div key={i} style={{ background: CARTA, border: `1px solid ${BORDE}`, borderRadius: '0.45em', padding: '0.3em 0.6em', fontSize: '0.8em', lineHeight: 1.2 }}>
                    <div style={{ fontSize: '0.72em', fontWeight: 800, opacity: 0.65, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {r.cat} · {r.fase}{r.wo ? ' · W.O.' : ''}
                    </div>
                    {lado(r.a, ganaA, r.pa)}
                    {lado(r.b, !ganaA, r.pb)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <Vidriera productos={vidriera} />
    </div>
  );
}
