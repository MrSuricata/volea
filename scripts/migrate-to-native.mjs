// scripts/migrate-to-native.mjs
// Migración one-shot Shopify → nativo:
// 1. Lee src/data/shopify-catalog.json
// 2. Baja cada imagen del CDN de Shopify y la sube a Supabase Storage (bucket product-images)
// 3. Genera src/data/products-native.json con las filas listas para insertar en public.products
//
// Requiere .env.local con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY, y una política
// temporal de INSERT para anon en storage.objects (se elimina al terminar la migración).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'src', 'data');

// ── env ──
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const env = {};
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON_KEY) throw new Error('Faltan credenciales en .env.local');

const catalog = JSON.parse(fs.readFileSync(path.join(dataDir, 'shopify-catalog.json'), 'utf8'));

const COLOR_HEX = {
  Blanco: '#FFFFFF', Negro: '#1a1a1a', Rosa: '#E91E8C', 'Vino tinto': '#722F37',
  Gris: '#9CA3AF', Azul: '#1E40AF', 'Azul marino': '#0F1F4B', Rojo: '#DC2626',
  'Salmón': '#FA8072', Beige: '#E8D5B7', Celeste: '#7DD3FC', 'Marrón': '#78350F',
  Fucsia: '#D946EF', 'Púrpura': '#7C3AED', Verde: '#16A34A', Amarillo: '#EAB308',
};
const colorHex = (n) => COLOR_HEX[n] || '#9CA3AF';
const dedupe = (arr) => arr.filter((x, i) => arr.indexOf(x) === i);

function extFromUrl(url) {
  const m = url.split('?')[0].match(/\.(png|jpe?g|webp|gif)$/i);
  return m ? m[0].toLowerCase() : '.png';
}

const CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

async function uploadImage(shopifyUrl, storagePath) {
  const res = await fetch(shopifyUrl);
  if (!res.ok) throw new Error(`download ${res.status} ${shopifyUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = extFromUrl(shopifyUrl);
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/product-images/${storagePath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      'Content-Type': CONTENT_TYPES[ext] || 'image/png',
      'x-upsert': 'true',
    },
    body: buf,
  });
  if (!up.ok) {
    const body = await up.text();
    throw new Error(`upload ${up.status} ${storagePath}: ${body.slice(0, 200)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/product-images/${storagePath}`;
}

// ── convertir producto Shopify → fila nativa (misma lógica que shopifyToProduct) ──
function convert(sp, sortOrder, imageUrlMap) {
  const colorOption = sp.options.find((o) => o.kind === 'color');
  const sizeOption = sp.options.find((o) => o.kind === 'size');
  const genderOption = sp.options.find((o) => o.kind === 'gender');

  const hasSize = !!sizeOption && sizeOption.values.length > 0;
  const hasGender = !!genderOption && genderOption.values.length > 0;
  const hasColor = !!colorOption && colorOption.values.length > 0;

  let sizes;
  if (hasSize && hasGender) {
    sizes = [];
    for (const t of sizeOption.values) for (const g of genderOption.values) sizes.push(`${t} / ${g}`);
  } else if (hasSize) {
    sizes = sizeOption.values.slice();
  } else if (hasGender) {
    sizes = genderOption.values.slice();
  } else {
    sizes = ['Único'];
  }

  const colors = hasColor
    ? colorOption.values.map((name) => ({ name, hex: colorHex(name) }))
    : [{ name: 'Único', hex: '#1a1a1a' }];

  const stockBySize = {};
  for (const v of sp.variants) {
    const axes = v.axes || {};
    const color = axes.color || 'Único';
    let size;
    if (hasSize && hasGender) size = `${axes.size || ''} / ${axes.gender || ''}`;
    else if (hasSize) size = axes.size || 'Único';
    else if (hasGender) size = axes.gender || 'Único';
    else size = 'Único';
    const key = `${size}|${color}`;
    stockBySize[key] = (stockBySize[key] || 0) + v.inventoryQuantity;
  }

  const shopifyImages = dedupe(
    [sp.featuredImage, ...sp.images, ...sp.variants.map((v) => v.image)].filter(Boolean)
  );
  const images = shopifyImages.map((u) => imageUrlMap[u]).filter(Boolean);

  return {
    id: sp.id,
    name: sp.title,
    sku: '',
    description: sp.description,
    price: Math.round(sp.priceMin),
    original_price: null,
    category: sp.category,
    images,
    sizes,
    colors,
    stock_by_size: stockBySize,
    is_featured: false,
    is_offer: false,
    active: true,
    sort_order: sortOrder,
  };
}

// ── main ──
const imageUrlMap = {};
let uploaded = 0, failed = 0;

for (const sp of catalog.products) {
  const urls = dedupe(
    [sp.featuredImage, ...sp.images, ...sp.variants.map((v) => v.image)].filter(Boolean)
  );
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (imageUrlMap[url]) continue;
    const storagePath = `${sp.handle}/${i + 1}${extFromUrl(url)}`;
    try {
      imageUrlMap[url] = await uploadImage(url, storagePath);
      uploaded++;
      process.stdout.write(`  ✓ ${storagePath}\n`);
    } catch (e) {
      failed++;
      process.stdout.write(`  ✗ ${storagePath}: ${e.message}\n`);
    }
  }
}

const rows = catalog.products.map((sp, i) => convert(sp, i, imageUrlMap));

// Destacados: primeros 4 con foto y stock
let featured = 0;
for (const r of rows) {
  const totalStock = Object.values(r.stock_by_size).reduce((s, q) => s + q, 0);
  if (featured < 4 && r.images.length > 0 && totalStock > 0) { r.is_featured = true; featured++; }
}

const categories = catalog.categories.map((c) => ({ id: c.id, name: c.name, sort_order: c.sortOrder }));

fs.writeFileSync(path.join(dataDir, 'products-native.json'), JSON.stringify({ products: rows, categories }, null, 2));
console.log(`\nImágenes subidas: ${uploaded}, fallidas: ${failed}`);
console.log(`Productos convertidos: ${rows.length}, categorías: ${categories.length}`);
console.log('Escrito: src/data/products-native.json');
