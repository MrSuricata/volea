import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Trash2, Save, RotateCcw, AlertTriangle, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import type { Product, CartItem, Order, CustomerInfo } from '../types';
import { Boton, BotonIcono, Campo, Entrada, Selector, EntradaPlata, Dialogo, Plata, formatoPlata } from '../admin/ui';

const emptyCustomer = (): CustomerInfo => ({
  name: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  department: '',
  notes: '',
});

const variantKeyOf = (size: string, color: string) => (color ? `${size}|${color}` : size);

const ID_FORM = 'pedido-manual-form';

export function AdminOrderModal({ products, onSave, onClose }: {
  products: Product[];
  onSave: (order: Order) => void;
  onClose: () => void;
}) {
  const [customer, setCustomer] = useState<CustomerInfo>(emptyCustomer());
  const [items, setItems] = useState<CartItem[]>([]);

  // Agregador de productos
  const [productId, setProductId] = useState('');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [qtyStr, setQtyStr] = useState('1');

  // Total editable (null = campo vacío: al guardar se usa el calculado)
  const [total, setTotal] = useState<number | null>(0);
  const [totalEdited, setTotalEdited] = useState(false);

  const availableProducts = useMemo(
    () =>
      products
        .filter(p => p.active !== false)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [products]
  );

  const selectedProduct = useMemo(
    () => availableProducts.find(p => p.id === productId) ?? null,
    [availableProducts, productId]
  );

  const qty = Math.max(1, parseInt(qtyStr, 10) || 1);

  const stock = useMemo(() => {
    if (!selectedProduct) return null;
    const key = variantKeyOf(size, color);
    return selectedProduct.stockBySize[key] ?? 0;
  }, [selectedProduct, size, color]);

  const stockWarning = stock !== null && qty > stock;

  const autoTotal = useMemo(
    () => items.reduce((sum, it) => sum + it.product.price * it.quantity, 0),
    [items]
  );

  useEffect(() => {
    if (!totalEdited) setTotal(autoTotal);
  }, [autoTotal, totalEdited]);

  const handleProductChange = (id: string) => {
    setProductId(id);
    const p = availableProducts.find(prod => prod.id === id);
    setSize(p && p.sizes.length > 0 ? p.sizes[0] : '');
    setColor(p && p.colors.length > 0 ? p.colors[0].name : '');
    setQtyStr('1');
  };

  const handleAddItem = () => {
    if (!selectedProduct) {
      toast.error('Elegí un producto');
      return;
    }
    setItems(prev => {
      const idx = prev.findIndex(
        it =>
          it.product.id === selectedProduct.id &&
          it.selectedSize === size &&
          it.selectedColor === color
      );
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
        return next;
      }
      return [...prev, { product: selectedProduct, quantity: qty, selectedSize: size, selectedColor: color }];
    });
    setQtyStr('1');
  };

  const handleRemoveItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleRecalculate = () => {
    setTotalEdited(false);
    setTotal(autoTotal);
  };

  const setCustomerField = (field: keyof CustomerInfo, value: string) => {
    setCustomer(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const name = customer.name.trim();
    if (!name) {
      toast.error('Completá el nombre del cliente');
      return;
    }
    if (items.length === 0) {
      toast.error('Agregá al menos un producto');
      return;
    }
    const order: Order = {
      id: `VO-${Date.now().toString(36).toUpperCase()}`,
      items,
      customer: {
        name,
        phone: customer.phone.trim(),
        email: customer.email.trim(),
        address: customer.address.trim(),
        city: customer.city.trim(),
        department: customer.department.trim(),
        notes: customer.notes.trim(),
      },
      total: total ?? autoTotal,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    onSave(order);
  };

  // Un pedido a medio tipear no se pierde por tocar afuera: el Dialogo pregunta.
  const sucio = items.length > 0 || Object.values(customer).some(v => v.trim() !== '');

  return (
    <Dialogo
      abierto
      titulo="Nuevo pedido"
      descripcion="Para los pedidos que llegan por WhatsApp, Instagram o en persona."
      alCerrar={onClose}
      sucio={sucio}
      ancho="lg"
      pie={(
        <>
          <Boton variante="secundario" onClick={onClose}>Cancelar</Boton>
          <Boton type="submit" form={ID_FORM} icono={<Save size={17} />}>
            {items.length > 0 ? `Guardar pedido · ${formatoPlata(total ?? autoTotal)}` : 'Guardar pedido'}
          </Boton>
        </>
      )}
    >
      <form id={ID_FORM} onSubmit={handleSubmit} className="space-y-7">
        {/* Cliente */}
        <section className="space-y-4">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy-700">Cliente</h3>
          <Campo etiqueta="Nombre" requerido>
            <Entrada
              type="text"
              value={customer.name}
              onChange={e => setCustomerField('name', e.target.value)}
              placeholder="Nombre y apellido"
              autoComplete="off"
            />
          </Campo>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo etiqueta="Teléfono">
              <Entrada
                type="tel"
                inputMode="tel"
                value={customer.phone}
                onChange={e => setCustomerField('phone', e.target.value)}
                placeholder="099 123 456"
              />
            </Campo>
            <Campo etiqueta="Email">
              <Entrada
                type="email"
                value={customer.email}
                onChange={e => setCustomerField('email', e.target.value)}
                placeholder="cliente@email.com"
              />
            </Campo>
          </div>
          <Campo etiqueta="Dirección">
            <Entrada
              type="text"
              value={customer.address}
              onChange={e => setCustomerField('address', e.target.value)}
              placeholder="Calle y número"
            />
          </Campo>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo etiqueta="Ciudad">
              <Entrada
                type="text"
                value={customer.city}
                onChange={e => setCustomerField('city', e.target.value)}
              />
            </Campo>
            <Campo etiqueta="Departamento">
              <Entrada
                type="text"
                value={customer.department}
                onChange={e => setCustomerField('department', e.target.value)}
              />
            </Campo>
          </div>
          <Campo etiqueta="Notas">
            <Entrada
              type="text"
              value={customer.notes}
              onChange={e => setCustomerField('notes', e.target.value)}
              placeholder="Ej: vino por Instagram, retira en persona"
            />
          </Campo>
        </section>

        {/* Productos */}
        <section className="space-y-4">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy-700">Productos</h3>

          <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <Campo etiqueta="Producto">
              <Selector value={productId} onChange={e => handleProductChange(e.target.value)}>
                <option value="">Elegí un producto…</option>
                {availableProducts.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatoPlata(p.price)}
                  </option>
                ))}
              </Selector>
            </Campo>

            {selectedProduct && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {selectedProduct.sizes.length > 0 && (
                  <Campo etiqueta="Talle">
                    <Selector value={size} onChange={e => setSize(e.target.value)}>
                      {selectedProduct.sizes.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </Selector>
                  </Campo>
                )}
                {selectedProduct.colors.length > 0 && (
                  <Campo etiqueta="Color">
                    <Selector value={color} onChange={e => setColor(e.target.value)}>
                      {selectedProduct.colors.map(c => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </Selector>
                  </Campo>
                )}
                <Campo etiqueta="Cantidad" ayuda={stock !== null ? `Stock: ${stock}` : undefined}>
                  <Entrada
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={qtyStr}
                    onChange={e => setQtyStr(e.target.value)}
                    className="tabular-nums"
                  />
                </Campo>
              </div>
            )}

            {stockWarning && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                Sin stock suficiente: se registra igual.
              </p>
            )}

            <Boton variante="secundario" icono={<Plus size={17} />} onClick={handleAddItem} disabled={!selectedProduct}>
              Agregar al pedido
            </Boton>
          </div>

          {/* Items agregados */}
          {items.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center">
              <ShoppingBag size={20} className="mb-2 text-gray-400" />
              <p className="text-sm text-gray-500">Todavía no agregaste productos al pedido.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
              {items.map((it, index) => (
                <li
                  key={`${it.product.id}|${it.selectedSize}|${it.selectedColor}`}
                  className="flex items-center justify-between gap-3 py-2 pl-4 pr-1"
                >
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-bold text-navy-700">{it.product.name}</p>
                    <p className="text-xs text-gray-500">
                      {[it.selectedSize, it.selectedColor].filter(Boolean).join(' / ') || 'Único'}
                      {' · '}×{it.quantity}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Plata monto={it.product.price * it.quantity} className="text-sm font-bold text-navy-700" />
                    <BotonIcono
                      etiqueta={`Quitar ${it.product.name}`}
                      icono={<Trash2 size={17} />}
                      tono="peligro"
                      onClick={() => handleRemoveItem(index)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Total */}
        <section>
          <Campo
            etiqueta="Total"
            ayuda={totalEdited
              ? `Editaste el total a mano: no se actualiza solo al cambiar los productos. Calculado: ${formatoPlata(autoTotal)}.`
              : 'Se calcula con los precios de lista. Si hay descuento, cambialo acá.'}
          >
            <EntradaPlata
              valor={total}
              alCambiar={n => {
                setTotal(n);
                setTotalEdited(true);
              }}
            />
          </Campo>
          {totalEdited && (
            <Boton variante="fantasma" chico icono={<RotateCcw size={14} />} onClick={handleRecalculate} className="-ml-3 mt-1">
              Volver al total calculado ({formatoPlata(autoTotal)})
            </Boton>
          )}
        </section>
      </form>
    </Dialogo>
  );
}
