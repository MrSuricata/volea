import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { ExternalLink, ImageOff, Images, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  listarAlbumes, crearAlbum, actualizarAlbum, eliminarAlbum, esLinkAlbumValido,
  type AlbumInput, type GalleryAlbum,
} from '../galeria/datos';
import { sesionAdminVencida } from '../services/authService';
import {
  Boton, BotonIcono, Campo, CargandoFilas, Confirmar, Dialogo, EncabezadoPagina, Entrada,
  ErrorEstado, Vacio,
} from '../admin/ui';
import { cn } from '../lib/cn';

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

const claseCampoConError = 'border-red-400 focus:border-red-600 focus:ring-red-600/15';

// ─── Portada (subir o pegar URL) ─────────────────────────────────────────────

/** Vista previa; va con `key={url}` para que "no se pudo cargar" se resetee al cambiar la URL. */
function VistaPortada({ url }: { url: string }) {
  const [rota, setRota] = useState(false);
  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      {rota ? (
        <div className="flex h-40 flex-col items-center justify-center gap-1.5 text-[13px] text-gray-500">
          <ImageOff size={22} /> No se pudo cargar esa imagen
        </div>
      ) : (
        <img src={url} alt="Portada" onError={() => setRota(true)} className="h-40 w-full object-cover sm:h-48" />
      )}
    </div>
  );
}

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
  const [inicial] = useState(() => JSON.stringify(form));
  const sucio = JSON.stringify(form) !== inicial;
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errores, setErrores] = useState<{ title?: string; albumUrl?: string }>({});
  const tituloRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
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
    } else if (await sesionAdminVencida()) {
      toast.error('Tu sesión de admin venció — cerrá sesión y volvé a entrar para poder subir la imagen.');
    } else {
      toast.error('No se pudo subir la imagen. Probá de nuevo.');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;

    // Los dos errores a la vez y al lado de cada campo (antes: un toast por vez).
    const title = form.title.trim();
    const albumUrl = form.albumUrl.trim();
    const nuevosErrores: { title?: string; albumUrl?: string } = {};
    if (!title) nuevosErrores.title = 'Completá el título del álbum';
    if (!esLinkAlbumValido(albumUrl)) nuevosErrores.albumUrl = 'Tiene que ser un link https:// válido';
    setErrores(nuevosErrores);
    if (nuevosErrores.title) { tituloRef.current?.focus(); return; }
    if (nuevosErrores.albumUrl) { linkRef.current?.focus(); return; }

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

  const idForm = 'album-form';

  return (
    <Dialogo
      abierto
      titulo={isNew ? 'Nuevo álbum' : 'Editar álbum'}
      alCerrar={onClose}
      sucio={sucio}
      ocupado={saving}
      ancho="lg"
      pie={(
        <>
          <Boton
            variante="secundario"
            onClick={() => { if (!sucio || window.confirm('Tenés cambios sin guardar. ¿Descartarlos?')) onClose(); }}
            disabled={saving}
          >
            Cancelar
          </Boton>
          <Boton type="submit" form={idForm} disabled={uploading} cargando={saving}>
            {saving ? 'Guardando…' : uploading ? 'Subiendo imagen…' : 'Guardar'}
          </Boton>
        </>
      )}
    >
      <form id={idForm} onSubmit={e => void handleSubmit(e)} className="space-y-5" noValidate>
        <Campo etiqueta="Título" requerido error={errores.title}>
          <Entrada
            ref={tituloRef}
            type="text"
            value={form.title}
            onChange={e => {
              setForm(f => ({ ...f, title: e.target.value }));
              if (errores.title) setErrores(er => ({ ...er, title: undefined }));
            }}
            placeholder="Ej: Torneo Apertura 2026"
            className={errores.title ? claseCampoConError : undefined}
          />
        </Campo>

        <Campo etiqueta="Fecha" ayuda="Del torneo o evento. Ordena la galería: lo más nuevo primero.">
          <Entrada
            type="date"
            value={form.eventDate ?? ''}
            onChange={e => setForm(f => ({ ...f, eventDate: e.target.value || null }))}
            className="sm:w-56"
          />
        </Campo>

        <Campo
          etiqueta="Link del álbum"
          requerido
          error={errores.albumUrl}
          ayuda="Link de Google Drive o Google Photos con las fotos del torneo."
        >
          <Entrada
            ref={linkRef}
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoComplete="off"
            value={form.albumUrl}
            onChange={e => {
              setForm(f => ({ ...f, albumUrl: e.target.value }));
              if (errores.albumUrl) setErrores(er => ({ ...er, albumUrl: undefined }));
            }}
            placeholder="https://photos.app.goo.gl/..."
            className={errores.albumUrl ? claseCampoConError : undefined}
          />
        </Campo>

        <div>
          <span className="mb-1.5 block text-[13px] font-semibold text-navy-700">Portada</span>
          {(form.coverUrl ?? '').trim() !== '' && <VistaPortada key={form.coverUrl ?? ''} url={form.coverUrl ?? ''} />}
          <div className="flex flex-col gap-2 sm:flex-row">
            {/* Input de archivo adentro del <label>: es lo que iOS abre siempre; sr-only
                (no hidden) para que también se llegue con Tab. */}
            <label
              className={cn(
                'inline-flex h-11 shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-5 font-display text-sm font-bold text-navy-700 transition-colors hover:border-navy-700 focus-within:ring-2 focus-within:ring-navy-700/15',
                uploading && 'pointer-events-none opacity-60',
              )}
            >
              <Upload size={16} className={uploading ? 'animate-pulse' : undefined} />
              {uploading ? 'Subiendo…' : 'Subir imagen'}
              <input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={e => void handleFile(e)} />
            </label>
            <Entrada
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoComplete="off"
              value={form.coverUrl ?? ''}
              onChange={e => setForm(f => ({ ...f, coverUrl: e.target.value || null }))}
              placeholder="O pegá una URL de imagen"
              aria-label="URL de la portada"
            />
          </div>
        </div>
      </form>
    </Dialogo>
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

  const nuevo = () => { setEditingAlbum(null); setModalOpen(true); };
  const aBorrar = deleteConfirm ? albums.find(a => a.id === deleteConfirm) ?? null : null;

  return (
    <div>
      <EncabezadoPagina
        rotulo="Web"
        titulo="Galería"
        descripcion="Álbumes de fotos de los torneos. Cada tarjeta abre el álbum en Drive o Google Photos."
        acciones={(
          <>
            <Boton
              variante="secundario"
              onClick={() => void cargar()}
              disabled={loading}
              icono={<RefreshCw size={16} className={loading ? 'animate-spin' : undefined} />}
            >
              Actualizar
            </Boton>
            <Boton onClick={nuevo} icono={<Plus size={17} strokeWidth={2.5} />}>Nuevo álbum</Boton>
          </>
        )}
      />

      {loadFailed && !loading && (
        <ErrorEstado mensaje="No se pudo cargar la galería." alReintentar={() => void cargar()} />
      )}

      {loading && albums.length === 0 && !loadFailed && <CargandoFilas filas={3} />}

      {!loadFailed && !loading && albums.length === 0 && (
        <Vacio
          icono={<Images size={22} />}
          titulo="Todavía no hay álbumes"
          descripcion="Subí el primero con el link de Drive o Google Photos del torneo."
          accion={<Boton onClick={nuevo} icono={<Plus size={17} strokeWidth={2.5} />}>Nuevo álbum</Boton>}
        />
      )}

      {!loadFailed && albums.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {albums.map(album => (
            <li key={album.id} className="flex items-center gap-1 py-2 pl-2 pr-2 sm:pl-3 sm:pr-3">
              {/* Toda la fila abre el editor (blanco grande para el dedo). */}
              <button
                type="button"
                onClick={() => { setEditingAlbum(album); setModalOpen(true); }}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left transition-colors hover:bg-gray-50"
              >
              {album.coverUrl ? (
                <img
                  src={album.coverUrl}
                  alt=""
                  loading="lazy"
                  className="h-14 w-14 shrink-0 rounded-lg border border-gray-200 object-cover sm:h-16 sm:w-20"
                />
              ) : (
                <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400 sm:h-16 sm:w-20">
                  <Images size={20} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 font-display text-[15px] font-bold leading-snug text-navy-700">{album.title}</p>
                <p className="mt-1 text-[13px] tabular-nums text-gray-500">
                  {album.eventDate ? formatFecha(album.eventDate) : 'Sin fecha'}
                </p>
              </div>
              </button>
              <div className="flex shrink-0 items-center">
                <a
                  href={album.albumUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Abrir el álbum «${album.title}»`}
                  title="Abrir el álbum"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-navy-700"
                >
                  <ExternalLink size={18} />
                </a>
                <BotonIcono
                  etiqueta={`Editar «${album.title}»`}
                  icono={<Pencil size={18} />}
                  onClick={() => { setEditingAlbum(album); setModalOpen(true); }}
                />
                <BotonIcono
                  etiqueta={`Eliminar «${album.title}»`}
                  icono={<Trash2 size={18} />}
                  tono="peligro"
                  onClick={() => setDeleteConfirm(album.id)}
                />
              </div>
            </li>
          ))}
        </ul>
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
      <Confirmar
        abierto={deleteConfirm !== null}
        titulo="¿Eliminar álbum?"
        mensaje={(
          <>
            {aBorrar && <p className="mb-1 font-semibold text-navy-700">«{aBorrar.title}»</p>}
            Esta acción no se puede deshacer. Las fotos en Drive/Photos no se tocan, solo se quita la tarjeta de acá.
          </>
        )}
        textoConfirmar="Eliminar"
        cargando={deleting}
        alCerrar={() => setDeleteConfirm(null)}
        alConfirmar={() => { if (deleteConfirm) void handleDelete(deleteConfirm); }}
      />
    </div>
  );
}
