import { useMemo, useState } from 'react';
import { ChevronRight, Package, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Product } from '../../types';
import { useStore } from '../../tienda/store';
import { categoryLabel, getTotalStock } from '../../lib/formato';
import { FALLBACK_IMG, errorFoto } from '../../lib/fotos';
import { urlImagen } from '../../utils/imagenes';
import { sesionAdminVencida } from '../../services/authService';
import { BarraFiltros, Boton, BotonIcono, Chip, Confirmar, EncabezadoPagina, Insignia, Plata, Selector, Vacio } from '../ui';

// Productos: antes una tabla que en el celular escondía justo el stock y el "oculto" (lo
// que se mira en el mostrador), sin buscador, con íconos de 16px para editar/borrar.
// Ahora: buscador por nombre o SKU, filtros, fila tocable que abre el editor y, en compu,
// la tabla completa.

type Filtro = 'todos' | 'sin-stock' | 'ocultos' | 'destacados' | 'ofertas';

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function ProductosTab({ editar }: { editar: (p: Product | null) => void }) {
  const { products, categories, removeProduct } = useStore();
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [categoria, setCategoria] = useState('');
  const [aBorrar, setABorrar] = useState<Product | null>(null);
  const [borrando, setBorrando] = useState(false);

  const cuenta = useMemo(() => ({
    'sin-stock': products.filter((p) => getTotalStock(p) === 0).length,
    ocultos: products.filter((p) => p.active === false).length,
    destacados: products.filter((p) => p.isFeatured).length,
    ofertas: products.filter((p) => p.isOffer).length,
  }), [products]);

  const lista = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return products.filter((p) => {
      if (q && !normalizar(`${p.name} ${p.sku ?? ''}`).includes(q)) return false;
      if (categoria && p.category !== categoria) return false;
      if (filtro === 'sin-stock') return getTotalStock(p) === 0;
      if (filtro === 'ocultos') return p.active === false;
      if (filtro === 'destacados') return p.isFeatured;
      if (filtro === 'ofertas') return p.isOffer;
      return true;
    });
  }, [products, busqueda, filtro, categoria]);

  const borrar = async () => {
    if (!aBorrar) return;
    setBorrando(true);
    // Sesión vencida → no borrar ni local ni nube, avisar claro (mismo criterio que el editor).
    if (await sesionAdminVencida()) {
      setBorrando(false);
      setABorrar(null);
      toast.error('Tu sesión de admin venció — cerrá sesión y volvé a entrar. El producto NO se eliminó.');
      return;
    }
    removeProduct(aBorrar.id);
    setBorrando(false);
    setABorrar(null);
    toast.success('Producto eliminado');
  };

  const insignias = (p: Product) => (
    <>
      {p.active === false && <Insignia>Oculto</Insignia>}
      {p.isOffer && <Insignia tono="alerta">Oferta</Insignia>}
      {p.isFeatured && <Insignia tono="navy"><Star size={11} className="fill-current" aria-hidden /> Destacado</Insignia>}
    </>
  );

  const stock = (p: Product) => {
    const n = getTotalStock(p);
    return <Insignia tono={n === 0 ? 'alerta' : n <= 3 ? 'atencion' : 'bien'}>{n === 0 ? 'Sin stock' : `${n} u.`}</Insignia>;
  };

  return (
    <div>
      <EncabezadoPagina
        rotulo="Tienda"
        titulo="Productos"
        descripcion={`${products.length} en el catálogo`}
        acciones={<Boton icono={<Plus size={18} />} onClick={() => editar(null)}>Nuevo producto</Boton>}
      />

      <BarraFiltros
        busqueda={busqueda}
        alBuscar={setBusqueda}
        placeholder="Buscar por nombre o SKU"
        acciones={(
          <Selector value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Filtrar por categoría" className="hidden w-48 sm:block">
            <option value="">Todas las categorías</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Selector>
        )}
        chips={(
          <>
            <Chip activo={filtro === 'todos'} onClick={() => setFiltro('todos')} cantidad={products.length}>Todos</Chip>
            <Chip activo={filtro === 'sin-stock'} onClick={() => setFiltro('sin-stock')} cantidad={cuenta['sin-stock']}>Sin stock</Chip>
            <Chip activo={filtro === 'ocultos'} onClick={() => setFiltro('ocultos')} cantidad={cuenta.ocultos}>Ocultos</Chip>
            <Chip activo={filtro === 'destacados'} onClick={() => setFiltro('destacados')} cantidad={cuenta.destacados}>Destacados</Chip>
            <Chip activo={filtro === 'ofertas'} onClick={() => setFiltro('ofertas')} cantidad={cuenta.ofertas}>Ofertas</Chip>
          </>
        )}
      />
      {/* En el celular la categoría va abajo de los chips (arriba no entra al lado del buscador). */}
      <Selector value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Filtrar por categoría" className="mb-4 sm:hidden">
        <option value="">Todas las categorías</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Selector>

      {lista.length === 0 ? (
        <Vacio
          icono={<Package size={22} />}
          titulo={products.length === 0 ? 'Todavía no hay productos' : 'Nada con esos filtros'}
          descripcion={products.length === 0 ? undefined : 'Probá con otra búsqueda o sacá los filtros.'}
          accion={products.length === 0 ? <Boton icono={<Plus size={18} />} onClick={() => editar(null)}>Cargar el primero</Boton> : undefined}
        />
      ) : (
        <>
          {/* Celular: filas tocables (toda la fila abre el editor). */}
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white md:hidden">
            {lista.map((p) => (
              <li key={p.id} className="flex items-center">
                <button type="button" onClick={() => editar(p)} className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left active:bg-gray-50">
                  <img src={p.images[0] ? urlImagen(p.images[0], 160) : FALLBACK_IMG} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-gray-100 object-cover" onError={errorFoto(p.images[0])} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-navy-700">{p.name}</p>
                    <p className="mt-0.5 text-[13px] text-gray-500"><Plata monto={p.price} className="font-semibold text-navy-700" /> · {categoryLabel(categories, p.category)}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">{stock(p)}{insignias(p)}</div>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-gray-300" />
                </button>
                <BotonIcono etiqueta={`Eliminar ${p.name}`} icono={<Trash2 size={17} />} tono="peligro" className="mr-1" onClick={() => setABorrar(p)} />
              </li>
            ))}
          </ul>

          {/* Compu: tabla. */}
          <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left">
                <tr className="font-display text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3">Categoría</th>
                  <th className="px-4 py-3 text-right">Precio</th>
                  <th className="px-4 py-3">Stock</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="w-28 px-2 py-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lista.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      {/* Foto y nombre abren el editor (pedido de Brian 2026-08-06). */}
                      <button type="button" onClick={() => editar(p)} className="flex items-center gap-3 text-left">
                        <img src={p.images[0] ? urlImagen(p.images[0], 160) : FALLBACK_IMG} alt="" className="h-11 w-11 shrink-0 rounded-lg bg-gray-100 object-cover" onError={errorFoto(p.images[0])} />
                        <span className="min-w-0">
                          <span className="block font-semibold text-navy-700 hover:underline">{p.name}</span>
                          {p.sku?.trim() && <span className="block font-mono text-xs text-gray-500">{p.sku}</span>}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{categoryLabel(categories, p.category)}</td>
                    <td className="px-4 py-2.5 text-right"><Plata monto={p.price} className="font-semibold text-navy-700" /></td>
                    <td className="px-4 py-2.5">{stock(p)}</td>
                    <td className="px-4 py-2.5"><div className="flex flex-wrap gap-1">{insignias(p)}</div></td>
                    <td className="px-2 py-1">
                      <div className="flex justify-end">
                        <BotonIcono etiqueta={`Editar ${p.name}`} icono={<Pencil size={17} />} onClick={() => editar(p)} />
                        <BotonIcono etiqueta={`Eliminar ${p.name}`} icono={<Trash2 size={17} />} tono="peligro" onClick={() => setABorrar(p)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Confirmar
        abierto={aBorrar !== null}
        titulo={`¿Eliminar "${aBorrar?.name ?? ''}"?`}
        mensaje="Se borra de la tienda y del catálogo. Esta acción no se puede deshacer. Si solo querés que no se vea, ocultalo desde el editor."
        textoConfirmar="Eliminar producto"
        cargando={borrando}
        alConfirmar={() => void borrar()}
        alCerrar={() => setABorrar(null)}
      />
    </div>
  );
}
