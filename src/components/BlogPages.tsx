import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Newspaper } from 'lucide-react';
import type { Post } from '../types';

const formatPrice = (n: number) => '$ ' + n.toLocaleString('es-UY', { maximumFractionDigits: 0 });

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric' });

const postDate = (p: Post) => p.publishedAt || p.createdAt;

// ─── Renderizado simple de contenido ─────────────────────────────────────────
// "## " → h2 · bloques de "- " consecutivos → ul · resto → párrafos

function renderContent(content: string): ReactNode[] {
  const lines = content.split('\n').map(l => l.replace(/\r$/, ''));
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    nodes.push(
      <ul key={key} className="list-disc pl-6 space-y-1">
        {listItems.map((item, i) => (
          <li key={i} className="text-gray-600 leading-relaxed">{item}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (line.startsWith('- ')) {
      listItems.push(line.slice(2));
      return;
    }
    flushList(`ul-${idx}`);
    if (line.startsWith('## ')) {
      nodes.push(
        <h2 key={`h-${idx}`} className="font-display text-2xl font-bold text-navy-700 mt-8 mb-3">
          {line.slice(3)}
        </h2>
      );
    } else if (line.length > 0) {
      nodes.push(
        <p key={`p-${idx}`} className="text-gray-600 leading-relaxed mb-4">
          {line}
        </p>
      );
    }
  });
  flushList('ul-final');

  return nodes;
}

// ─── Cover fallback ──────────────────────────────────────────────────────────

function CoverFallback() {
  return (
    <div className="w-full h-48 bg-gradient-to-br from-navy-700 to-navy-900 flex items-center justify-center">
      <span className="font-display text-2xl font-bold tracking-[0.3em] text-lime-400">VOLEA</span>
    </div>
  );
}

// ─── BlogListPage ────────────────────────────────────────────────────────────

export function BlogListPage({ posts }: { posts: Post[] }) {
  const published = [...posts]
    .filter(p => p.published)
    .sort((a, b) => new Date(postDate(b)).getTime() - new Date(postDate(a)).getTime());

  return (
    <div className="fade-in max-w-7xl mx-auto px-4 py-12">
      <p className="font-display text-sm font-bold uppercase tracking-widest text-lime-600 mb-2">
        NOTICIAS
      </p>
      <h1 className="font-display text-3xl md:text-4xl font-bold text-navy-700">Blog VOLEA</h1>
      <div className="w-16 h-1 bg-lime-400 mb-8" />
      <p className="text-gray-600 max-w-2xl -mt-4 mb-10">
        Novedades del pickleball en Uruguay, la comunidad y todo lo que pasa en VOLEA.
      </p>

      {published.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 text-center py-20 px-6">
          <Newspaper size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Todavía no hay publicaciones. Muy pronto vas a encontrar novedades acá.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {published.map(post => (
            <Link
              key={post.id}
              to={`/blog/${post.slug}`}
              className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover-scale group flex flex-col"
            >
              {post.coverUrl ? (
                <div className="img-zoom h-48">
                  <img src={post.coverUrl} alt={post.title} className="w-full h-48 object-cover" />
                </div>
              ) : (
                <CoverFallback />
              )}
              <div className="p-5 flex flex-col flex-1">
                <p className="text-xs text-gray-400 mb-2">{formatDate(postDate(post))}</p>
                <h2 className="font-display text-lg font-bold text-navy-700 mb-2 group-hover:text-navy-500 transition-colors">
                  {post.title}
                </h2>
                <p
                  className="text-gray-600 text-sm mb-4 flex-1"
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {post.excerpt}
                </p>
                <span className="font-display text-sm font-semibold text-lime-600 group-hover:underline">
                  Leer más →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── BlogPostPage ────────────────────────────────────────────────────────────

export function BlogPostPage({ posts }: { posts: Post[] }) {
  const { slug } = useParams<{ slug: string }>();
  const post = posts.find(p => p.published && p.slug === slug);

  if (!post) {
    return (
      <div className="fade-in max-w-3xl mx-auto px-4 py-20 text-center">
        <Newspaper size={48} className="mx-auto text-gray-300 mb-4" />
        <h1 className="font-display text-2xl font-bold text-navy-700 mb-2">
          Publicación no encontrada
        </h1>
        <p className="text-gray-500 mb-6">
          Puede que el link esté mal escrito o que la publicación ya no exista.
        </p>
        <Link
          to="/blog"
          className="inline-block bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-6 rounded-lg transition-colors"
        >
          Volver al blog
        </Link>
      </div>
    );
  }

  return (
    <div className="fade-in max-w-3xl mx-auto px-4 py-12">
      <Link
        to="/blog"
        className="inline-block font-display text-sm font-semibold text-lime-600 hover:underline mb-6"
      >
        ← Volver al blog
      </Link>

      <article>
        {post.coverUrl && (
          <img
            src={post.coverUrl}
            alt={post.title}
            className="rounded-2xl w-full max-h-96 object-cover mb-8"
          />
        )}
        <p className="text-sm text-gray-400 mb-2">{formatDate(postDate(post))}</p>
        <h1 className="font-display text-3xl md:text-4xl font-bold text-navy-700">{post.title}</h1>
        <div className="w-16 h-1 bg-lime-400 mb-8" />
        <div>{renderContent(post.content)}</div>
      </article>
    </div>
  );
}

// formatPrice queda disponible por convención del proyecto (no usado en blog)
void formatPrice;
