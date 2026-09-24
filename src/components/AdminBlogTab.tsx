import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { FileText, ImageOff, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { Post } from '../types';
import { sesionAdminVencida } from '../services/authService';
import {
  AreaTexto, Boton, BotonIcono, Campo, Chip, Confirmar, Dialogo, EncabezadoPagina, Entrada,
  Insignia, Interruptor, Vacio,
} from '../admin/ui';
import { cn } from '../lib/cn';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Slug definitivo: lowercase, sin tildes, espacios→guiones, solo [a-z0-9-]. */
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Versión suave para tipear en el input de slug (no recorta guiones al final). */
const slugifyLive = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

/** "2026-07-09" o ISO → "09/07/2026" sin líos de timezone. */
const formatDate = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
};

type FiltroPosts = 'todas' | 'publicadas' | 'borradores';

// ─── Portada (subir o pegar URL) ─────────────────────────────────────────────

/**
 * El input de archivo va ADENTRO de un <label> (y no disparado con .click() desde
 * un botón): es la forma que iOS Safari abre siempre el selector de fotos. Queda
 * `sr-only` y no `hidden` para que se pueda llegar con Tab.
 */
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

function Portada({ url, subiendo, alElegirArchivo, alCambiarUrl }: {
  url: string;
  subiendo: boolean;
  alElegirArchivo: (e: ChangeEvent<HTMLInputElement>) => void;
  alCambiarUrl: (url: string) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-semibold text-navy-700">Portada</span>
      {url.trim() !== '' && <VistaPortada key={url} url={url} />}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label
          className={cn(
            'inline-flex h-11 shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-5 font-display text-sm font-bold text-navy-700 transition-colors hover:border-navy-700 focus-within:ring-2 focus-within:ring-navy-700/15',
            subiendo && 'pointer-events-none opacity-60',
          )}
        >
          <Upload size={16} className={subiendo ? 'animate-pulse' : undefined} />
          {subiendo ? 'Subiendo…' : 'Subir imagen'}
          <input type="file" accept="image/*" className="sr-only" disabled={subiendo} onChange={alElegirArchivo} />
        </label>
        <Entrada
          type="url"
          inputMode="url"
          value={url}
          onChange={e => alCambiarUrl(e.target.value)}
          placeholder="O pegá una URL de imagen"
          aria-label="URL de la portada"
          autoComplete="off"
        />
      </div>
    </div>
  );
}

// ─── Modal editor ────────────────────────────────────────────────────────────

function BlogPostModal({
  post, posts, uploadImage, onClose, onSave,
}: {
  post: Post | null;
  posts: Post[];
  uploadImage: (f: File) => Promise<string | null>;
  onClose: () => void;
  onSave: (p: Post) => void;
}) {
  const isNew = !post;
  const [form, setForm] = useState<Post>(
    post || {
      id: '',
      title: '',
      slug: '',
      excerpt: '',
      content: '',
      coverUrl: '',
      published: false,
      createdAt: '',
    }
  );
  // Foto de cómo arrancó: tocar afuera con un borrador escrito pregunta antes de tirarlo.
  const [inicial] = useState(() => JSON.stringify(form));
  const sucio = JSON.stringify(form) !== inicial;
  const [slugTouched, setSlugTouched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorTitulo, setErrorTitulo] = useState<string | null>(null);
  const tituloRef = useRef<HTMLInputElement>(null);

  const handleTitleChange = (value: string) => {
    if (value.trim()) setErrorTitulo(null);
    setForm(f => ({
      ...f,
      title: value,
      // Post nuevo: autogenerar slug mientras no lo hayan tocado a mano
      slug: isNew && !slugTouched ? slugify(value) : f.slug,
    }));
  };

  const handleSlugChange = (value: string) => {
    setSlugTouched(true);
    setForm(f => ({ ...f, slug: slugifyLive(value) }));
  };

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
    if (uploading || guardando) return;

    const title = form.title.trim();
    if (!title) {
      // Al lado del campo (y con foco), no solo un toast que en el celular tapa la pantalla.
      setErrorTitulo('Completá el título de la publicación');
      tituloRef.current?.focus();
      return;
    }

    // Slug base: el editado a mano, o el generado desde el título
    let baseSlug = slugify(form.slug) || slugify(title);
    if (!baseSlug) baseSlug = 'publicacion';

    // Unicidad: si ya existe en otro post, sufijo -2, -3...
    const taken = new Set(posts.filter(p => p.id !== (post?.id ?? '')).map(p => p.slug));
    let slug = baseSlug;
    let n = 2;
    while (taken.has(slug)) {
      slug = `${baseSlug}-${n}`;
      n++;
    }

    // `onSave` no devuelve promesa (guarda local y sube a la nube de fondo), así que
    // no hay forma de esperar el resultado. Lo que sí se puede: no decir "creada" si
    // la sesión ya venció (mismo pre-chequeo que Productos y Galería). Lee la sesión
    // de memoria, no se cuelga. El modal queda abierto con lo escrito.
    setGuardando(true);
    const vencida = await sesionAdminVencida();
    setGuardando(false);
    if (vencida) {
      toast.error('Tu sesión de admin venció — cerrá sesión y volvé a entrar. La publicación NO se guardó.');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const finalPost: Post = {
      ...form,
      title,
      slug,
      id: isNew ? crypto.randomUUID() : form.id,
      createdAt: isNew ? today : form.createdAt,
      publishedAt: form.published ? (form.publishedAt || new Date().toISOString()) : form.publishedAt,
    };

    onSave(finalPost);
    toast.success(isNew ? 'Publicación creada' : 'Publicación actualizada');
    onClose();
  };

  const idForm = 'blog-post-form';

  return (
    <Dialogo
      abierto
      titulo={isNew ? 'Nueva publicación' : 'Editar publicación'}
      alCerrar={onClose}
      sucio={sucio}
      ocupado={guardando}
      ancho="lg"
      pie={(
        <>
          <Boton
            variante="secundario"
            onClick={() => { if (!sucio || window.confirm('Tenés cambios sin guardar. ¿Descartarlos?')) onClose(); }}
            disabled={guardando}
          >
            Cancelar
          </Boton>
          <Boton type="submit" form={idForm} disabled={uploading} cargando={guardando}>
            {uploading ? 'Subiendo imagen…' : 'Guardar'}
          </Boton>
        </>
      )}
    >
      <form id={idForm} onSubmit={e => void handleSubmit(e)} className="space-y-5" noValidate>
        <Campo etiqueta="Título" requerido error={errorTitulo}>
          <Entrada
            ref={tituloRef}
            type="text"
            value={form.title}
            onChange={e => handleTitleChange(e.target.value)}
            placeholder="Título de la publicación"
            className={errorTitulo ? 'border-red-400 focus:border-red-600 focus:ring-red-600/15' : undefined}
          />
        </Campo>

        <Campo etiqueta="Slug" ayuda={<>URL de la publicación: <span className="font-medium text-navy-700">/blog/{form.slug || '…'}</span></>}>
          <Entrada
            type="text"
            value={form.slug}
            onChange={e => handleSlugChange(e.target.value)}
            placeholder="mi-publicacion"
            autoCapitalize="none"
            autoComplete="off"
          />
        </Campo>

        <Campo etiqueta="Extracto" ayuda="Resumen corto que se muestra en el listado del blog.">
          <AreaTexto
            rows={2}
            value={form.excerpt}
            onChange={e => setForm(f => ({ ...f, excerpt: e.target.value }))}
            className="min-h-[72px] resize-none"
          />
        </Campo>

        <Campo etiqueta="Contenido" ayuda='Formato: cada línea es un párrafo · "## " para subtítulos · "- " para listas.'>
          <AreaTexto
            rows={10}
            value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
            placeholder="Escribí acá el contenido de la publicación…"
            className="min-h-[220px] resize-y"
          />
        </Campo>

        <Portada
          url={form.coverUrl}
          subiendo={uploading}
          alElegirArchivo={e => void handleFile(e)}
          alCambiarUrl={coverUrl => setForm(f => ({ ...f, coverUrl }))}
        />

        <div className="rounded-lg border border-gray-200 px-4 py-2">
          <Interruptor
            activo={form.published}
            alCambiar={published => setForm(f => ({ ...f, published }))}
            etiqueta="Publicado"
            descripcion={form.published ? 'Visible en el blog' : 'Guardado como borrador'}
          />
        </div>
      </form>
    </Dialogo>
  );
}

// ─── AdminBlogTab ────────────────────────────────────────────────────────────

export function AdminBlogTab({ posts, onSave, onDelete, uploadImage }: {
  posts: Post[];
  onSave: (p: Post) => void;
  onDelete: (id: string) => void;
  uploadImage: (f: File) => Promise<string | null>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroPosts>('todas');

  const publicadas = useMemo(() => posts.filter(p => p.published).length, [posts]);
  const visibles = useMemo(
    () => posts.filter(p => (filtro === 'todas' ? true : filtro === 'publicadas' ? p.published : !p.published)),
    [posts, filtro],
  );
  const aBorrar = deleteConfirm ? posts.find(p => p.id === deleteConfirm) ?? null : null;

  const nueva = () => { setEditingPost(null); setModalOpen(true); };

  return (
    <div>
      <EncabezadoPagina
        rotulo="Web"
        titulo="Blog"
        descripcion="Las notas del blog de la web. Un borrador no se ve hasta que lo publicás."
        acciones={<Boton onClick={nueva} icono={<Plus size={17} strokeWidth={2.5} />}>Nueva publicación</Boton>}
      />

      {posts.length === 0 ? (
        <Vacio
          icono={<FileText size={22} />}
          titulo="Todavía no hay publicaciones"
          descripcion="Escribí la primera: se guarda como borrador hasta que la publiques."
          accion={<Boton onClick={nueva} icono={<Plus size={17} strokeWidth={2.5} />}>Nueva publicación</Boton>}
        />
      ) : (
        <>
          <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
            <Chip activo={filtro === 'todas'} onClick={() => setFiltro('todas')} cantidad={posts.length}>Todas</Chip>
            <Chip activo={filtro === 'publicadas'} onClick={() => setFiltro('publicadas')} cantidad={publicadas}>Publicadas</Chip>
            <Chip activo={filtro === 'borradores'} onClick={() => setFiltro('borradores')} cantidad={posts.length - publicadas}>Borradores</Chip>
          </div>

          {visibles.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
              {filtro === 'publicadas' ? 'No hay nada publicado todavía.' : 'No hay borradores.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
              {visibles.map(post => (
                <li key={post.id} className="flex items-center gap-1 py-2 pl-2 pr-2 sm:pl-3 sm:pr-3">
                  {/* Toda la fila abre el editor (blanco grande para el dedo); el lápiz
                      queda como pista visual y para teclado. */}
                  <button
                    type="button"
                    onClick={() => { setEditingPost(post); setModalOpen(true); }}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left transition-colors hover:bg-gray-50"
                  >
                  {post.coverUrl ? (
                    <img
                      src={post.coverUrl}
                      alt=""
                      loading="lazy"
                      className="h-14 w-14 shrink-0 rounded-lg border border-gray-200 object-cover sm:h-16 sm:w-20"
                    />
                  ) : (
                    <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400 sm:h-16 sm:w-20">
                      <FileText size={20} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-display text-[15px] font-bold leading-snug text-navy-700">{post.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-gray-500">
                      <Insignia tono={post.published ? 'bien' : 'neutro'} punto={post.published}>
                        {post.published ? 'Publicado' : 'Borrador'}
                      </Insignia>
                      <span className="tabular-nums">{formatDate(post.publishedAt || post.createdAt)}</span>
                      <span className="hidden truncate sm:inline">/blog/{post.slug}</span>
                    </p>
                  </div>
                  </button>
                  <div className="flex shrink-0 items-center">
                    <BotonIcono
                      etiqueta={`Editar «${post.title}»`}
                      icono={<Pencil size={18} />}
                      onClick={() => { setEditingPost(post); setModalOpen(true); }}
                    />
                    <BotonIcono
                      etiqueta={`Eliminar «${post.title}»`}
                      icono={<Trash2 size={18} />}
                      tono="peligro"
                      onClick={() => setDeleteConfirm(post.id)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Modal crear/editar */}
      {modalOpen && (
        <BlogPostModal
          post={editingPost}
          posts={posts}
          uploadImage={uploadImage}
          onClose={() => { setModalOpen(false); setEditingPost(null); }}
          onSave={onSave}
        />
      )}

      {/* Confirmación de borrado */}
      <Confirmar
        abierto={deleteConfirm !== null}
        titulo="¿Eliminar publicación?"
        mensaje={(
          <>
            {aBorrar && <p className="mb-1 font-semibold text-navy-700">«{aBorrar.title}»</p>}
            Se borra del blog. Esta acción no se puede deshacer.
          </>
        )}
        textoConfirmar="Eliminar"
        alCerrar={() => setDeleteConfirm(null)}
        alConfirmar={() => {
          if (!deleteConfirm) return;
          onDelete(deleteConfirm);
          toast.success('Publicación eliminada');
          setDeleteConfirm(null);
        }}
      />
    </div>
  );
}
