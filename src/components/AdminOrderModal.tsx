import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Trash2, X, Save, RotateCcw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { Product, CartItem, Order, CustomerInfo } from '../types';

const formatPrice = (n: number) => '$ ' + n.toLocaleString('es-UY', { maximumFractionDigits: 0 });

const inputClass =
  'w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors';
const labelClass = 'block text-sm font-semibold text-navy-700 mb-1';

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

  // Total editable
  const [totalStr, setTotalStr] = useState('0');
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
    if (!totalEdited) setTotalStr(String(autoTotal));
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
    setTotalStr(String(autoTotal));
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
    const parsedTotal = parseFloat(totalStr.replace(',', '.'));
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
      total: isNaN(parsedTotal) ? autoTotal : parsedTotal,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    onSave(order);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="font-display text-xl font-bold text-navy-700">Nuevo pedido</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy-700 transition-colors">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Cliente */}
          <section className="space-y-4">
            <h3 className="font-display text-lg font-bold text-navy-700">Cliente</h3>
            <div>
              <label className={labelClass}>Nombre *</label>
              <input
                type="text"
                value={customer.name}
                onChange={e => setCustomerField('name', e.target.value)}
                placeholder="Nombre y apellido"
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Teléfono</label>
                <input
                  type="tel"
                  value={customer.phone}
                  onChange={e => setCustomerField('phone', e.target.value)}
                  placeholder="099 123 456"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  value={customer.email}
                  onChange={e => setCustomerField('email', e.target.value)}
                  placeholder="cliente@email.com"
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>Dirección</label>
              <input
                type="text"
                value={customer.address}
                onChange={e => setCustomerField('address', e.target.value)}
                placeholder="Calle y número"
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Ciudad</label>
                <input
                  type="text"
                  value={customer.city}
                  onChange={e => setCustomerField('city', e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Departamento</label>
                <input
                  type="text"
                  value={customer.department}
                  onChange={e => setCustomerField('department', e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>Notas</label>
              <input
                type="text"
                value={customer.notes}
                onChange={e => setCustomerField('notes', e.target.value)}
                placeholder="Ej: vino por Instagram, retira en persona"
                className={inputClass}
              />
            </div>
          </section>

          {/* Productos */}
          <section className="space-y-4">
            <h3 className="font-display text-lg font-bold text-navy-700">Productos</h3>

            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-4">
              <div>
                <label className={labelClass}>Producto</label>
                <select
                  value={productId}
                  onChange={e => handleProductChange(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Elegí un producto…</option>
                  {availableProducts.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatPrice(p.price)}
                    </option>
                  ))}
                </select>
              </div>

              {selectedProduct && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {selectedProduct.sizes.length > 0 && (
                    <div>
                      <label className={labelClass}>Talle</label>
                      <select value={size} onChange={e => setSize(e.target.value)} className={inputClass}>
                        {selectedProduct.sizes.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {selectedProduct.colors.length > 0 && (
                    <div>
                      <label className={labelClass}>Color</label>
                      <select value={color} onChange={e => setColor(e.target.value)} className={inputClass}>
                        {selectedProduct.colors.map(c => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className={labelClass}>Cantidad</label>
                    <input
                      type="number"
                      min={1}
                      value={qtyStr}
                      onChange={e => setQtyStr(e.target.value)}
                      className={inputClass}
                    />
                    {stock !== null && (
                      <p className="text-xs text-gray-500 mt-1">Stock: {stock}</p>
                    )}
                  </div>
                </div>
              )}

              {stockWarning && (
                <div className="bg-amber-50 border-l-4 border-amber-400 px-4 py-3 rounded-r-lg flex items-start gap-3 text-sm text-amber-800">
                  <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
                  <p>Sin stock suficiente — se registra igual</p>
                </div>
              )}

              <button
                type="button"
                onClick={handleAddItem}
                disabled={!selectedProduct}
                className="bg-navy-700 hover:bg-navy-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-display font-semibold py-3 px-6 rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus size={18} /> Agregar
              </button>
            </div>

            {/* Items agregados */}
            {items.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Todavía no agregaste productos al pedido.</p>
            ) : (
              <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
                {items.map((it, index) => (
                  <li
                    key={`${it.product.id}|${it.selectedSize}|${it.selectedColor}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 bg-white"
                  >
                    <div className="min-w-0">
                      <p className="font-display font-semibold text-navy-700 text-sm truncate">{it.product.name}</p>
                      <p className="text-xs text-gray-500">
                        {[it.selectedSize, it.selectedColor].filter(Boolean).join(' / ') || 'Único'}
                        {' · '}x{it.quantity}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-sm font-bold text-navy-700">
                        {formatPrice(it.product.price * it.quantity)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(index)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        title="Quitar"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Total */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={labelClass + ' mb-0'}>Total</label>
              <span className="text-xs text-gray-500">Calculado: {formatPrice(autoTotal)}</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                step="any"
                value={totalStr}
                onChange={e => {
                  setTotalStr(e.target.value);
                  setTotalEdited(true);
                }}
                className={inputClass}
              />
              <button
                type="button"
                onClick={handleRecalculate}
                className="flex-shrink-0 bg-gray-100 hover:bg-gray-200 text-navy-700 font-display font-semibold py-3 px-4 rounded-lg transition-colors flex items-center gap-2"
                title="Restaurar el total calculado"
              >
                <RotateCcw size={16} /> Recalcular
              </button>
            </div>
            {totalEdited && (
              <p className="text-xs text-gray-500">Editaste el total a mano — no se actualiza solo al cambiar los productos.</p>
            )}
          </section>

          {/* Acciones */}
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
              className="flex-1 bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Save size={18} /> Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
