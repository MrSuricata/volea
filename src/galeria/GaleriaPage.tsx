import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ExternalLink, Images, Loader2 } from 'lucide-react';
import { listarAlbumes, type GalleryAlbum } from './datos';

type Estado = 'cargando' | 'ok' | 'error';

/** "2026-07-26" → "26 de julio de 2026", SIN líos de timezone: event_date es una
 * columna DATE (sin hora/zona), y new Date('2026-07-26') la interpreta como
 * medianoche UTC — en Uruguay (UTC-3) eso se muestra un día antes. Se arma la
 * fecha con el constructor local (año, mes, día) para que no haya corrimiento. */
function formatearFecha(fecha: string): string {
  const [y, m, d] = fecha.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return fecha;
  return new Date(y, m - 1, d).toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric' });
}

function PortadaFallback() {
  return (
    <div className="w-full h-48 bg-gradient-to-br from-navy-700 to-navy-900 flex items-center justify-center">
      <span className="font-display text-2xl font-bold tracking-[0.3em] text-lime-400">VOLEA</span>
    </div>
  );
}

function AlbumCard({ album }: { album: GalleryAlbum }) {
  // Las portadas vienen de Drive/Photos y esos links caducan o bloquean el hotlink:
  // si la imagen 404ea, mostrar la placa VOLEA en vez del ícono roto del navegador.
  const [rota, setRota] = useState(false);
  return (
    <a
      href={album.albumUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover-scale group flex flex-col"
    >
      {album.coverUrl && !rota ? (
        <div className="img-zoom h-48">
          <img
            src={album.coverUrl}
            alt={album.title}
            className="w-full h-48 object-cover"
            onError={() => setRota(true)}
          />
        </div>
      ) : (
        <PortadaFallback />
      )}
      <div className="p-5 flex flex-col flex-1">
        {album.eventDate && (
          <p className="text-xs text-gray-400 mb-2">{formatearFecha(album.eventDate)}</p>
        )}
        <h2 className="font-display text-lg font-bold text-navy-700 mb-2 group-hover:text-navy-500 transition-colors flex-1">
          {album.title}
        </h2>
        <span className="font-display text-sm font-semibold text-lime-600 group-hover:underline inline-flex items-center gap-1">
          Ver álbum <ExternalLink size={14} />
        </span>
      </div>
    </a>
  );
}

// Galería pública: álbumes de fotos de torneos. Cada tarjeta linkea a un Google
// Drive/Photos externo (las fotos viven ahí; esta página es solo el índice con
// marca VOLEA) — por eso no hay visor de fotos acá adentro, solo el link de salida.
// Carga propia (listarAlbumes, con techo de 8s + reintento) — a propósito NO pasa
// por StoreContext ni por el Promise.all de arranque de App.tsx.
export default function GaleriaPage() {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [mensajeError, setMensajeError] = useState('');
  const [albums, setAlbums] = useState<GalleryAlbum[]>([]);

  const cargar = useCallback(async () => {
    setEstado('cargando');
    const r = await listarAlbumes();
    if (r.error) {
      setMensajeError(r.error);
      setEstado('error');
      return;
    }
    setAlbums(r.albums);
    setEstado('ok');
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="fade-in max-w-7xl mx-auto px-4 py-12">
      <p className="font-display text-sm font-bold uppercase tracking-widest text-lime-600 mb-2">
        TORNEOS VOLEA
      </p>
      <h1 className="font-display text-3xl md:text-4xl font-bold text-navy-700">Galería</h1>
      <div className="w-16 h-1 bg-lime-400 mb-8" />
      <p className="text-gray-600 max-w-2xl -mt-4 mb-10">
        Las fotos de cada torneo viven en Google Drive o Google Photos — acá está el índice.
        Elegí un álbum para abrirlo en una pestaña nueva.
      </p>

      {estado === 'cargando' && (
        <div className="text-center py-20 text-gray-400">
          <Loader2 size={48} className="mx-auto mb-4 animate-spin" />
          <p className="font-display text-lg">Cargando la galería…</p>
        </div>
      )}

      {estado === 'error' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 text-center py-16 px-6">
          <AlertCircle size={40} className="mx-auto text-red-400 mb-4" />
          <p className="text-gray-600 mb-6">{mensajeError}</p>
          <button
            onClick={() => void cargar()}
            className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-6 rounded-lg transition-colors"
          >
            Reintentar
          </button>
        </div>
      )}

      {estado === 'ok' && (
        albums.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 text-center py-20 px-6">
            <Images size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500">Todavía no hay álbumes publicados. Muy pronto vas a encontrar fotos acá.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {albums.map(album => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
