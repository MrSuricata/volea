import type { VercelRequest, VercelResponse } from '@vercel/node';

// Vista previa por página para los robots (WhatsApp, Instagram, Facebook,
// Google…), que leen el HTML sin ejecutar JavaScript: sin esto, cualquier
// producto compartido mostraba la tarjeta genérica de la home.
//
// vercel.json solo manda acá los pedidos cuyo user-agent es de un robot. Las
// personas reciben index.html directo, así que un error en esta función no
// puede romper la tienda. Devuelve el mismo index.html de la SPA con los meta
// tags de la página, y el sitemap.xml armado desde la base.
//
// La anon key es la pública (la misma que viaja en el JS del sitio): con ella
// la RLS no deja ver productos inactivos ni posts sin publicar.

const SITE = 'https://volea.vercel.app';
const REST = 'https://scftuxrtflfowohiewsc.supabase.co/rest/v1';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZnR1eHJ0Zmxmb3dvaGlld3NjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDgyMjAsImV4cCI6MjA5NTMyNDIyMH0.F9n9X_urG0O0Oo2vTI_S8LcRWR93girs1e4eZb8bWUI';
const IMAGEN_BASE = `${SITE}/og-cover.jpg`;

// La foto de la tarjeta, achicada por Vercel (misma config "images" que usa el
// sitio): las del catálogo pesan hasta 3,4 MB y WhatsApp no muestra previews
// tan pesadas. Solo las de nuestro Storage; cualquier otra va tal cual.
const STORAGE = 'https://scftuxrtflfowohiewsc.supabase.co/storage/v1/object/public/';
const fotoTarjeta = (url: string) =>
  url.startsWith(STORAGE) ? `${SITE}/_vercel/image?url=${encodeURIComponent(url)}&w=960&q=75` : url;

const PAGINAS: Record<string, { titulo: string; descripcion: string }> = {
  tienda: { titulo: 'Tienda — Indumentaria de pickleball | VOLEA', descripcion: 'Remeras, polos, shorts, vestidos y accesorios técnicos de pickleball, diseñados en Uruguay.' },
  torneos: { titulo: 'Torneos VOLEA', descripcion: 'Resultados, llaves y campeones de los torneos de pickleball que organiza VOLEA en Uruguay.' },
  ranking: { titulo: 'Ranking VOLEA', descripcion: 'El ranking de pickleball de VOLEA: puntos y torneos jugados de cada jugador.' },
  eventos: { titulo: 'Eventos y torneos de pickleball | VOLEA', descripcion: 'Próximos torneos, clínicas y eventos de pickleball en Uruguay.' },
  blog: { titulo: 'Blog | VOLEA', descripcion: 'Novedades del pickleball en Uruguay y de la comunidad VOLEA.' },
  galeria: { titulo: 'Galería | VOLEA', descripcion: 'Las fotos de cada torneo VOLEA.' },
  mapa: { titulo: 'Dónde jugar pickleball en Uruguay | VOLEA', descripcion: 'Clubes y canchas de pickleball en Uruguay, Argentina, Chile y Brasil.' },
  contacto: { titulo: 'Contacto | VOLEA', descripcion: 'Escribinos por WhatsApp o Instagram: VOLEA, indumentaria de pickleball de Uruguay.' },
};

type Meta = { titulo: string; descripcion: string; imagen: string; ruta: string; tipo: string; ld?: object };

const esc = (s = '') =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const corto = (s = '', n = 160) => {
  const limpio = s.replace(/\s+/g, ' ').trim();
  return limpio.length > n ? `${limpio.slice(0, n - 1).trimEnd()}…` : limpio;
};

async function consultar<T>(ruta: string): Promise<T[] | null> {
  try {
    const r = await fetch(`${REST}/${ruta}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
    return r.ok ? ((await r.json()) as T[]) : null;
  } catch {
    return null;
  }
}

type Producto = { id: string; name: string; description: string | null; price: number; images: string[] | null; stock_by_size: Record<string, number> | null };
type Post = { slug: string; title: string; excerpt: string | null; cover_url: string | null; published_at: string | null; updated_at: string | null };
type Evento = { id: string; name: string; date: string; end_date: string | null; location: string | null; city: string | null; description: string | null; image_url: string | null };

async function metaDe(tipo: string, id: string, slug: string, pagina: string): Promise<Meta | null | 'no-existe'> {
  if (tipo === 'producto') {
    const filas = await consultar<Producto>(
      `products?id=eq.${encodeURIComponent(id)}&active=eq.true&select=id,name,description,price,images,stock_by_size`,
    );
    if (!filas) return null;
    const p = filas[0];
    if (!p) return 'no-existe';
    const ruta = `/producto/${p.id}`;
    const stock = Object.values(p.stock_by_size ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
    const imagenes = (p.images ?? []).filter(Boolean);
    return {
      titulo: `${p.name} — $U ${p.price} | VOLEA`,
      descripcion: corto(p.description || `${p.name}: indumentaria de pickleball VOLEA, diseñada en Uruguay.`),
      imagen: imagenes[0] ? fotoTarjeta(imagenes[0]) : IMAGEN_BASE,
      ruta,
      tipo: 'product',
      ld: {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Product',
            '@id': `${SITE}${ruta}#product`,
            name: p.name,
            image: imagenes.length ? imagenes : [IMAGEN_BASE],
            ...(p.description ? { description: corto(p.description, 500) } : {}),
            brand: { '@type': 'Brand', name: 'VOLEA' },
            offers: {
              '@type': 'Offer',
              url: `${SITE}${ruta}`,
              priceCurrency: 'UYU',
              price: String(p.price),
              availability: stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
              itemCondition: 'https://schema.org/NewCondition',
              seller: { '@type': 'Organization', name: 'VOLEA' },
            },
          },
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${SITE}/` },
              { '@type': 'ListItem', position: 2, name: 'Tienda', item: `${SITE}/tienda` },
              { '@type': 'ListItem', position: 3, name: p.name },
            ],
          },
        ],
      },
    };
  }

  if (tipo === 'post') {
    const filas = await consultar<Post>(
      `posts?slug=eq.${encodeURIComponent(slug)}&published=eq.true&select=slug,title,excerpt,cover_url,published_at,updated_at`,
    );
    if (!filas) return null;
    const p = filas[0];
    if (!p) return 'no-existe';
    return {
      titulo: `${p.title} | VOLEA`,
      descripcion: corto(p.excerpt || p.title),
      imagen: p.cover_url ? fotoTarjeta(p.cover_url) : IMAGEN_BASE,
      ruta: `/blog/${p.slug}`,
      tipo: 'article',
      ld: {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: p.title,
        ...(p.cover_url ? { image: p.cover_url } : {}),
        ...(p.published_at ? { datePublished: p.published_at } : {}),
        ...(p.updated_at ? { dateModified: p.updated_at } : {}),
        author: { '@type': 'Organization', name: 'VOLEA', url: SITE },
      },
    };
  }

  if (tipo === 'evento') {
    const filas = await consultar<Evento>(
      `events?id=eq.${encodeURIComponent(id)}&select=id,name,date,end_date,location,city,description,image_url`,
    );
    if (!filas) return null;
    const e = filas[0];
    if (!e) return 'no-existe';
    const lugar = [e.location, e.city].filter(Boolean).join(', ');
    return {
      titulo: `${e.name} — Inscripción | VOLEA`,
      descripcion: corto(e.description || `Inscribite online al ${e.name}${lugar ? ` en ${lugar}` : ''}.`),
      imagen: e.image_url ? fotoTarjeta(e.image_url) : IMAGEN_BASE,
      ruta: `/inscripcion/${e.id}`,
      tipo: 'website',
      ld: {
        '@context': 'https://schema.org',
        '@type': 'SportsEvent',
        name: e.name,
        sport: 'Pickleball',
        startDate: e.date,
        ...(e.end_date ? { endDate: e.end_date } : {}),
        ...(lugar ? { location: { '@type': 'Place', name: e.location || lugar, address: lugar } } : {}),
        ...(e.image_url ? { image: e.image_url } : {}),
        organizer: { '@type': 'Organization', name: 'VOLEA', url: SITE },
      },
    };
  }

  if (tipo === 'pagina' && PAGINAS[pagina]) {
    const p = PAGINAS[pagina];
    return { titulo: p.titulo, descripcion: p.descripcion, imagen: IMAGEN_BASE, ruta: `/${pagina}`, tipo: 'website' };
  }
  return null;
}

async function sitemap(res: VercelResponse) {
  const [productos, posts] = await Promise.all([
    consultar<{ id: string; updated_at: string | null }>('products?active=eq.true&select=id,updated_at'),
    consultar<{ slug: string; updated_at: string | null }>('posts?published=eq.true&select=slug,updated_at'),
  ]);
  const url = (ruta: string, mod?: string | null) =>
    `<url><loc>${SITE}${ruta}</loc>${mod ? `<lastmod>${mod.slice(0, 10)}</lastmod>` : ''}</url>`;
  const cuerpo = [
    url('/'),
    ...Object.keys(PAGINAS).map(p => url(`/${p}`)),
    ...(productos ?? []).map(p => url(`/producto/${encodeURIComponent(p.id)}`, p.updated_at)),
    ...(posts ?? []).map(p => url(`/blog/${encodeURIComponent(p.slug)}`, p.updated_at)),
  ].join('');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res
    .status(200)
    .send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${cuerpo}</urlset>`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = req.query as Record<string, string | undefined>;
  const tipo = q.tipo ?? '';
  if (tipo === 'sitemap') return sitemap(res);

  let base: string;
  try {
    const r = await fetch(`${SITE}/index.html`);
    base = await r.text();
  } catch {
    // Sin la plantilla no hay página que devolver: el robot vuelve a intentar.
    return res.status(503).send('');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const meta = await metaDe(tipo, q.id ?? '', q.slug ?? '', q.p ?? '');
  if (meta === 'no-existe') {
    return res
      .status(404)
      .send(base.replace('</head>', '<meta name="robots" content="noindex" /></head>'));
  }
  if (!meta) {
    // Supabase no respondió: la SPA tal cual, sin mentir un 404.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(base);
  }

  const url = `${SITE}${meta.ruta}`;
  const head = [
    `<title>${esc(meta.titulo)}</title>`,
    `<meta name="description" content="${esc(meta.descripcion)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="${meta.tipo}" />`,
    `<meta property="og:title" content="${esc(meta.titulo)}" />`,
    `<meta property="og:description" content="${esc(meta.descripcion)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(meta.imagen)}" />`,
    `<meta property="og:site_name" content="VOLEA" />`,
    `<meta property="og:locale" content="es_UY" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.titulo)}" />`,
    `<meta name="twitter:description" content="${esc(meta.descripcion)}" />`,
    `<meta name="twitter:image" content="${esc(meta.imagen)}" />`,
    meta.ld ? `<script type="application/ld+json">${JSON.stringify(meta.ld).replace(/</g, '\\u003c')}</script>` : '',
  ].join('\n    ');

  const html = base
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<meta\s+(?:name="description"|name="keywords"|property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\s*/g, '')
    .replace('</head>', `    ${head}\n  </head>`);

  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
  return res.status(200).send(html);
}
