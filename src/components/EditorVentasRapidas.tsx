import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { VentaRapida } from '../utils/caja';
import { normalizarVentasRapidas } from '../utils/caja';
import { SupabaseService } from '../services/supabaseService';

// Editor de los botones de "Lo de siempre" (kiosco): nombre, emoji, precio y promo "N por $X".
type Fila = { emoji: string; nombre: string; precio: string; promoCant: string; promoPrecio: string };

const aFila = (v: VentaRapida): Fila => ({
  emoji: v.emoji, nombre: v.nombre, precio: String(v.precio),
  promoCant: v.promo ? String(v.promo.cantidad) : '', promoPrecio: v.promo ? String(v.promo.precio) : '',
});

const campo = 'min-h-[40px] rounded-lg border border-gray-300 bg-white px-2 text-sm text-navy-700 focus:border-navy-700 focus:outline-none';

export default function EditorVentasRapidas({ actuales, onListo }: { actuales: VentaRapida[]; onListo: (nuevas: VentaRapida[] | null) => void }) {
  const [filas, setFilas] = useState<Fila[]>(() => actuales.map(aFila));
  const [guardando, setGuardando] = useState(false);
  const cambiar = (i: number, cambio: Partial<Fila>) => setFilas((f) => f.map((x, j) => (j === i ? { ...x, ...cambio } : x)));
  const mover = (i: number, d: -1 | 1) => setFilas((f) => {
    const j = i + d;
    if (j < 0 || j >= f.length) return f;
    const c = [...f];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  });

  async function guardar() {
    const sinPrecio = filas.find((f) => f.nombre.trim() && f.precio.trim() === '');
    if (sinPrecio) { toast.error(`Falta el precio de ${sinPrecio.nombre.trim()}`); return; }
    const items = filas.map((f) => ({
      emoji: f.emoji, nombre: f.nombre, precio: Number(f.precio),
      ...(f.promoCant && f.promoPrecio ? { promo: { cantidad: Number(f.promoCant), precio: Number(f.promoPrecio) } } : {}),
    }));
    const limpias = normalizarVentasRapidas(items);
    if (!limpias) { toast.error('Cargá al menos un producto con nombre y precio'); return; }
    setGuardando(true);
    const ok = await SupabaseService.saveVentasRapidas(limpias);
    setGuardando(false);
    if (!ok) { toast.error('No se pudo guardar (¿sesión vencida?)'); return; }
    toast.success('Botones guardados');
    onListo(limpias);
  }

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <p className="text-[12px] text-gray-600">Promo: "2 por $30" = cantidad 2, precio 30. Dejala vacía si no hay.</p>
      {filas.map((f, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-white p-2 ring-1 ring-gray-200">
          <input aria-label="Emoji" value={f.emoji} onChange={(e) => cambiar(i, { emoji: e.target.value })} className={`${campo} w-12 text-center`} />
          <input aria-label="Nombre" value={f.nombre} onChange={(e) => cambiar(i, { nombre: e.target.value })} className={`${campo} min-w-[9rem] flex-1 basis-40`} placeholder="Nombre" />
          <input aria-label="Precio" inputMode="numeric" value={f.precio} onChange={(e) => cambiar(i, { precio: e.target.value.replace(/\D/g, '') })} className={`${campo} w-20`} placeholder="$" />
          <span className="text-[12px] text-gray-500">promo</span>
          <input aria-label="Promo cantidad" inputMode="numeric" value={f.promoCant} onChange={(e) => cambiar(i, { promoCant: e.target.value.replace(/\D/g, '') })} className={`${campo} w-12`} placeholder="2" />
          <span className="text-[12px] text-gray-500">por $</span>
          <input aria-label="Promo precio" inputMode="numeric" value={f.promoPrecio} onChange={(e) => cambiar(i, { promoPrecio: e.target.value.replace(/\D/g, '') })} className={`${campo} w-16`} placeholder="30" />
          <button type="button" aria-label="Subir" onClick={() => mover(i, -1)} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"><ArrowUp size={16} /></button>
          <button type="button" aria-label="Bajar" onClick={() => mover(i, 1)} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"><ArrowDown size={16} /></button>
          <button type="button" aria-label={`Quitar ${f.nombre}`} onClick={() => setFilas((x) => x.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-red-600 hover:bg-red-50"><Trash2 size={16} /></button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={() => setFilas((f) => [...f, { emoji: '🛒', nombre: '', precio: '', promoCant: '', promoPrecio: '' }])}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-bold text-navy-700 hover:border-navy-700">
          <Plus size={16} /> Agregar producto
        </button>
        <button type="button" disabled={guardando} onClick={() => void guardar()}
          className="inline-flex min-h-[40px] items-center rounded-lg bg-navy-700 px-4 text-sm font-bold text-white disabled:opacity-60">
          {guardando ? 'Guardando…' : 'Guardar botones'}
        </button>
        <button type="button" onClick={() => onListo(null)} className="inline-flex min-h-[40px] items-center rounded-lg px-3 text-sm font-bold text-gray-500 hover:bg-gray-100">
          Cancelar
        </button>
      </div>
    </div>
  );
}
