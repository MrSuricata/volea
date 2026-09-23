import { useState } from 'react';
import { X, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { Event } from '../types';

// ─── EventModal ──────────────────────────────────────────────────────────────

export function EventModal({
  event, uploadImage, onClose, onSave
}: {
  event: Event | null;
  uploadImage: (f: File) => Promise<string | null>;
  onClose: () => void;
  onSave: (e: Event) => void;
}) {
  const [form, setForm] = useState<Event>(
    event || {
      id: `evt-${Date.now()}`,
      name: '',
      date: '',
      time: '',
      location: '',
      city: '',
      description: '',
      imageUrl: '',
      mapsUrl: '',
      maxParticipants: undefined,
      status: 'upcoming',
      category: 'tournament',
      phone: '',
      inscripcionesAbiertas: false,
      categorias: '',
    }
  );
  const [subiendo, setSubiendo] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  // Subir el flyer desde el celular: antes solo se podía pegar una URL, que en la
  // práctica significaba no poder poner la imagen.
  const handleArchivo = async (file: File | undefined) => {
    if (!file || subiendo) return;
    setSubiendo(true);
    try {
      const url = await uploadImage(file);
      if (!url) {
        toast.error('No se pudo subir la imagen. Verificá tu sesión de admin.');
        return;
      }
      setForm(f => ({ ...f, imageUrl: url }));
      toast.success('Imagen subida ✓');
    } catch (err) {
      console.error('Error subiendo imagen del evento:', err);
      toast.error('No se pudo subir la imagen. Probá de nuevo.');
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="font-display text-xl font-bold text-navy-700">
            {event ? 'Editar Evento' : 'Nuevo Evento'}
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Fecha *</label>
              <input
                type="date"
                required
                value={form.date}
                onChange={e => setForm({ ...form, date: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Último día</label>
              <input
                type="date"
                min={form.date || undefined}
                value={form.endDate || ''}
                onChange={e => setForm({ ...form, endDate: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
              <p className="mt-1 text-[11px] text-gray-400">Solo si dura varios días.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Hora</label>
              <input
                type="time"
                value={form.time}
                onChange={e => setForm({ ...form, time: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Lugar *</label>
              <input
                type="text"
                required
                value={form.location}
                onChange={e => setForm({ ...form, location: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
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
          <div>
            <label className="block text-sm font-semibold text-navy-700 mb-1">Imagen / flyer</label>
            <div className="flex items-center gap-3">
              {form.imageUrl && (
                <img src={form.imageUrl} alt="" className="h-20 w-20 flex-shrink-0 rounded-lg border border-gray-200 object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-navy-700 transition-colors hover:border-lime-400">
                  {subiendo ? 'Subiendo…' : form.imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={subiendo}
                    onChange={e => { void handleArchivo(e.target.files?.[0]); e.target.value = ''; }}
                  />
                </label>
                <input
                  type="text"
                  placeholder="…o pegá una URL"
                  value={form.imageUrl}
                  onChange={e => setForm({ ...form, imageUrl: e.target.value })}
                  className="mt-2 w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors text-sm"
                />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Teléfono de inscripciones</label>
              <input
                type="text"
                placeholder="092 103 276"
                value={form.phone || ''}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
              <p className="mt-1 text-[11px] text-gray-400">Arma el botón de WhatsApp en la home.</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">URL Maps</label>
              <input
                type="text"
                value={form.mapsUrl}
                onChange={e => setForm({ ...form, mapsUrl: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Máx. Participantes</label>
              <input
                type="number"
                min={0}
                value={form.maxParticipants || ''}
                onChange={e => setForm({ ...form, maxParticipants: e.target.value ? Number(e.target.value) : undefined })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Estado</label>
              <select
                value={form.status}
                onChange={e => setForm({ ...form, status: e.target.value as Event['status'] })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors bg-white"
              >
                <option value="upcoming">Próximo</option>
                <option value="past">Pasado</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-navy-700 mb-1">Categoría</label>
              <select
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value as Event['category'] })}
                className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors bg-white"
              >
                <option value="tournament">Torneo</option>
                <option value="clinic">Clínica</option>
                <option value="social">Social</option>
              </select>
            </div>
          </div>

          {/* Inscripción online */}
          <div className="rounded-xl border border-gray-200 p-4 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.inscripcionesAbiertas === true}
                onChange={e => setForm({ ...form, inscripcionesAbiertas: e.target.checked })}
                className="accent-lime-500 w-4 h-4"
              />
              <span className="text-sm font-semibold text-navy-700">Inscripción online abierta</span>
            </label>
            {form.inscripcionesAbiertas && (
              <div>
                <label className="block text-sm font-semibold text-navy-700 mb-1">Categorías (separadas por coma)</label>
                <textarea
                  rows={2}
                  placeholder="Singles A,Singles B,Doble Mixto A,…"
                  value={form.categorias || ''}
                  onChange={e => setForm({ ...form, categorias: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors resize-none text-sm"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  Se muestran como botones en el formulario. Vacío = campo de texto libre.
                </p>
              </div>
            )}
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
