// "Pantalla TV" en En vivo (modo carga): qué publicidad pasa la tele y cada cuánto, sin SQL.
// Guarda en rk_programa.config.tv (lo mismo que lee PantallaTv).
import { useState, type CSSProperties } from 'react';
import type { AnuncioTv, ConfigTv, SponsorTv } from './programa';
import { SupabaseService } from '../../services/supabaseService';

const caja: CSSProperties = { border: '1px solid var(--borde)', borderRadius: 14, background: 'var(--navy-1)', padding: '12px 14px', marginBottom: 14 };
const etiqueta: CSSProperties = { fontSize: '0.78rem', opacity: 0.7, fontWeight: 700 };
const fila: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
const chico: CSSProperties = { padding: '4px 10px', fontSize: '0.8rem', lineHeight: 1.2 };
const MAX_MB = 50;

function describir(a: AnuncioTv): string {
  if (a.tipo === 'gracias') return 'Cartel "Gracias" con los sponsors';
  const nombre = decodeURIComponent(a.src.split('/').pop() ?? a.src).replace(/^\d+-[a-z0-9]+\./, '.');
  return `${a.tipo === 'video' ? 'Video' : 'Imagen'} · ${nombre}`;
}

export default function PanelTv({ tv, onGuardar }: {
  tv: ConfigTv | undefined;
  onGuardar: (tv: ConfigTv) => Promise<string | null>;
}) {
  const [cada, setCada] = useState(String(tv?.cada ?? 8));
  const [segundos, setSegundos] = useState(String(tv?.segundos ?? 15));
  const [anuncios, setAnuncios] = useState<AnuncioTv[]>(tv?.anuncios ?? []);
  const [sponsors, setSponsors] = useState<SponsorTv[]>(tv?.sponsors ?? []);
  const [nuevoSponsor, setNuevoSponsor] = useState('');
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function subir(archivo: File | undefined, tipo: 'video' | 'imagen' | 'logo', indiceSponsor?: number) {
    if (!archivo) return;
    if (archivo.size > MAX_MB * 1024 * 1024) { setAviso(`El archivo pesa más de ${MAX_MB} MB: achicalo y volvé a probar.`); return; }
    setSubiendo(archivo.name);
    setAviso(null);
    const url = tipo === 'video' ? await SupabaseService.uploadArchivo(archivo, 'tv') : await SupabaseService.uploadImage(archivo, 'tv');
    setSubiendo(null);
    if (!url) { setAviso('No se pudo subir (¿sesión vencida o conexión?). Probá de nuevo.'); return; }
    if (tipo === 'logo' && indiceSponsor !== undefined) {
      setSponsors((s) => s.map((x, i) => (i === indiceSponsor ? { ...x, logo: url } : x)));
    } else if (tipo === 'video') {
      setAnuncios((a) => [...a, { tipo: 'video', src: url, segundos: 60 }]);
    } else {
      setAnuncios((a) => [...a, { tipo: 'imagen', src: url }]);
    }
  }

  function mover<T>(lista: T[], i: number, d: -1 | 1): T[] {
    const j = i + d;
    if (j < 0 || j >= lista.length) return lista;
    const copia = [...lista];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    return copia;
  }

  async function guardar() {
    const c = Math.max(0, Math.min(120, Math.trunc(Number(cada) || 0)));
    const s = Math.max(5, Math.min(120, Math.trunc(Number(segundos) || 15)));
    const problema = await onGuardar({ ...(tv ?? {}), cada: c, segundos: s, anuncios, sponsors });
    setAviso(problema ?? 'Guardado: la TV lo toma sola.');
  }

  return (
    <details style={caja}>
      <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Pantalla TV · publicidad</summary>
      <div style={{ display: 'grid', gap: 16, marginTop: 14 }}>
        <div style={fila}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={etiqueta}>Cada cuántos minutos (0 = nunca)</span>
            <input type="number" inputMode="numeric" min={0} max={120} value={cada} onChange={(e) => setCada(e.target.value)} style={{ width: 96 }} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={etiqueta}>Segundos que dura una imagen</span>
            <input type="number" inputMode="numeric" min={5} max={120} value={segundos} onChange={(e) => setSegundos(e.target.value)} style={{ width: 96 }} />
          </label>
          <a className="boton secundario" href="/programacion?tv&cartel" target="_blank" rel="noreferrer">Probar en otra pestaña</a>
        </div>

        <div>
          <div style={{ ...etiqueta, textTransform: 'uppercase', marginBottom: 8 }}>Carteles (rotan en este orden; un toque en la tele los saca)</div>
          {anuncios.length === 0 && <div style={{ opacity: 0.7, fontSize: '0.9rem', marginBottom: 8 }}>Sin carteles: sale el de "Gracias" con los sponsors.</div>}
          <div style={{ display: 'grid', gap: 6 }}>
            {anuncios.map((a, i) => (
              <div key={`${i}-${a.tipo}`} style={fila}>
                <button className="boton secundario" style={chico} disabled={i === 0} onClick={() => setAnuncios(mover(anuncios, i, -1))} aria-label="Subir">▲</button>
                <button className="boton secundario" style={chico} disabled={i === anuncios.length - 1} onClick={() => setAnuncios(mover(anuncios, i, 1))} aria-label="Bajar">▼</button>
                <span style={{ flex: '1 1 14rem', fontSize: '0.9rem' }}>{describir(a)}</span>
                {a.tipo !== 'gracias' && <a href={a.src} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: 'var(--lima)' }}>ver</a>}
                <button className="boton secundario" style={chico} onClick={() => setAnuncios(anuncios.filter((_, j) => j !== i))}>Quitar</button>
              </div>
            ))}
          </div>
          <div style={{ ...fila, marginTop: 10 }}>
            <label className="boton secundario" style={{ cursor: 'pointer' }}>
              Subir video (MP4)
              <input type="file" accept="video/mp4,video/webm" hidden onChange={(e) => { void subir(e.target.files?.[0], 'video'); e.target.value = ''; }} />
            </label>
            <label className="boton secundario" style={{ cursor: 'pointer' }}>
              Subir imagen
              <input type="file" accept="image/*" hidden onChange={(e) => { void subir(e.target.files?.[0], 'imagen'); e.target.value = ''; }} />
            </label>
            <button className="boton secundario" onClick={() => setAnuncios([...anuncios, { tipo: 'gracias' }])}>Agregar cartel "Gracias"</button>
          </div>
          <div style={{ ...etiqueta, marginTop: 6 }}>Video 1920×1080, menos de {MAX_MB} MB, sin sonido. Imagen 1920×1080.</div>
        </div>

        <div>
          <div style={{ ...etiqueta, textTransform: 'uppercase', marginBottom: 8 }}>Sponsors (cartel "Gracias" y tira de abajo)</div>
          {sponsors.length === 0 && <div style={{ opacity: 0.7, fontSize: '0.9rem', marginBottom: 8 }}>Sin sponsors: la tira de abajo muestra solo la ropa VOLEA.</div>}
          <div style={{ display: 'grid', gap: 6 }}>
            {sponsors.map((s, i) => (
              <div key={`${i}-${s.nombre}`} style={fila}>
                {s.logo ? <img src={s.logo} alt="" style={{ height: 28, width: 56, objectFit: 'contain', background: '#fff', borderRadius: 6 }} /> : null}
                <span style={{ flex: '1 1 10rem', fontSize: '0.9rem', fontWeight: 700 }}>{s.nombre}</span>
                <label className="boton secundario" style={{ ...chico, cursor: 'pointer' }}>
                  {s.logo ? 'Cambiar logo' : 'Subir logo'}
                  <input type="file" accept="image/*" hidden onChange={(e) => { void subir(e.target.files?.[0], 'logo', i); e.target.value = ''; }} />
                </label>
                <button className="boton secundario" style={chico} onClick={() => setSponsors(sponsors.filter((_, j) => j !== i))}>Quitar</button>
              </div>
            ))}
          </div>
          <form
            style={{ ...fila, marginTop: 10 }}
            onSubmit={(e) => { e.preventDefault(); const n = nuevoSponsor.trim(); if (n) { setSponsors([...sponsors, { nombre: n }]); setNuevoSponsor(''); } }}
          >
            <input type="text" value={nuevoSponsor} onChange={(e) => setNuevoSponsor(e.target.value)} placeholder="Nombre del sponsor" aria-label="Nombre del sponsor" style={{ flex: '1 1 12rem' }} />
            <button className="boton secundario" type="submit">Agregar sponsor</button>
          </form>
        </div>

        <div style={fila}>
          <button className="boton" onClick={() => void guardar()} disabled={!!subiendo}>{subiendo ? `Subiendo ${subiendo}…` : 'Guardar pantalla TV'}</button>
          {aviso && <span style={{ fontSize: '0.88rem' }}>{aviso}</span>}
        </div>
      </div>
    </details>
  );
}
