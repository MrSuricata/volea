import { useState } from 'react';
import { X, Save } from 'lucide-react';
import type { Club } from '../types';

// ─── ClubModal ───────────────────────────────────────────────────────────────

export function ClubModal({
  club, onClose, onSave
}: {
  club: Club | null;
  onClose: () => void;
  onSave: (c: Club) => void;
}) {
  const [form, setForm] = useState<Club>(
    club || {
      id: `club-${Date.now()}`,
      name: '',
      address: '',
      city: '',
      country: 'Uruguay',
      lat: -34.9,
      lng: -56.2,
      phone: '',
      instagram: '',
      hasPickleball: true,
      description: '',
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="font-display text-xl font-bold text-navy-700">
            {club ? 'Editar Club' : 'Nuevo Club'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy-700 transition-colors">
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-1">Nombre *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-1">Dirección *</label>
            <input
              type="text"
              required
              value={form.address}
              onChange={e => setForm({ ...form, address: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Ciudad *</label>
              <input
                type="text"
                required
                value={form.city}
                onChange={e => setForm({ ...form, city: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">País *</label>
              <select
                value={form.country}
                onChange={e => setForm({ ...form, country: e.target.value as 'Uruguay' | 'Argentina' | 'Chile' | 'Brasil' })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors bg-white"
              >
                <option value="Uruguay">🇺🇾 Uruguay</option>
                <option value="Argentina">🇦🇷 Argentina</option>
                <option value="Chile">🇨🇱 Chile</option>
                <option value="Brasil">🇧🇷 Brasil</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Latitud *</label>
              <input
                type="number"
                step="any"
                required
                value={form.lat}
                onChange={e => setForm({ ...form, lat: Number(e.target.value) })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Longitud *</label>
              <input
                type="number"
                step="any"
                required
                value={form.lng}
                onChange={e => setForm({ ...form, lng: Number(e.target.value) })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Teléfono</label>
              <input
                type="text"
                value={form.phone || ''}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Instagram</label>
              <input
                type="text"
                value={form.instagram || ''}
                onChange={e => setForm({ ...form, instagram: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
                placeholder="sin @"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-1">Descripción</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors resize-none"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.hasPickleball}
              onChange={e => setForm({ ...form, hasPickleball: e.target.checked })}
              className="w-4 h-4 text-lime-400 border-gray-300 rounded focus:ring-lime-400"
            />
            <span className="text-sm font-semibold text-navy-700">Tiene canchas de pickleball</span>
          </label>

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
