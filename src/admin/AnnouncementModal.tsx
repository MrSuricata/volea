import { useState } from 'react';
import { X, Save } from 'lucide-react';
import type { Announcement } from '../types';

// ─── AnnouncementModal ───────────────────────────────────────────────────────

export function AnnouncementModal({
  announcement, onClose, onSave
}: {
  announcement: Announcement | null;
  onClose: () => void;
  onSave: (a: Announcement) => void;
}) {
  const [form, setForm] = useState<Announcement>(
    announcement || {
      id: `ann-${Date.now()}`,
      title: '',
      content: '',
      type: 'info',
      active: true,
      createdAt: new Date().toISOString().split('T')[0],
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="font-display text-xl font-bold text-navy-700">
            {announcement ? 'Editar Anuncio' : 'Nuevo Anuncio'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy-700 transition-colors">
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-1">Título *</label>
            <input
              type="text"
              required
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-1">Contenido *</label>
            <textarea
              rows={4}
              required
              value={form.content}
              onChange={e => setForm({ ...form, content: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Tipo</label>
              <select
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value as Announcement['type'] })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors bg-white"
              >
                <option value="info">Información</option>
                <option value="promo">Promoción</option>
                <option value="event">Evento</option>
                <option value="important">Importante</option>
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={e => setForm({ ...form, active: e.target.checked })}
                  className="w-4 h-4 text-lime-400 border-gray-300 rounded focus:ring-lime-400"
                />
                <span className="text-sm font-semibold text-navy-700">Activo</span>
              </label>
            </div>
          </div>

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
