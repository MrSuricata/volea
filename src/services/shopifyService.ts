import catalogRaw from '../data/shopify-catalog.json';

export interface ShopifySelectedOption {
  name: string;
  value: string;
}

export interface ShopifyVariant {
  id: string;
  shopifyGid: string;
  title: string;
  price: number;
  compareAtPrice: number | null;
  sku: string | null;
  inventoryQuantity: number;
  availableForSale: boolean;
  selectedOptions: ShopifySelectedOption[];
  axes?: VariantAxes;
  image: string | null;
}

export interface ShopifyOption {
  name: string;
  kind?: 'color' | 'size' | 'gender' | 'unknown';
  values: string[];
}

export interface VariantAxes {
  color?: string;
  size?: string;
  gender?: string;
  unknown?: string;
}

export interface ShopifyProduct {
  id: string;
  shopifyGid: string;
  handle: string;
  title: string;
  description: string;
  category: string;
  totalInventory: number;
  priceMin: number;
  priceMax: number;
  currency: string;
  featuredImage: string | null;
  images: string[];
  options: ShopifyOption[];
  variants: ShopifyVariant[];
}

export interface ShopifyCategory {
  id: string;
  name: string;
  sortOrder: number;
  count: number;
}

export interface ShopifyCatalog {
  shop: { name: string; domain: string; currency: string; country: string };
  generatedAt: string;
  categories: ShopifyCategory[];
  products: ShopifyProduct[];
}

const catalog = catalogRaw as ShopifyCatalog;

export const SHOPIFY_DOMAIN = catalog.shop.domain;
export const SHOPIFY_CURRENCY = catalog.shop.currency;

export function getCatalog(): ShopifyCatalog {
  return catalog;
}

export function getProducts(): ShopifyProduct[] {
  return catalog.products;
}

export function getCategories(): ShopifyCategory[] {
  return catalog.categories;
}

export function getProductByHandle(handle: string): ShopifyProduct | undefined {
  return catalog.products.find((p) => p.handle === handle);
}

export function getProductById(id: string): ShopifyProduct | undefined {
  return catalog.products.find((p) => p.id === id);
}

export function getFeaturedProducts(limit = 4): ShopifyProduct[] {
  return catalog.products
    .filter((p) => p.totalInventory > 0)
    .slice(0, limit);
}

export function getRelatedProducts(product: ShopifyProduct, limit = 4): ShopifyProduct[] {
  return catalog.products
    .filter((p) => p.id !== product.id && p.category === product.category)
    .slice(0, limit);
}

export interface CartLineItem {
  variantId: string;
  quantity: number;
}

/**
 * Generates a Shopify cart permalink that opens the real checkout.
 * https://shopify.dev/docs/storefronts/themes/navigation/cart#cart-permalinks
 *
 * Format: https://{shop}/cart/{variant_id}:{qty},{variant_id}:{qty}?attributes...
 */
export function buildCartPermalink(items: CartLineItem[], opts?: { discount?: string; note?: string }): string {
  if (items.length === 0) return `https://${SHOPIFY_DOMAIN}`;
  const lineString = items.map((i) => `${i.variantId}:${i.quantity}`).join(',');
  const params = new URLSearchParams();
  if (opts?.discount) params.set('discount', opts.discount);
  if (opts?.note) params.set('note', opts.note);
  const qs = params.toString();
  return `https://${SHOPIFY_DOMAIN}/cart/${lineString}${qs ? `?${qs}` : ''}`;
}

/**
 * Builds the Shopify Admin URL for editing a product (opens in new tab).
 */
export function buildAdminProductUrl(productGid: string): string {
  const id = productGid.split('/').pop();
  return `https://admin.shopify.com/store/volea-6996/products/${id}`;
}

export function buildAdminInventoryUrl(): string {
  return `https://admin.shopify.com/store/volea-6996/products/inventory`;
}

/**
 * Find a variant in a product by selected option values.
 */
export function findVariant(
  product: ShopifyProduct,
  selectedOptions: Record<string, string>
): ShopifyVariant | undefined {
  return product.variants.find((v) =>
    v.selectedOptions.every((opt) => selectedOptions[opt.name] === opt.value)
  );
}

/**
 * Color → hex mapping for swatches. Falls back to a neutral gray for unknown names.
 */
const COLOR_HEX: Record<string, string> = {
  Blanco: '#FFFFFF',
  Negro: '#1a1a1a',
  Rosa: '#E91E8C',
  'Vino tinto': '#722F37',
  Gris: '#9CA3AF',
  Azul: '#1E40AF',
  'Azul marino': '#0F1F4B',
  Rojo: '#DC2626',
  Salmón: '#FA8072',
  Beige: '#E8D5B7',
  Celeste: '#7DD3FC',
  Marrón: '#78350F',
  Fucsia: '#D946EF',
};

export function colorHex(name: string): string {
  return COLOR_HEX[name] || '#9CA3AF';
}

/**
 * Aggregate stock metrics for the dashboard.
 */
export interface StockMetrics {
  totalUnits: number;
  variantCount: number;
  outOfStockVariants: number;
  lowStockVariants: number;
  outOfStockProducts: ShopifyProduct[];
  lowStockVariantsList: Array<{ product: ShopifyProduct; variant: ShopifyVariant }>;
}

export function computeStockMetrics(threshold = 3): StockMetrics {
  let totalUnits = 0;
  let variantCount = 0;
  let outOfStockVariants = 0;
  let lowStockVariants = 0;
  const outOfStockProducts: ShopifyProduct[] = [];
  const lowStockVariantsList: Array<{ product: ShopifyProduct; variant: ShopifyVariant }> = [];

  for (const product of catalog.products) {
    if (product.totalInventory === 0) outOfStockProducts.push(product);
    for (const variant of product.variants) {
      variantCount++;
      totalUnits += variant.inventoryQuantity;
      if (variant.inventoryQuantity <= 0) {
        outOfStockVariants++;
      } else if (variant.inventoryQuantity <= threshold) {
        lowStockVariants++;
        lowStockVariantsList.push({ product, variant });
      }
    }
  }

  return {
    totalUnits,
    variantCount,
    outOfStockVariants,
    lowStockVariants,
    outOfStockProducts,
    lowStockVariantsList,
  };
}

export function formatUYU(amount: number): string {
  return `$ ${amount.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ─── Adapter to internal Product type ────────────────────────────────────────

import type { Product, Category, ProductColor } from '../types';

function categoryLabelFromId(id: string): string {
  const cat = catalog.categories.find((c) => c.id === id);
  return cat?.name || id;
}

// Legacy fallback when a variant lacks a pre-computed `axes` object.
function deriveAxesLegacy(selectedOptions: ShopifySelectedOption[]): VariantAxes {
  const axes: VariantAxes = {};
  for (const so of selectedOptions) {
    const n = so.name.toLowerCase();
    if (n === 'color' || n === 'colour') axes.color = so.value;
    else if (n === 'talla' || n === 'talle' || n === 'size') axes.size = so.value;
    else if (n.includes('sexo') || n.includes('género') || n.includes('gender')) axes.gender = so.value;
  }
  return axes;
}

function dedupe<T>(arr: T[]): T[] {
  return arr.filter((x, i) => arr.indexOf(x) === i);
}

/**
 * Convert a Shopify product to the internal Product shape used throughout the app.
 *
 * Shopify variants have up to 3 axes (Color × Talla × Sexo objetivo). The internal
 * Product only models size × color, so we collapse Talla + Sexo into a combined
 * "size" string like "M / Masculino" or "L / Femenino". Single-axis variants
 * (e.g. accessories with only Color, or single-size items) collapse naturally.
 */
export function shopifyToProduct(sp: ShopifyProduct): Product {
  // Use the build-time kind detection from build-catalog.mjs (works even when
  // Shopify option names are misconfigured — e.g. an option literally named
  // "Fucsia" whose values are colors).
  const colorOption = sp.options.find((o) => o.kind === 'color');
  const sizeOption = sp.options.find((o) => o.kind === 'size');
  const genderOption = sp.options.find((o) => o.kind === 'gender');

  const hasSize = !!sizeOption && sizeOption.values.length > 0;
  const hasGender = !!genderOption && genderOption.values.length > 0;
  const hasColor = !!colorOption && colorOption.values.length > 0;

  // Compose size list (combines Talla + Sexo when both exist)
  let sizes: string[];
  if (hasSize && hasGender) {
    sizes = [];
    for (const t of sizeOption!.values) {
      for (const g of genderOption!.values) {
        sizes.push(`${t} / ${g}`);
      }
    }
  } else if (hasSize) {
    sizes = sizeOption!.values.slice();
  } else if (hasGender) {
    sizes = genderOption!.values.slice();
  } else {
    sizes = ['Único'];
  }

  const colors: ProductColor[] = hasColor
    ? colorOption!.values.map((name) => ({ name, hex: colorHex(name) }))
    : [{ name: 'Único', hex: '#1a1a1a' }];

  const stockBySize: Record<string, number> = {};
  const variantMap: Record<string, string> = {};

  for (const v of sp.variants) {
    // Prefer pre-computed axes (from build-catalog.mjs); fall back to legacy
    // selectedOptions name-match if axes is missing.
    const axes = v.axes ?? deriveAxesLegacy(v.selectedOptions);
    const color = axes.color || 'Único';

    let size: string;
    if (hasSize && hasGender) {
      size = `${axes.size || ''} / ${axes.gender || ''}`;
    } else if (hasSize) {
      size = axes.size || 'Único';
    } else if (hasGender) {
      size = axes.gender || 'Único';
    } else {
      size = 'Único';
    }

    const key = `${size}|${color}`;
    stockBySize[key] = (stockBySize[key] || 0) + v.inventoryQuantity;
    if (!variantMap[key]) variantMap[key] = v.id;
  }

  // Image list: featured first, then media, dedupe, then variant images for variety
  const imageList = dedupe(
    [sp.featuredImage, ...sp.images, ...sp.variants.map((v) => v.image)].filter(
      (x): x is string => !!x
    )
  );

  const FALLBACK = '/logo.png';

  return {
    id: sp.id,
    name: sp.title,
    sku: sp.variants[0]?.sku || '',
    description: sp.description,
    price: sp.priceMin,
    category: sp.category, // id de categoría, consistente con los productos nativos

    images: imageList.length ? imageList : [FALLBACK],
    sizes,
    colors,
    stockBySize,
    isFeatured: sp.totalInventory > 0 && imageList.length > 0,
    isOffer: false,
    createdAt: catalog.generatedAt,
    shopifyGid: sp.shopifyGid,
    shopifyHandle: sp.handle,
    variantMap,
  };
}

export function getProductsAsInternal(): Product[] {
  return catalog.products.map(shopifyToProduct);
}

export function getCategoriesAsInternal(): Category[] {
  return catalog.categories.map((c) => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sortOrder,
  }));
}

/**
 * Look up the Shopify variant id for a given (size, color) selection on an internal Product.
 */
export function getVariantIdForSelection(
  product: Product,
  size: string,
  color: string
): string | undefined {
  if (!product.variantMap) return undefined;
  return product.variantMap[`${size}|${color}`];
}
