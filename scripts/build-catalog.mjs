// scripts/build-catalog.mjs
// Regenera src/data/shopify-catalog.json a partir de src/data/products-full.json,
// un dump crudo de la Shopify Admin API (GraphQL). El dump se obtiene con la
// query de abajo (via MCP de Shopify o cualquier cliente Admin API) y se guarda
// en src/data/products-full.json. Luego: node scripts/build-catalog.mjs
//
// Query esperada (shape del dump = respuesta GraphQL completa):
//
//   query AllProducts($first: Int!, $after: String) {
//     products(first: $first, after: $after, query: "status:active") {
//       edges { node {
//         id title handle description totalInventory
//         priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount } }
//         featuredMedia { preview { image { url } } }
//         media(first: 20) { edges { node { ... on MediaImage { image { url } } } } }
//         options { name values }
//         variants(first: 100) { edges { node {
//           id title price compareAtPrice sku inventoryQuantity availableForSale
//           selectedOptions { name value } image { url }
//         } } }
//       } }
//       pageInfo { hasNextPage endCursor }
//     }
//   }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'src', 'data');
const DUMP_FILE = process.env.DUMP_FILE || path.join(dataDir, 'products-full.json');

const dump = JSON.parse(fs.readFileSync(DUMP_FILE, 'utf8'));
const edges = dump.data.products.edges;
if (dump.data.products.pageInfo?.hasNextPage) {
  console.warn('⚠ El dump tiene hasNextPage=true — faltan productos. Bajá la(s) página(s) siguiente(s) y uní los edges.');
}

function gidToId(gid) { return gid.split('/').pop(); }

const COLOR_NAMES = new Set([
  'Blanco', 'Negro', 'Rosa', 'Vino tinto', 'Vinotinto', 'Gris', 'Azul', 'Azul marino',
  'Rojo', 'Salmón', 'Salmon', 'Beige', 'Celeste', 'Marrón', 'Marron', 'Fucsia', 'Verde',
  'Amarillo', 'Púrpura', 'Purpura', 'Violeta', 'Naranja',
]);
const SIZE_NAMES = new Set([
  'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'XXS', 'XXL', 'XXXL',
  'Mediana', 'Única', 'Unica', 'Pequeña', 'Grande',
]);
const GENDER_NAMES = new Set(['Masculino', 'Femenino', 'Unisex', 'Hombre', 'Mujer']);

function detectKind(opt) {
  const nameLower = (opt.name || '').toLowerCase();
  if (nameLower === 'color' || nameLower === 'colour') return 'color';
  if (nameLower === 'talla' || nameLower === 'talle' || nameLower === 'size') return 'size';
  if (nameLower.includes('sexo') || nameLower.includes('género') || nameLower.includes('genero') || nameLower.includes('gender')) return 'gender';
  const values = opt.values || [];
  let c = 0, s = 0, g = 0;
  for (const v of values) {
    if (COLOR_NAMES.has(v)) c++;
    if (SIZE_NAMES.has(v)) s++;
    if (GENDER_NAMES.has(v)) g++;
  }
  const max = Math.max(c, s, g);
  if (max === 0) return 'unknown';
  if (max === c) return 'color';
  if (max === s) return 'size';
  return 'gender';
}

function categorize(title, handle) {
  const t = (title + ' ' + handle).toLowerCase();
  if (t.includes('polo')) return 'polos';
  if (t.includes('vestido') || t.includes('dress')) return 'vestidos';
  if (t.includes('conjunto') || t.includes('set ') || t.includes('pollera-short-y-top')) return 'sets';
  if (t.includes('falda') || t.includes('pollera')) return 'faldas';
  if (t.includes('short')) return 'shorts';
  if (t.includes('pantal') || t.includes('calza')) return 'pantalones';
  if (t.includes('gorro') || t.includes('vincha')) return 'accesorios';
  if (t.includes('buzo') || t.includes('canguro') || t.includes('camper')) return 'buzos';
  if (t.includes('musculosa') || t.includes('top')) return 'musculosas';
  return 'remeras';
}

const products = edges.map(({ node: n }) => {
  const taggedOptions = (n.options || []).map((opt) => ({
    name: opt.name,
    kind: detectKind(opt),
    values: opt.values || [],
  }));

  const variants = (n.variants?.edges || []).map(({ node: v }) => {
    const axes = {};
    for (const so of (v.selectedOptions || [])) {
      const tagged = taggedOptions.find((t) => t.name === so.name);
      const kind = tagged ? tagged.kind : detectKind({ name: so.name, values: [so.value] });
      axes[kind] = so.value;
    }
    return {
      id: gidToId(v.id),
      shopifyGid: v.id,
      title: v.title,
      price: parseFloat(v.price),
      compareAtPrice: v.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
      sku: v.sku,
      inventoryQuantity: v.inventoryQuantity,
      availableForSale: v.availableForSale,
      selectedOptions: v.selectedOptions || [],
      axes,
      image: v.image ? v.image.url : null,
    };
  });

  // priceMin/priceMax desde las variantes reales, ignorando precios en 0
  // (un precio 0 en Shopify es casi siempre un error de carga).
  const prices = variants.map((v) => v.price).filter((p) => p > 0);
  const fallbackPrice = parseFloat(n.priceRangeV2?.minVariantPrice?.amount || '0');
  const priceMin = prices.length ? Math.min(...prices) : fallbackPrice;
  const priceMax = prices.length ? Math.max(...prices) : fallbackPrice;

  return {
    id: gidToId(n.id),
    shopifyGid: n.id,
    handle: n.handle,
    title: n.title,
    description: (n.description || '').trim(),
    totalInventory: n.totalInventory,
    priceMin,
    priceMax,
    currency: n.priceRangeV2?.minVariantPrice?.currencyCode || 'UYU',
    featuredImage: n.featuredMedia?.preview?.image?.url || null,
    images: (n.media?.edges || []).map((m) => m.node?.image?.url).filter(Boolean),
    options: taggedOptions,
    variants,
    category: categorize(n.title, n.handle),
  };
});

products.sort((a, b) => {
  // Productos con foto e inventario primero; sin stock al final.
  const aScore = (a.totalInventory > 0 ? 2 : 0) + (a.featuredImage || a.images.length ? 1 : 0);
  const bScore = (b.totalInventory > 0 ? 2 : 0) + (b.featuredImage || b.images.length ? 1 : 0);
  if (aScore !== bScore) return bScore - aScore;
  return b.totalInventory - a.totalInventory;
});

const catMap = {};
products.forEach((p) => { catMap[p.category] = (catMap[p.category] || 0) + 1; });
const CATEGORY_LABELS = {
  remeras: 'Remeras', polos: 'Polos', musculosas: 'Musculosas', vestidos: 'Vestidos',
  shorts: 'Shorts', faldas: 'Faldas', pantalones: 'Pantalones', sets: 'Conjuntos',
  buzos: 'Buzos', accesorios: 'Accesorios',
};
const CATEGORY_ORDER = ['remeras', 'polos', 'musculosas', 'vestidos', 'shorts', 'faldas', 'pantalones', 'sets', 'buzos', 'accesorios'];
const categories = CATEGORY_ORDER.filter((id) => catMap[id]).map((id, i) => ({ id, name: CATEGORY_LABELS[id], sortOrder: i + 1, count: catMap[id] }));

const catalog = {
  shop: { name: 'VOLEA', domain: 'volea-6996.myshopify.com', currency: 'UYU', country: 'Uruguay' },
  generatedAt: new Date().toISOString(),
  categories,
  products,
};

fs.writeFileSync(path.join(dataDir, 'shopify-catalog.json'), JSON.stringify(catalog, null, 2));

console.log('Catalog written:', products.length, 'products');
console.log('Total variants:', products.reduce((s, p) => s + p.variants.length, 0));
console.log('Categories:', categories.map((c) => c.name + '(' + c.count + ')').join(', '));
console.log('');
const noPhoto = products.filter((p) => !p.featuredImage && p.images.length === 0);
if (noPhoto.length) {
  console.log('⚠ Productos SIN FOTO en Shopify (' + noPhoto.length + '):');
  noPhoto.forEach((p) => console.log('  - ' + p.title));
}
const zeroPrice = products.flatMap((p) => p.variants.filter((v) => v.price === 0).map((v) => p.title + ' / ' + v.title));
if (zeroPrice.length) {
  console.log('⚠ Variantes con precio $0 (corregir en Shopify):');
  zeroPrice.forEach((x) => console.log('  - ' + x));
}
