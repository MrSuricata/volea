import { useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { X, ChevronLeft, ChevronRight, Trash2, Plus, Save, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { Product, Category, ProductColor } from '../types';

const formatPrice = (n: number) => '$ ' + n.toLocaleString('es-UY', { maximumFractionDigits: 0 });

const INPUT_CLASS =
  'w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors';
const LABEL_CLASS = 'block text-sm font-semibold text-navy-700 mb-1';

const SIZE_SUGGESTIONS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', 'Único'];

const stockKey = (size: string, colorName: string) => `${size}|${colorName}`;

// El stock local se indexa por una clave ESTABLE por color (_key) y no por el
// nombre: renombrar un color no puede pisar ni perder cantidades, aunque el
// nombre pase transitoriamente por el de otro color mientras se tipea.
type EditorColor = ProductColor & { _key: string };

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-display text-base font-bold text-navy-700 uppercase tracking-wide flex items-center gap-2">
      <span className="w-1.5 h-5 bg-lime-400 rounded-full inline-block" />
      {children}
    </h3>
  );
}

export function ProductEditor({ product, categories, onSave, onClose, uploadImage }: {
  product: Product | null;         // null = crear nuevo
  categories: Category[];
  onSave: (p: Product) => void;
  onClose: () => void;
  uploadImage: (f: File) => Promise<string | null>;
}) {
  // ── Datos ──────────────────────────────────────────────────────────────────
  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const [originalPrice, setOriginalPrice] = useState(
    product?.originalPrice ? String(product.originalPrice) : ''
  );
  const [category, setCategory] = useState(product?.category ?? (categories[0]?.id ?? ''));
  const [isFeatured, setIsFeatured] = useState(product?.isFeatured ?? false);
  const [isOffer, setIsOffer] = useState(product?.isOffer ?? false);
  const [active, setActive] = useState(product?.active ?? true);

  // ── Fotos ──────────────────────────────────────────────────────────────────
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingCount, setUploadingCount] = useState(0);
  const uploading = uploadingCount > 0;

  // ── Talles / Colores / Stock ───────────────────────────────────────────────
  const [sizes, setSizes] = useState<string[]>(product?.sizes ?? []);
  const [newSize, setNewSize] = useState('');
  // Inicialización conjunta: colores con _key estable + stock convertido de
  // claves por nombre ("M|Negro") a claves por _key ("M|<uuid>").
  const [init] = useState(() => {
    const cols: EditorColor[] = (product?.colors ?? []).map(c => ({ ...c, _key: crypto.randomUUID() }));
    const st: Record<string, number> = {};
    for (const [key, qty] of Object.entries(product?.stockBySize ?? {})) {
      const sep = key.indexOf('|');
      const size = sep === -1 ? key : key.slice(0, sep);
      const colorName = sep === -1 ? '' : key.slice(sep + 1);
      const col = cols.find(c => c.name === colorName);
      if (col) st[stockKey(size, col._key)] = qty;
    }
    return { cols, st };
  });
  const [colors, setColors] = useState<EditorColor[]>(init.cols);
  const [stock, setStock] = useState<Record<string, number>>(init.st);

  // ── Fotos: handlers ────────────────────────────────────────────────────────
  const handleFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploadingCount(c => c + files.length);
    for (const file of files) {
      try {
        const url = await uploadImage(file);
        if (url) {
          setImages(prev => [...prev, url]);
        } else {
          toast.error(`No se pudo subir "${file.name}"`);
        }
      } catch {
        toast.error(`No se pudo subir "${file.name}"`);
      } finally {
        setUploadingCount(c => c - 1);
      }
    }
  };

  const addImageUrl = () => {
    const url = imageUrl.trim();
    if (!url) return;
    setImages(prev => [...prev, url]);
    setImageUrl('');
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const moveImage = (index: number, dir: -1 | 1) => {
    setImages(prev => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      return next;
    });
  };

  // ── Talles: handlers ───────────────────────────────────────────────────────
  const addSize = (raw: string) => {
    const size = raw.trim();
    if (!size) return;
    if (sizes.includes(size)) {
      setNewSize('');
      return;
    }
    setSizes(prev => [...prev, size]);
    setNewSize('');
  };

  const removeSize = (size: string) => {
    // Se preservan las claves de stock en el estado; al guardar solo se toman
    // las combinaciones vigentes.
    setSizes(prev => prev.filter(s => s !== size));
  };

  const handleSizeKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSize(newSize);
    }
  };

  // ── Colores: handlers ──────────────────────────────────────────────────────
  const addColor = () => {
    setColors(prev => [...prev, { name: '', hex: '#1a1a1a', _key: crypto.randomUUID() }]);
  };

  const removeColor = (index: number) => {
    setColors(prev => prev.filter((_, i) => i !== index));
  };

  const setColorHex = (index: number, hex: string) => {
    setColors(prev => prev.map((c, i) => (i === index ? { ...c, hex } : c)));
  };

  // El stock está indexado por _key, así que renombrar es solo cambiar el texto.
  const renameColor = (index: number, newName: string) => {
    setColors(prev => prev.map((c, i) => (i === index ? { ...c, name: newName } : c)));
  };

  // ── Stock: handlers ────────────────────────────────────────────────────────
  const setStockValue = (key: string, raw: string) => {
    const parsed = Math.floor(Number(raw));
    const qty = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setStock(prev => ({ ...prev, [key]: qty }));
  };

  const totalStock = sizes.reduce(
    (accSize, size) =>
      accSize + colors.reduce((accColor, color) => accColor + (stock[stockKey(size, color._key)] ?? 0), 0),
    0
  );

  // ── Guardar ────────────────────────────────────────────────────────────────
  const handleSave = () => {
    const cleanName = name.trim();
    if (!cleanName) {
      toast.error('Completá el nombre del producto');
      return;
    }
    const priceNum = Math.round(Number(price));
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      toast.error('Ingresá un precio mayor a 0');
      return;
    }
    if (sizes.length === 0) {
      toast.error('Agregá al menos un talle');
      return;
    }
    const namedColors = colors.filter(c => c.name.trim());
    if (namedColors.length === 0) {
      toast.error('Agregá al menos un color con nombre');
      return;
    }
    if (colors.some(c => !c.name.trim())) {
      toast.error('Completá el nombre de todos los colores');
      return;
    }

    const cleanColors: ProductColor[] = colors.map(c => ({
      name: c.name.trim(),
      hex: c.hex || '#1a1a1a',
    }));
    if (new Set(cleanColors.map(c => c.name)).size !== cleanColors.length) {
      toast.error('Hay dos colores con el mismo nombre — renombrá uno');
      return;
    }

    // Solo combinaciones vigentes talle × color: se traduce la clave estable
    // (_key) al nombre final del color.
    const stockBySize: Record<string, number> = {};
    sizes.forEach(size => {
      colors.forEach((color, i) => {
        stockBySize[stockKey(size, cleanColors[i].name)] = stock[stockKey(size, color._key)] ?? 0;
      });
    });

    const origNum = Math.round(Number(originalPrice));

    const p: Product = {
      id: product?.id || crypto.randomUUID(),
      name: cleanName,
      sku: sku.trim(),
      description: description.trim(),
      price: priceNum,
      ...(Number.isFinite(origNum) && origNum > 0 ? { originalPrice: origNum } : {}),
      category,
      images,
      sizes,
      colors: cleanColors,
      stockBySize,
      isFeatured,
      isOffer,
      active,
      sortOrder: product?.sortOrder ?? 0,
      createdAt: product?.createdAt || new Date().toISOString().slice(0, 10),
      ...(product?.shopifyGid ? { shopifyGid: product.shopifyGid } : {}),
      ...(product?.shopifyHandle ? { shopifyHandle: product.shopifyHandle } : {}),
      ...(product?.variantMap ? { variantMap: product.variantMap } : {}),
    };

    onSave(p);
    toast.success(product ? 'Producto actualizado' : 'Producto creado');
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="font-display text-xl font-bold text-navy-700">
            {product ? 'Editar producto' : 'Nuevo producto'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-navy-700 transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* ── 1. DATOS ─────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Datos</SectionTitle>
            <div>
              <label className={LABEL_CLASS}>Nombre *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ej: Remera Dink Master"
                className={INPUT_CLASS}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLASS}>SKU</label>
                <input
                  type="text"
                  value={sku}
                  onChange={e => setSku(e.target.value)}
                  placeholder="Ej: VOL-REM-001"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Categoría</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className={INPUT_CLASS + ' bg-white'}
                >
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={LABEL_CLASS}>Descripción</label>
              <textarea
                rows={4}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Contale al cliente qué hace especial a este producto…"
                className={INPUT_CLASS + ' resize-none'}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLASS}>Precio (UYU) *</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  placeholder="0"
                  className={INPUT_CLASS}
                />
                {Number(price) > 0 && (
                  <p className="text-xs text-gray-500 mt-1">Se muestra como {formatPrice(Math.round(Number(price)))}</p>
                )}
              </div>
              <div>
                <label className={LABEL_CLASS}>Precio original (opcional)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={originalPrice}
                  onChange={e => setOriginalPrice(e.target.value)}
                  placeholder="Se muestra tachado junto al precio de oferta"
                  className={INPUT_CLASS}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isFeatured}
                  onChange={e => setIsFeatured(e.target.checked)}
                  className="w-4 h-4 accent-lime-500"
                />
                <span className="text-sm font-semibold text-navy-700">
                  Destacado <span className="font-normal text-gray-500">(aparece en la página de inicio)</span>
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isOffer}
                  onChange={e => setIsOffer(e.target.checked)}
                  className="w-4 h-4 accent-lime-500"
                />
                <span className="text-sm font-semibold text-navy-700">Oferta</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={e => setActive(e.target.checked)}
                  className="w-4 h-4 accent-lime-500"
                />
                <span className="text-sm font-semibold text-navy-700">
                  Activo <span className="font-normal text-gray-500">(visible en la tienda)</span>
                </span>
              </label>
            </div>
          </section>

          {/* ── 2. FOTOS ─────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Fotos</SectionTitle>
            {images.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {images.map((img, i) => (
                  <div key={`${img}-${i}`} className="relative group">
                    <img
                      src={img}
                      alt={`Foto ${i + 1}`}
                      className="w-20 h-20 object-cover rounded-lg border border-gray-200"
                    />
                    <div className="absolute inset-0 bg-navy-900/70 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveImage(i, -1)}
                        disabled={i === 0}
                        title="Mover a la izquierda"
                        className="text-white hover:text-lime-400 disabled:opacity-30 disabled:hover:text-white transition-colors"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        title="Quitar foto"
                        className="text-white hover:text-red-400 transition-colors"
                      >
                        <X size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveImage(i, 1)}
                        disabled={i === images.length - 1}
                        title="Mover a la derecha"
                        className="text-white hover:text-lime-400 disabled:opacity-30 disabled:hover:text-white transition-colors"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                    {i === 0 && (
                      <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-lime-400 text-navy-700 text-[10px] font-display font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                        Principal
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Todavía no hay fotos. Subí al menos una — la primera es la principal.</p>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <label
                className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-gray-300 text-sm font-semibold text-navy-700 transition-colors ${
                  uploading ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:border-lime-400 hover:bg-lime-50'
                }`}
              >
                <Upload size={16} />
                {uploading ? 'Subiendo…' : 'Subir fotos'}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploading}
                  onChange={handleFiles}
                  className="hidden"
                />
              </label>
              <div className="flex flex-1 gap-2">
                <input
                  type="text"
                  value={imageUrl}
                  onChange={e => setImageUrl(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addImageUrl();
                    }
                  }}
                  placeholder="O pegá una URL de imagen"
                  className={INPUT_CLASS}
                />
                <button
                  type="button"
                  onClick={addImageUrl}
                  className="bg-navy-700 hover:bg-navy-800 text-white font-display font-semibold px-4 rounded-lg transition-colors shrink-0"
                >
                  Agregar
                </button>
              </div>
            </div>
          </section>

          {/* ── 3. TALLES ────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Talles</SectionTitle>
            {sizes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {sizes.map(size => (
                  <span
                    key={size}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-navy-200 bg-navy-50 text-navy-700 text-sm font-semibold"
                  >
                    {size}
                    <button
                      type="button"
                      onClick={() => removeSize(size)}
                      title={`Quitar talle ${size}`}
                      className="text-navy-400 hover:text-red-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={newSize}
                onChange={e => setNewSize(e.target.value)}
                onKeyDown={handleSizeKeyDown}
                placeholder="Escribí un talle y presioná Enter"
                className={INPUT_CLASS}
              />
              <button
                type="button"
                onClick={() => addSize(newSize)}
                className="bg-navy-700 hover:bg-navy-800 text-white font-display font-semibold px-4 rounded-lg transition-colors shrink-0"
              >
                Agregar
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {SIZE_SUGGESTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addSize(s)}
                  disabled={sizes.includes(s)}
                  className="px-3 py-1 rounded-full border border-gray-200 text-sm text-gray-600 hover:border-lime-400 hover:text-navy-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  + {s}
                </button>
              ))}
            </div>
          </section>

          {/* ── 4. COLORES ───────────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Colores</SectionTitle>
            {colors.length > 0 && (
              <div className="space-y-3">
                {colors.map((color, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <input
                      type="color"
                      value={color.hex || '#1a1a1a'}
                      onChange={e => setColorHex(i, e.target.value)}
                      title="Elegí el color"
                      className="w-11 h-11 rounded-lg border border-gray-200 bg-white p-1 cursor-pointer shrink-0"
                    />
                    <input
                      type="text"
                      value={color.name}
                      onChange={e => renameColor(i, e.target.value)}
                      placeholder="Nombre del color (ej: Azul marino)"
                      className={INPUT_CLASS}
                    />
                    <button
                      type="button"
                      onClick={() => removeColor(i)}
                      title="Quitar color"
                      className="text-gray-400 hover:text-red-500 transition-colors p-2 shrink-0"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={addColor}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-navy-700 hover:border-lime-400 hover:bg-lime-50 transition-colors"
            >
              <Plus size={16} /> Agregar color
            </button>
          </section>

          {/* ── 5. STOCK ─────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Stock</SectionTitle>
            {sizes.length === 0 || colors.length === 0 ? (
              <p className="text-sm text-gray-500">
                Agregá al menos un talle y un color para cargar el stock por combinación.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left py-2.5 px-4 font-semibold text-navy-700">Talle</th>
                        {colors.map((color, i) => (
                          <th key={i} className="py-2.5 px-3 font-semibold text-navy-700">
                            <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                              <span
                                className="w-3.5 h-3.5 rounded-full border border-gray-300 inline-block shrink-0"
                                style={{ backgroundColor: color.hex || '#1a1a1a' }}
                              />
                              {color.name.trim() || 'Sin nombre'}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sizes.map(size => (
                        <tr key={size} className="border-t border-gray-100">
                          <td className="py-2 px-4 font-semibold text-navy-700">{size}</td>
                          {colors.map((color, i) => {
                            const key = stockKey(size, color._key);
                            return (
                              <td key={i} className="py-2 px-3 text-center">
                                <input
                                  type="number"
                                  min={0}
                                  value={stock[key] ?? 0}
                                  onChange={e => setStockValue(key, e.target.value)}
                                  className="w-16 text-center px-2 py-1.5 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-sm font-semibold text-navy-700">
                  Total: {totalStock} {totalStock === 1 ? 'unidad' : 'unidades'}
                </p>
              </>
            )}
          </section>
        </div>

        {/* Footer fijo */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 flex gap-3 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-gray-100 hover:bg-gray-200 text-navy-700 font-display font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={uploading}
            className="flex-1 bg-lime-400 hover:bg-lime-500 disabled:bg-gray-300 disabled:cursor-not-allowed text-navy-700 font-display font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Save size={18} /> {uploading ? 'Subiendo fotos…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
