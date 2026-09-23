import { useState } from 'react';
import { Search, Edit, Package, Tag, Check, AlertCircle, ChevronDown, XCircle } from 'lucide-react';
import type { Product } from '../types';
import { urlImagen } from '../utils/imagenes';
import { formatPrice } from '../lib/formato';
import { FALLBACK_IMG, errorFoto } from '../lib/fotos';

// ─── 12b. StockDashboard ─────────────────────────────────────────────────────

type StockFilter = 'all' | 'low' | 'out';

export function StockDashboard({ products, onEdit }: { products: Product[]; onEdit: (p: Product) => void }) {
  const [filter, setFilter] = useState<StockFilter>('all');
  const [search, setSearch] = useState('');
  const threshold = 3;

  // Per-product variant breakdown
  const enriched = products.map((p) => {
    const variants = Object.entries(p.stockBySize).map(([key, qty]) => {
      const [size, color] = key.split('|');
      return { key, size, color: color || 'Único', qty };
    });
    const lowVariants = variants.filter((v) => v.qty > 0 && v.qty <= threshold);
    const outVariants = variants.filter((v) => v.qty <= 0);
    const totalUnits = variants.reduce((s, v) => s + Math.max(0, v.qty), 0);
    return { product: p, variants, lowVariants, outVariants, totalUnits };
  });

  const totalUnits = enriched.reduce((s, e) => s + e.totalUnits, 0);
  const totalVariants = enriched.reduce((s, e) => s + e.variants.length, 0);
  const totalLow = enriched.reduce((s, e) => s + e.lowVariants.length, 0);
  const totalOut = enriched.reduce((s, e) => s + e.outVariants.length, 0);

  const filteredProducts = enriched
    .filter((e) => {
      if (search && !e.product.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === 'low') return e.lowVariants.length > 0;
      if (filter === 'out') return e.outVariants.length > 0;
      return true;
    })
    .sort((a, b) => {
      // Sort by urgency: out > low > healthy
      const score = (e: typeof a) => e.outVariants.length * 10 + e.lowVariants.length;
      return score(b) - score(a);
    });

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Stock &amp; Alertas</h1>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Unidades Totales" value={totalUnits} color="bg-green-50 text-green-700" icon={<Package size={20} />} />
        <StatCard label="Variantes" value={totalVariants} color="bg-blue-50 text-blue-700" icon={<Tag size={20} />} />
        <StatCard label="Bajo Stock (≤3)" value={totalLow} color="bg-yellow-50 text-yellow-700" icon={<AlertCircle size={20} />} />
        <StatCard label="Sin Stock" value={totalOut} color="bg-red-50 text-red-700" icon={<XCircle size={20} />} />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none text-sm"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'low', 'out'] as StockFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg font-display text-sm font-semibold transition-colors ${
                filter === f ? 'bg-navy-700 text-lime-400' : 'bg-gray-100 text-navy-700 hover:bg-gray-200'
              }`}
            >
              {f === 'all' ? 'Todos' : f === 'low' ? 'Bajo stock' : 'Sin stock'}
            </button>
          ))}
        </div>
      </div>

      {/* Product list */}
      {filteredProducts.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center text-gray-400">
          <Check size={48} className="mx-auto mb-3 text-green-400" />
          <p className="font-display">
            {filter === 'out'
              ? '¡Ningún producto sin stock!'
              : filter === 'low'
              ? '¡Sin alertas de bajo stock!'
              : 'No se encontraron productos'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredProducts.map(({ product, variants, lowVariants, outVariants, totalUnits }) => (
            <StockProductRow
              key={product.id}
              product={product}
              variants={variants}
              lowVariants={lowVariants}
              outVariants={outVariants}
              totalUnits={totalUnits}
              threshold={threshold}
              onEdit={() => onEdit(product)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: number | string; color: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${color}`}>{icon}</div>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="font-display text-2xl font-bold text-navy-700">{value}</p>
    </div>
  );
}

interface StockVariantInfo {
  key: string;
  size: string;
  color: string;
  qty: number;
}

function StockProductRow({
  product,
  variants,
  lowVariants,
  outVariants,
  totalUnits,
  threshold,
  onEdit,
}: {
  product: Product;
  variants: StockVariantInfo[];
  lowVariants: StockVariantInfo[];
  outVariants: StockVariantInfo[];
  totalUnits: number;
  threshold: number;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasAlert = lowVariants.length > 0 || outVariants.length > 0;

  return (
    <div className={`bg-white rounded-xl shadow-sm border overflow-hidden ${hasAlert ? 'border-yellow-200' : 'border-gray-100'}`}>
      <div className="p-4 flex items-center gap-4">
        <img
          src={product.images[0] ? urlImagen(product.images[0], 160) : FALLBACK_IMG}
          alt={product.name}
          className="w-16 h-16 object-cover rounded-lg flex-shrink-0"
          onError={errorFoto(product.images[0])}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-bold text-navy-700">{product.name}</h3>
            {outVariants.length > 0 && (
              <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                {outVariants.length} sin stock
              </span>
            )}
            {lowVariants.length > 0 && (
              <span className="bg-yellow-100 text-yellow-800 text-xs font-semibold px-2 py-0.5 rounded-full">
                {lowVariants.length} bajo stock
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {variants.length} variantes · {totalUnits} unidades · {formatPrice(product.price)}
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-navy-700 hover:text-lime-500 p-2 transition-colors"
        >
          <ChevronDown size={20} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        <button
          onClick={onEdit}
          className="text-xs text-navy-700 hover:text-lime-500 font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          title="Editar producto y stock"
        >
          Editar <Edit size={12} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 font-display text-xs font-semibold text-gray-500 uppercase">Variante</th>
                <th className="text-left px-4 py-2 font-display text-xs font-semibold text-gray-500 uppercase">Color</th>
                <th className="text-right px-4 py-2 font-display text-xs font-semibold text-gray-500 uppercase">Cantidad</th>
                <th className="text-left px-4 py-2 font-display text-xs font-semibold text-gray-500 uppercase">Estado</th>
              </tr>
            </thead>
            <tbody>
              {variants
                .slice()
                .sort((a, b) => a.qty - b.qty)
                .map((v) => {
                  const isOut = v.qty <= 0;
                  const isLow = v.qty > 0 && v.qty <= threshold;
                  return (
                    <tr key={v.key} className={`border-t border-gray-100 ${isOut ? 'bg-red-50/50' : isLow ? 'bg-yellow-50/50' : ''}`}>
                      <td className="px-4 py-2 font-semibold text-navy-700">{v.size}</td>
                      <td className="px-4 py-2 text-gray-600">{v.color}</td>
                      <td className="px-4 py-2 text-right font-display font-bold tabular-nums">{v.qty}</td>
                      <td className="px-4 py-2">
                        {isOut ? (
                          <span className="inline-flex items-center gap-1 text-red-700 text-xs font-semibold">
                            <XCircle size={14} /> Sin stock
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center gap-1 text-yellow-700 text-xs font-semibold">
                            <AlertCircle size={14} /> Bajo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-green-700 text-xs font-semibold">
                            <Check size={14} /> OK
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
