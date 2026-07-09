import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Plus, Edit, Trash2, X, Save, Upload, FileText } from 'lucide-react';
import { toast } from 'sonner';
import type { Post } from '../types';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const formatPrice = (n: number) => '$ ' + n.toLocaleString('es-UY', { maximumFractionDigits: 0 });

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

const inputClass =
  'w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors';
const labelClass = 'block text-sm font-semibold text-navy-700 mb-1';

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
  const [slugTouched, setSlugTouched] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleTitleChange = (value: string) => {
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (uploading) return;

    const title = form.title.trim();
    if (!title) {
      toast.error('Completá el título de la publicación');
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

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="font-display text-xl font-bold text-navy-700">
            {isNew ? 'Nueva publicación' : 'Editar publicación'}
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
              onChange={e => handleTitleChange(e.target.value)}
              placeholder="Título de la publicación"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Slug</label>
            <input
              type="text"
              value={form.slug}
              onChange={e => handleSlugChange(e.target.value)}
              placeholder="mi-publicacion"
              className={inputClass}
            />
            <p className="text-xs text-gray-400 mt-1">URL de la publicación: /blog/{form.slug || '...'}</p>
          </div>

          <div>
            <label className={labelClass}>Extracto</label>
            <textarea
              rows={2}
              value={form.excerpt}
              onChange={e => setForm(f => ({ ...f, excerpt: e.target.value }))}
              placeholder="Resumen corto que se muestra en el listado del blog"
              className={`${inputClass} resize-none`}
            />
          </div>

          <div>
            <label className={labelClass}>Contenido</label>
            <textarea
              rows={10}
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              placeholder="Escribí acá el contenido de la publicación…"
              className={`${inputClass} resize-y`}
            />
            <p className="text-xs text-gray-400 mt-1">
              Formato: cada línea es un párrafo · "## " para subtítulos · "- " para listas
            </p>
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
                value={form.coverUrl}
                onChange={e => setForm(f => ({ ...f, coverUrl: e.target.value }))}
                placeholder="O pegá una URL de imagen"
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex items-center justify-between bg-gray-50 rounded-lg p-4">
            <div>
              <p className="text-sm font-semibold text-navy-700">Publicado</p>
              <p className="text-xs text-gray-400">
                {form.published ? 'Visible en el blog' : 'Guardado como borrador'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, published: !f.published }))}
              aria-pressed={form.published}
              className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${form.published ? 'bg-lime-400' : 'bg-gray-300'}`}
            >
              <span
                className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.published ? 'translate-x-5' : ''}`}
              />
            </button>
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
              disabled={uploading}
              className="flex-1 bg-lime-400 hover:bg-lime-500 disabled:bg-gray-300 disabled:cursor-not-allowed text-navy-700 font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Save size={18} /> {uploading ? 'Subiendo imagen…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
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

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Blog</h1>
        <button
          onClick={() => { setEditingPost(null); setModalOpen(true); }}
          className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-2 px-6 rounded-lg transition-colors flex items-center gap-2"
        >
          <Plus size={18} /> Nueva publicación
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {posts.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <FileText size={48} strokeWidth={1} className="mx-auto mb-3" />
            <p className="font-display font-semibold">Todavía no hay publicaciones</p>
            <p className="text-sm mt-1">Creá la primera con el botón “Nueva publicación”.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Portada</th>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Título</th>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Estado</th>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden md:table-cell">Fecha</th>
                  <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {posts.map(post => (
                  <tr key={post.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      {post.coverUrl ? (
                        <img
                          src={post.coverUrl}
                          alt={post.title}
                          className="w-12 h-12 object-cover rounded"
                        />
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-display font-semibold text-navy-700 text-sm">{post.title}</p>
                      <p className="text-xs text-gray-400">/{post.slug}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ${post.published ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {post.published ? 'Publicado' : 'Borrador'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell whitespace-nowrap">
                      {formatDate(post.publishedAt || post.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditingPost(post); setModalOpen(true); }}
                          className="text-navy-700 hover:text-lime-500 transition-colors"
                          title="Editar"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(post.id)}
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
        )}
      </div>

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
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <h3 className="font-display text-lg font-bold text-navy-700 mb-2">¿Eliminar publicación?</h3>
            <p className="text-sm text-gray-500 mb-6">Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-navy-700 font-display font-semibold py-3 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  onDelete(deleteConfirm);
                  toast.success('Publicación eliminada');
                  setDeleteConfirm(null);
                }}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white font-display font-bold py-3 rounded-lg transition-colors"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
