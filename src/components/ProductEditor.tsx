import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ImagePlus, Plus, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Product, Category, ProductColor } from '../types';
import { sesionAdminVencida } from '../services/authService';
import { modoGuardadoStock, type GuardadoStock } from '../utils/stock';
import {
  AreaTexto, Boton, BotonIcono, Campo, Dialogo, Entrada, EntradaPlata, Interruptor, Selector,
} from '../admin/ui';
import { cn } from '../lib/cn';

const SIZE_SUGGESTIONS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', 'Único'];

const stockKey = (size: string, colorName: string) => `${size}|${colorName}`;

// El stock local se indexa por una clave ESTABLE por color (_key) y no por el
// nombre: renombrar un color no puede pisar ni perder cantidades, aunque el
// nombre pase transitoriamente por el de otro color mientras se tipea.
type EditorColor = ProductColor & { _key: string };

/** Errores de validación, cada uno se muestra AL LADO de su campo (no solo en un toast). */
type Errores = {
  name?: string;
  price?: string;
  sizes?: string;
  /** keys = los _key de los colores a marcar (sin nombre o repetidos). */
  colors?: { mensaje: string; keys: string[] };
};

const claseConError = 'border-red-400 focus:border-red-600 focus:ring-red-600/15';

function SectionTitle({ children, ayuda }: { children: ReactNode; ayuda?: ReactNode }) {
  return (
    <div>
      <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy-700">{children}</h3>
      {ayuda && <p className="mt-0.5 text-[13px] text-gray-500">{ayuda}</p>}
    </div>
  );
}

function MensajeError({ children }: { children: ReactNode }) {
  return <p role="alert" className="text-[13px] font-medium text-red-700">{children}</p>;
}

export function ProductEditor({ product, categories, onSave, onClose, uploadImage }: {
  product: Product | null;         // null = crear nuevo
  categories: Category[];
  /** false = no se guardó (la UI ya avisó por qué): el editor queda abierto. */
  onSave: (p: Product, stock: GuardadoStock) => boolean | void | Promise<boolean | void>;
  onClose: () => void;
  uploadImage: (f: File) => Promise<string | null>;
}) {
  // ── Datos ──────────────────────────────────────────────────────────────────
  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  // Plata como número (EntradaPlata): el viejo type="number" leía "1.200" como 1,2
  // y el producto quedaba a $1.
  const [price, setPrice] = useState<number | null>(product ? product.price : null);
  const [originalPrice, setOriginalPrice] = useState<number | null>(product?.originalPrice || null);
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

  // ── Guardado / errores ─────────────────────────────────────────────────────
  const [guardando, setGuardando] = useState(false);
  const [errores, setErrores] = useState<Errores>({});
  // Cada intento fallido suma 1: el efecto de abajo lleva la vista al primer error.
  const [intento, setIntento] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const tablaStockRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    if (intento === 0) return;
    const primero = formRef.current?.querySelector<HTMLElement>('[data-error="true"]');
    if (!primero) return;
    primero.scrollIntoView({ block: 'center', behavior: 'smooth' });
    primero.focus({ preventScroll: true });
  }, [intento]);

  const limpiarError = (campo: keyof Errores) => {
    setErrores(prev => (prev[campo] ? { ...prev, [campo]: undefined } : prev));
  };

  // "Hay cambios sin guardar": foto del estado al abrir vs. ahora. El stock va
  // normalizado (solo cantidades > 0, claves ordenadas) para que tocar una celda
  // vacía y dejarla en 0 no cuente como cambio.
  const instantanea = JSON.stringify({
    name, sku, description, price, originalPrice, category, isFeatured, isOffer, active, images, sizes,
    colors: colors.map(c => [c._key, c.name, c.hex]),
    stock: Object.keys(stock).filter(k => (stock[k] ?? 0) > 0).sort().map(k => [k, stock[k]]),
  });
  const [instantaneaInicial] = useState(instantanea);
  const sucio = instantanea !== instantaneaInicial;

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
        } else if (await sesionAdminVencida()) {
          toast.error('Tu sesión de admin venció — cerrá sesión y volvé a entrar para poder subir la imagen.');
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
    limpiarError('sizes');
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
    limpiarError('colors');
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
    limpiarError('colors');
    setColors(prev => prev.map((c, i) => (i === index ? { ...c, name: newName } : c)));
  };

  // ── Stock: handlers ────────────────────────────────────────────────────────
  const setStockValue = (key: string, raw: string) => {
    const parsed = Math.floor(Number(raw));
    const qty = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setStock(prev => ({ ...prev, [key]: qty }));
  };

  /**
   * Enter en la grilla de stock NO guarda el producto: baja a la celda de abajo
   * (como una planilla) y al final de la columna salta al tope de la siguiente.
   * Cargar 30 cantidades y que un Enter cierre el editor a mitad de camino era
   * peor que no tener atajo.
   */
  const siguienteCeldaStock = (e: KeyboardEvent<HTMLInputElement>, fila: number, col: number) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const tabla = tablaStockRef.current;
    const celda = (f: number, c: number) =>
      tabla?.querySelector<HTMLInputElement>(`input[data-fila="${f}"][data-col="${c}"]`) ?? null;
    const siguiente = celda(fila + 1, col) ?? celda(0, col + 1);
    if (siguiente) siguiente.focus();
    else e.currentTarget.blur();
  };

  const totalStock = sizes.reduce(
    (accSize, size) =>
      accSize + colors.reduce((accColor, color) => accColor + (stock[stockKey(size, color._key)] ?? 0), 0),
    0
  );

  // ── Guardar ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (guardando) return; // doble toque = doble guardado
    setGuardando(true);
    try {
      // Pre-check: si la sesión ya venció, avisar ANTES del "guardado" optimista
      // (el guardado local + toast de éxito con la nube muerta era una mentira).
      // sesionAdminVencida lee la sesión de memoria: no puede colgarse.
      if (await sesionAdminVencida()) {
        toast.error('Tu sesión de admin venció — cerrá sesión y volvé a entrar. El cambio NO se guardó.');
        return;
      }

      // Se juntan TODOS los errores de una vez (antes: un toast por vez, había que
      // ir y volver) y se muestran al lado de cada campo; el efecto de `intento`
      // lleva la vista al primero.
      const nuevos: Errores = {};
      const cleanName = name.trim();
      if (!cleanName) nuevos.name = 'Completá el nombre del producto';
      const priceNum = price === null ? NaN : Math.round(price);
      if (!Number.isFinite(priceNum) || priceNum <= 0) nuevos.price = 'Ingresá un precio mayor a 0';
      if (sizes.length === 0) nuevos.sizes = 'Agregá al menos un talle';

      const namedColors = colors.filter(c => c.name.trim());
      const cleanColors: ProductColor[] = colors.map(c => ({
        name: c.name.trim(),
        hex: c.hex || '#1a1a1a',
      }));
      if (namedColors.length === 0) {
        nuevos.colors = { mensaje: 'Agregá al menos un color con nombre', keys: colors.map(c => c._key) };
      } else if (colors.some(c => !c.name.trim())) {
        nuevos.colors = { mensaje: 'Completá el nombre de todos los colores', keys: colors.filter(c => !c.name.trim()).map(c => c._key) };
      } else if (new Set(cleanColors.map(c => c.name)).size !== cleanColors.length) {
        const vistos = new Map<string, number>();
        cleanColors.forEach(c => vistos.set(c.name, (vistos.get(c.name) ?? 0) + 1));
        nuevos.colors = {
          mensaje: 'Hay dos colores con el mismo nombre — renombrá uno',
          keys: colors.filter((_, i) => (vistos.get(cleanColors[i].name) ?? 0) > 1).map(c => c._key),
        };
      }

      if (Object.keys(nuevos).length > 0) {
        setErrores(nuevos);
        setIntento(n => n + 1);
        return;
      }
      setErrores({});

      // Solo combinaciones vigentes talle × color: se traduce la clave estable
      // (_key) al nombre final del color.
      const stockBySize: Record<string, number> = {};
      sizes.forEach(size => {
        colors.forEach((color, i) => {
          stockBySize[stockKey(size, cleanColors[i].name)] = stock[stockKey(size, color._key)] ?? 0;
        });
      });

      const origNum = originalPrice === null ? NaN : Math.round(originalPrice);

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

      const ok = await onSave(p, modoGuardadoStock(product?.stockBySize ?? null, stockBySize));
      if (ok === false) return;
      toast.success(product ? 'Producto actualizado' : 'Producto creado');
    } finally {
      setGuardando(false);
    }
  };

  const cancelar = () => {
    if (sucio && !window.confirm('Tenés cambios sin guardar. ¿Descartarlos?')) return;
    onClose();
  };

  const idForm = 'producto-form';
  const coloresConError = new Set(errores.colors?.keys ?? []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Dialogo
      abierto
      titulo={product ? 'Editar producto' : 'Nuevo producto'}
      descripcion={product ? product.name : undefined}
      alCerrar={onClose}
      ocupado={guardando}
      sucio={sucio}
      ancho="xl"
      pie={(
        <>
          <Boton variante="secundario" onClick={cancelar} disabled={guardando}>Cancelar</Boton>
          <Boton type="submit" form={idForm} disabled={uploading} cargando={guardando}>
            {uploading ? 'Subiendo fotos…' : product ? 'Guardar cambios' : 'Crear producto'}
          </Boton>
        </>
      )}
    >
      {/* Un <form> de verdad: Enter en nombre, SKU o precios guarda. Los campos que
          "agregan" (talle, URL de foto) y la grilla de stock atajan su Enter. */}
      <form
        id={idForm}
        ref={formRef}
        noValidate
        onSubmit={e => { e.preventDefault(); void handleSave(); }}
        className="space-y-7"
      >
        {/* ── 1. DATOS ─────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <SectionTitle>Datos</SectionTitle>
          <Campo etiqueta="Nombre" requerido error={errores.name}>
            <Entrada
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); limpiarError('name'); }}
              placeholder="Ej: Remera Dink Master"
              data-error={errores.name ? 'true' : undefined}
              className={errores.name ? claseConError : undefined}
            />
          </Campo>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo etiqueta="SKU">
              <Entrada
                type="text"
                value={sku}
                onChange={e => setSku(e.target.value)}
                placeholder="Ej: VOL-REM-001"
                autoCapitalize="characters"
                autoComplete="off"
              />
            </Campo>
            <Campo etiqueta="Categoría">
              <Selector value={category} onChange={e => setCategory(e.target.value)}>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Selector>
            </Campo>
          </div>
          <Campo etiqueta="Descripción">
            <AreaTexto
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Contale al cliente qué hace especial a este producto…"
              className="resize-y"
            />
          </Campo>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo etiqueta="Precio (UYU)" requerido error={errores.price} ayuda={price === null ? 'Ej: 1.290 (el punto separa los miles)' : undefined}>
              <EntradaPlata
                valor={price}
                alCambiar={v => { setPrice(v); limpiarError('price'); }}
                placeholder="0"
                data-error={errores.price ? 'true' : undefined}
                className={errores.price ? claseConError : undefined}
              />
            </Campo>
            <Campo etiqueta="Precio original" ayuda="Opcional: se muestra tachado junto al precio de oferta.">
              <EntradaPlata valor={originalPrice} alCambiar={setOriginalPrice} placeholder="—" />
            </Campo>
          </div>
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 px-4 py-1">
            <Interruptor activo={active} alCambiar={setActive} etiqueta="Activo" descripcion="Visible en la tienda" />
            <Interruptor activo={isFeatured} alCambiar={setIsFeatured} etiqueta="Destacado" descripcion="Aparece en la página de inicio" />
            <Interruptor activo={isOffer} alCambiar={setIsOffer} etiqueta="Oferta" descripcion="Se marca como oferta en la tienda" />
          </div>
        </section>

        {/* ── 2. FOTOS ─────────────────────────────────────────────────── */}
        <section className="space-y-4 border-t border-gray-100 pt-6">
          <SectionTitle ayuda="La primera es la principal. Ordenalas con las flechas.">Fotos</SectionTitle>
          {/* Los controles de cada foto están SIEMPRE a la vista: antes aparecían con
              hover, y en el celular (sin hover) no había forma de ordenar ni quitar. */}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {images.map((img, i) => (
              <li key={`${img}-${i}`} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                <div className="relative aspect-square bg-gray-50">
                  <img src={img} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
                  {i === 0 && (
                    <span className="absolute left-2 top-2 rounded-md bg-navy-700 px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-wide text-lime-400">
                      Principal
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-gray-100">
                  <BotonIcono
                    etiqueta="Mover antes"
                    icono={<ChevronLeft size={18} />}
                    onClick={() => moveImage(i, -1)}
                    disabled={i === 0}
                  />
                  <BotonIcono
                    etiqueta={`Quitar foto ${i + 1}`}
                    icono={<Trash2 size={17} />}
                    tono="peligro"
                    onClick={() => removeImage(i)}
                  />
                  <BotonIcono
                    etiqueta="Mover después"
                    icono={<ChevronRight size={18} />}
                    onClick={() => moveImage(i, 1)}
                    disabled={i === images.length - 1}
                  />
                </div>
              </li>
            ))}
            <li>
              {/* Input adentro del <label>: es lo que iOS abre siempre (sr-only, no
                  hidden, para que se llegue con Tab). */}
              <label
                className={cn(
                  'flex h-full min-h-[140px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 p-3 text-center font-display text-sm font-bold text-navy-700 transition-colors focus-within:border-navy-700',
                  uploading ? 'cursor-wait opacity-60' : 'cursor-pointer hover:border-navy-700 hover:bg-navy-50',
                )}
              >
                {uploading ? <Upload size={22} className="animate-pulse" /> : <ImagePlus size={22} />}
                {uploading ? `Subiendo ${uploadingCount}…` : 'Subir fotos'}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploading}
                  onChange={e => void handleFiles(e)}
                  className="sr-only"
                />
              </label>
            </li>
          </ul>
          <div className="flex gap-2">
            <Entrada
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoComplete="off"
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addImageUrl();
                }
              }}
              placeholder="O pegá una URL de imagen"
              aria-label="URL de una foto"
            />
            <Boton variante="secundario" onClick={addImageUrl} disabled={imageUrl.trim() === ''} className="shrink-0">
              Agregar
            </Boton>
          </div>
        </section>

        {/* ── 3. TALLES ────────────────────────────────────────────────── */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <SectionTitle>Talles</SectionTitle>
          {sizes.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {sizes.map(size => (
                <li
                  key={size}
                  className="inline-flex h-11 items-center rounded-lg border border-navy-200 bg-navy-50 pl-3.5 font-display text-sm font-bold text-navy-700"
                >
                  {size}
                  <button
                    type="button"
                    onClick={() => removeSize(size)}
                    aria-label={`Quitar talle ${size}`}
                    title={`Quitar talle ${size}`}
                    className="ml-0.5 flex h-11 w-10 items-center justify-center rounded-r-lg text-navy-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <X size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Entrada
              type="text"
              value={newSize}
              onChange={e => setNewSize(e.target.value)}
              onKeyDown={handleSizeKeyDown}
              placeholder="Escribí un talle y Enter"
              aria-label="Talle nuevo"
              enterKeyHint="enter"
              autoComplete="off"
              aria-invalid={errores.sizes ? true : undefined}
              data-error={errores.sizes ? 'true' : undefined}
              className={errores.sizes ? claseConError : undefined}
            />
            <Boton variante="secundario" onClick={() => addSize(newSize)} disabled={newSize.trim() === ''} className="shrink-0">
              Agregar
            </Boton>
          </div>
          {errores.sizes && <MensajeError>{errores.sizes}</MensajeError>}
          <div className="flex flex-wrap gap-2">
            {SIZE_SUGGESTIONS.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => addSize(s)}
                disabled={sizes.includes(s)}
                className="inline-flex h-9 items-center rounded-full border border-gray-300 bg-white px-3.5 text-[13px] font-semibold text-gray-700 transition-colors hover:border-navy-700 hover:text-navy-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
              >
                + {s}
              </button>
            ))}
          </div>
        </section>

        {/* ── 4. COLORES ───────────────────────────────────────────────── */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <SectionTitle>Colores</SectionTitle>
          {colors.length > 0 && (
            <ul className="space-y-2">
              {colors.map((color, i) => {
                const conError = coloresConError.has(color._key);
                return (
                  // key = _key estable: con el índice, al quitar un color del medio los
                  // inputs de abajo se quedaban con el estado (foco, cursor) del de arriba.
                  <li key={color._key} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={color.hex || '#1a1a1a'}
                      onChange={e => setColorHex(i, e.target.value)}
                      aria-label={`Tono de ${color.name.trim() || 'este color'}`}
                      title="Elegí el color"
                      className="h-11 w-11 shrink-0 cursor-pointer rounded-lg border border-gray-300 bg-white p-1"
                    />
                    <Entrada
                      type="text"
                      value={color.name}
                      onChange={e => renameColor(i, e.target.value)}
                      // Enter acá no guarda el producto: se está nombrando un color, no terminando.
                      onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                      placeholder="Nombre del color (ej: Azul marino)"
                      aria-label={`Nombre del color ${i + 1}`}
                      autoComplete="off"
                      aria-invalid={conError ? true : undefined}
                      data-error={conError ? 'true' : undefined}
                      className={conError ? claseConError : undefined}
                    />
                    <BotonIcono
                      etiqueta={`Quitar color ${color.name.trim() || i + 1}`}
                      icono={<Trash2 size={18} />}
                      tono="peligro"
                      onClick={() => removeColor(i)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {errores.colors && <MensajeError>{errores.colors.mensaje}</MensajeError>}
          <Boton
            variante="secundario"
            onClick={addColor}
            icono={<Plus size={16} />}
            data-error={errores.colors && colors.length === 0 ? 'true' : undefined}
          >
            Agregar color
          </Boton>
        </section>

        {/* ── 5. STOCK ─────────────────────────────────────────────────── */}
        <section className="space-y-3 border-t border-gray-100 pt-6">
          <SectionTitle
            ayuda={sizes.length > 0 && colors.length > 0
              ? <>Unidades por talle y color.<span className="hidden sm:inline"> Enter baja a la celda de abajo.</span></>
              : undefined}
          >
            Stock
          </SectionTitle>
          {sizes.length === 0 || colors.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 px-4 py-5 text-center text-sm text-gray-500">
              Agregá al menos un talle y un color para cargar el stock por combinación.
            </p>
          ) : (
            <>
              {/* border-separate: con border-collapse la columna fija (sticky) pierde
                  el borde y el contenido que pasa por debajo se transparenta. */}
              <div className="overflow-x-auto overscroll-x-contain rounded-xl border border-gray-200">
                <table ref={tablaStockRef} className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="sticky left-0 z-10 border-b border-r border-gray-200 bg-gray-50 px-3 py-2.5 text-left font-display text-[12px] font-bold uppercase tracking-wide text-gray-600">
                        Talle
                      </th>
                      {colors.map(color => (
                        <th key={color._key} scope="col" className="border-b border-gray-200 bg-gray-50 px-2 py-2.5 font-semibold text-navy-700">
                          <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                            <span
                              aria-hidden
                              className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-gray-300"
                              style={{ backgroundColor: color.hex || '#1a1a1a' }}
                            />
                            {color.name.trim() || 'Sin nombre'}
                          </div>
                        </th>
                      ))}
                      <th scope="col" className="border-b border-l border-gray-200 bg-gray-50 px-3 py-2.5 text-right font-display text-[12px] font-bold uppercase tracking-wide text-gray-600">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sizes.map((size, fila) => {
                      const totalFila = colors.reduce((acc, c) => acc + (stock[stockKey(size, c._key)] ?? 0), 0);
                      return (
                        <tr key={size}>
                          <th
                            scope="row"
                            className={cn(
                              'sticky left-0 z-10 border-r border-gray-200 bg-white px-3 py-1.5 text-left font-display font-bold text-navy-700',
                              fila > 0 && 'border-t border-t-gray-100',
                            )}
                          >
                            {size}
                          </th>
                          {colors.map((color, col) => {
                            const key = stockKey(size, color._key);
                            const cantidad = stock[key] ?? 0;
                            return (
                              <td key={color._key} className={cn('px-2 py-1.5 text-center', fila > 0 && 'border-t border-gray-100')}>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  autoComplete="off"
                                  enterKeyHint="next"
                                  value={cantidad}
                                  data-fila={fila}
                                  data-col={col}
                                  aria-label={`Stock talle ${size}, color ${color.name.trim() || col + 1}`}
                                  onFocus={e => e.currentTarget.select()}
                                  onChange={e => setStockValue(key, e.target.value.replace(/\D/g, ''))}
                                  onKeyDown={e => siguienteCeldaStock(e, fila, col)}
                                  className={cn(
                                    'h-11 w-16 rounded-lg border border-gray-300 bg-white text-center text-base tabular-nums transition-[border-color,box-shadow] focus:border-navy-700 focus:outline-none focus:ring-2 focus:ring-navy-700/15 sm:text-sm',
                                    cantidad > 0 ? 'font-semibold text-navy-700' : 'text-gray-400',
                                  )}
                                />
                              </td>
                            );
                          })}
                          <td className={cn('border-l border-gray-200 px-3 text-right font-semibold tabular-nums text-gray-600', fila > 0 && 'border-t border-t-gray-100')}>
                            {totalFila}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-sm font-semibold text-navy-700">
                Total: <span className="tabular-nums">{totalStock}</span> {totalStock === 1 ? 'unidad' : 'unidades'}
              </p>
            </>
          )}
        </section>
      </form>
    </Dialogo>
  );
}
