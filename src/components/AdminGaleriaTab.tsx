import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Plus, Edit, Trash2, X, Save, Upload, Images, ExternalLink, RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  listarAlbumes, crearAlbum, actualizarAlbum, eliminarAlbum, esLinkAlbumValido,
  type AlbumInput, type GalleryAlbum,
} from '../galeria/datos';

const inputClass =
  'w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors';
const labelClass = 'block text-sm font-semibold text-navy-700 mb-1';

/** "2026-07-09" → "09/07/2026", sin líos de timezone (parseo manual del string, sin pasar por Date). */
const formatFecha = (fecha: string): string => {
  const [y, m, d] = fecha.slice(0, 10).split('-');
  if (!y || !m || !d) return fecha;
  return `${d}/${m}/${y}`;
};

const emptyForm = (): AlbumInput => ({ title: '', eventDate: null, coverUrl: null, albumUrl: '' });
const toForm = (a: GalleryAlbum): AlbumInput => ({
  title: a.title, eventDate: a.eventDate, coverUrl: a.coverUrl, albumUrl: a.albumUrl,
});

// ─── Modal editor ────────────────────────────────────────────────────────────

function AlbumModal({
  album, uploadImage, onClose, onSaved,
}: {
  album: GalleryAlbum | null;
  uploadImage: (f: File) => Promise<string | null>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !album;
  const [form, setForm] = useState<AlbumInput>(album ? toForm(album) : emptyForm());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = uploading || saving;

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    const url = await uploadImage(file);
    setUploading(false);
    if (url) {
      setForm(f => ({ ...f, coverUrl: url }));
    } else {
      toast.error('No se pudo subir la imagen. Probá de nuevo.');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const title = form.title.trim();
    if (!title) {
      toast.error('Completá el título del álbum');
      return;
    }
    const albumUrl = form.albumUrl.trim();
    if (!esLinkAlbumValido(albumUrl)) {
      toast.error('El link del álbum tiene que ser una URL https:// válida');
      return;
    }

    const input: AlbumInput = {
      title,
      eventDate: form.eventDate || null,
      coverUrl: (form.coverUrl || '').trim() || null,
      albumUrl,
    };
    setSaving(true);
    // Chequeo directo de `album` (no de `isNew`): así TS lo sabe no-nulo del lado del update.
    const ok = album ? await actualizarAlbum(album.id, input) : await crearAlbum(input);
    setSaving(false);
    if (!ok) {
      toast.error('No se pudo guardar el álbum. Probá de nuevo.');
      return; // el modal queda abierto con lo ya tipeado, nada se pierde
    }
    toast.success(isNew ? 'Álbum creado' : 'Álbum actualizado');
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="font-display text-xl font-bold text-navy-700">
            {isNew ? 'Nuevo álbum' : 'Editar álbum'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy-700 transition-colors">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className={labelClass}>Título *</label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Ej: Torneo Apertura 2026"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Fecha</label>
            <input
              type="date"
              value={form.eventDate ?? ''}
              onChange={e => setForm(f => ({ ...f, eventDate: e.target.value || null }))}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Link del álbum *</label>
            <input
              type="text"
              value={form.albumUrl}
              onChange={e => setForm(f => ({ ...f, albumUrl: e.target.value }))}
              placeholder="https://photos.app.goo.gl/..."
              className={inputClass}
            />
            <p className="text-xs text-gray-400 mt-1">Link de Google Drive o Google Photos con las fotos del torneo.</p>
          </div>

          <div>
            <label className={labelClass}>Portada</label>
            {form.coverUrl && (
              <img
                src={form.coverUrl}
                alt="Portada"
                className="w-full h-40 object-cover rounded-lg border border-gray-200 mb-3"
              />
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <label
                className={`inline-flex items-center justify-center gap-2 bg-navy-700 hover:bg-navy-800 text-white font-display font-semibold text-sm py-3 px-4 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
              >
                <Upload size={16} />
                {uploading ? 'Subiendo…' : 'Subir imagen'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={handleFile}
                />
              </label>
              <input
                type="text"
                value={form.coverUrl ?? ''}
                onChange={e => setForm(f => ({ ...f, coverUrl: e.target.value || null }))}
                placeholder="O pegá una URL de imagen"
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-navy-700 font-display font-semibold py-3 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 bg-lime-400 hover:bg-lime-500 disabled:bg-gray-300 disabled:cursor-not-allowed text-navy-700 font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Save size={18} /> {saving ? 'Guardando…' : uploading ? 'Subiendo imagen…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── AdminGaleriaTab ─────────────────────────────────────────────────────────
// Data propia (no viene de StoreContext): carga sola al montar con listarAlbumes()
// (techo de 8s + reintento, ver src/galeria/datos.ts) y vuelve a pedir la lista
// completa después de cada escritura en vez de mezclar el resultado a mano — más
// simple y siempre queda consistente con lo que realmente quedó en el server.

export function AdminGaleriaTab({ uploadImage }: {
  uploadImage: (f: File) => Promise<string | null>;
}) {
  const [albums, setAlbums] = useState<GalleryAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAlbum, setEditingAlbum] = useState<GalleryAlbum | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    const r = await listarAlbumes();
    if (r.error) {
      setLoadFailed(true);
      toast.error('No se pudo cargar la galería. Probá de nuevo.');
    } else {
      setLoadFailed(false);
      setAlbums(r.albums);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const handleSaved = () => {
    setModalOpen(false);
    setEditingAlbum(null);
    void cargar();
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    const ok = await eliminarAlbum(id);
    setDeleting(false);
    setDeleteConfirm(null);
    if (!ok) {
      toast.error('No se pudo eliminar el álbum. Probá de nuevo.');
      return;
    }
    toast.success('Álbum eliminado');
    void cargar();
  };

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Galería</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={() => void cargar()}
            disabled={loading}
            className="text-sm underline text-navy-500 hover:text-navy-700 disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed flex items-center gap-1"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
          <button
            onClick={() => { setEditingAlbum(null); setModalOpen(true); }}
            className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-2 px-6 rounded-lg transition-colors flex items-center gap-2"
          >
            <Plus size={18} /> Nuevo álbum
          </button>
        </div>
      </div>

      {loadFailed && !loading && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
          <AlertCircle size={48} strokeWidth={1} className="mx-auto mb-3" />
          <p className="font-display">No se pudo cargar la galería</p>
          <button onClick={() => void cargar()} className="text-sm text-lime-600 hover:underline mt-2">
            Reintentar
          </button>
        </div>
      )}

      {loading && albums.length === 0 && !loadFailed && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
          <p className="font-display">Cargando…</p>
        </div>
      )}

      {!loadFailed && !loading && albums.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
          <Images size={48} strokeWidth={1} className="mx-auto mb-3" />
          <p className="font-display font-semibold">Todavía no hay álbumes</p>
          <p className="text-sm mt-1">Creá el primero con el botón “Nuevo álbum”.</p>
        </div>
      )}

      {!loadFailed && albums.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Portada</th>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Título</th>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden md:table-cell">Fecha</th>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {albums.map(album => (
                  <tr key={album.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      {album.coverUrl ? (
                        <img
                          src={album.coverUrl}
                          alt={album.title}
                          className="w-12 h-12 object-cover rounded"
                        />
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-display font-semibold text-navy-700 text-sm">{album.title}</p>
                      <a
                        href={album.albumUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-lime-600 hover:underline inline-flex items-center gap-1"
                      >
                        Ver álbum <ExternalLink size={10} />
                      </a>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell whitespace-nowrap">
                      {album.eventDate ? formatFecha(album.eventDate) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditingAlbum(album); setModalOpen(true); }}
                          className="text-navy-700 hover:text-lime-500 transition-colors"
                          title="Editar"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(album.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal crear/editar */}
      {modalOpen && (
        <AlbumModal
          album={editingAlbum}
          uploadImage={uploadImage}
          onClose={() => { setModalOpen(false); setEditingAlbum(null); }}
          onSaved={handleSaved}
        />
      )}

      {/* Confirmación de borrado */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0" onClick={() => !deleting && setDeleteConfirm(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <h3 className="font-display text-lg font-bold text-navy-700 mb-2">¿Eliminar álbum?</h3>
            <p className="text-sm text-gray-500 mb-6">
              Esta acción no se puede deshacer. Las fotos en Drive/Photos no se tocan, solo se quita la tarjeta de acá.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-navy-700 font-display font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleDelete(deleteConfirm)}
                disabled={deleting}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 text-white font-display font-bold py-3 rounded-lg transition-colors"
              >
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
