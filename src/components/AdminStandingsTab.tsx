import { useMemo, useState, type FormEvent } from 'react';
import { Plus, Edit, Trash2, X, Save, Info, Check, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import type { StandingEntry } from '../types';

const formatPrice = (n: number) => '$ ' + n.toLocaleString('es-UY', { maximumFractionDigits: 0 });

const inputClass =
  'w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors';
const labelClass = 'block text-sm font-semibold text-navy-700 mb-1';

const formatPoints = (n: number) =>
  n.toLocaleString('es-UY', { maximumFractionDigits: 2 });

interface StandingForm {
  position: string;
  playerName: string;
  points: string;
  category: string;
  notes: string;
}

const emptyForm = (): StandingForm => ({
  position: '1',
  playerName: '',
  points: '0',
  category: 'General',
  notes: '',
});

const toForm = (entry: StandingEntry): StandingForm => ({
  position: String(entry.position),
  playerName: entry.playerName,
  points: String(entry.points),
  category: entry.category,
  notes: entry.notes,
});

export function AdminStandingsTab({ standings, onSave, onDelete }: {
  standings: StandingEntry[];
  onSave: (s: StandingEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<StandingEntry | null>(null);
  const [form, setForm] = useState<StandingForm>(emptyForm());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>(['General']);
    standings.forEach(s => set.add(s.category || 'General'));
    return Array.from(set).sort((a, b) => {
      if (a === 'General') return -1;
      if (b === 'General') return 1;
      return a.localeCompare(b, 'es');
    });
  }, [standings]);

  const grouped = useMemo(() => {
    const map = new Map<string, StandingEntry[]>();
    standings.forEach(s => {
      const cat = s.category || 'General';
      const list = map.get(cat) || [];
      list.push(s);
      map.set(cat, list);
    });
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === 'General') return -1;
      if (b === 'General') return 1;
      return a.localeCompare(b, 'es');
    });
    return keys.map(cat => ({
      category: cat,
      entries: (map.get(cat) || []).slice().sort((a, b) => a.position - b.position),
    }));
  }, [standings]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (entry: StandingEntry) => {
    setEditing(entry);
    setForm(toForm(entry));
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const name = form.playerName.trim();
    if (!name) {
      toast.error('Completá el nombre del jugador o jugadora');
      return;
    }
    const position = Math.max(1, parseInt(form.position, 10) || 1);
    const points = parseFloat(form.points.replace(',', '.'));
    const entry: StandingEntry = {
      id: editing ? editing.id : crypto.randomUUID(),
      position,
      playerName: name,
      points: isNaN(points) ? 0 : points,
      category: form.category.trim() || 'General',
      notes: form.notes.trim(),
    };
    onSave(entry);
    toast.success(editing ? 'Cambios guardados' : 'Se agregó a la clasificación');
    closeModal();
  };

  const handleDelete = (id: string) => {
    onDelete(id);
    setDeleteConfirm(null);
    toast.success('Se eliminó de la clasificación');
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Clasificación</h1>
        <button
          onClick={openCreate}
          className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-6 rounded-lg transition-colors flex items-center gap-2"
        >
          <Plus size={18} /> Agregar jugador/a
        </button>
      </div>

      {/* Info banner */}
      <div className="mb-6 bg-blue-50 border-l-4 border-blue-500 px-4 py-3 rounded-r-lg flex items-start gap-3 text-sm text-blue-900">
        <Info size={18} className="flex-shrink-0 mt-0.5" />
        <p>Esta tabla se muestra públicamente en la sección Clasificación — Camino al Mundial.</p>
      </div>

      {/* Empty state */}
      {standings.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
          <Trophy size={48} strokeWidth={1} className="mx-auto mb-3" />
          <p className="font-display">Todavía no hay nadie en la clasificación</p>
          <p className="text-sm mt-1">Empezá a armar la tabla con el botón de arriba.</p>
        </div>
      )}

      {/* Grouped tables */}
      {grouped.map(group => (
        <div key={group.category} className="mb-8">
          <h2 className="font-display text-lg font-bold text-navy-700 mb-3">{group.category}</h2>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Pos</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Jugador/a</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Puntos</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden md:table-cell">Notas</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {group.entries.map(entry => (
                    <tr key={entry.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-navy-700/10 text-navy-700 text-xs font-bold">
                          {entry.position}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-display font-semibold text-navy-700 text-sm">{entry.playerName}</td>
                      <td className="px-4 py-3 text-sm font-bold text-navy-700">{formatPoints(entry.points)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{entry.notes}</td>
                      <td className="px-4 py-3">
                        {deleteConfirm === entry.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-red-600 font-semibold">¿Eliminar?</span>
                            <button
                              onClick={() => handleDelete(entry.id)}
                              className="text-red-500 hover:text-red-700 transition-colors"
                              title="Confirmar"
                            >
                              <Check size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="text-gray-400 hover:text-navy-700 transition-colors"
                              title="Cancelar"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openEdit(entry)}
                              className="text-navy-700 hover:text-lime-500 transition-colors"
                              title="Editar"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(entry.id)}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0" onClick={closeModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl z-10">
              <h2 className="font-display text-xl font-bold text-navy-700">
                {editing ? 'Editar jugador/a' : 'Agregar jugador/a'}
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-navy-700 transition-colors">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Posición</label>
                  <input
                    type="number"
                    min={1}
                    value={form.position}
                    onChange={e => setForm({ ...form, position: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Puntos</label>
                  <input
                    type="number"
                    step="any"
                    value={form.points}
                    onChange={e => setForm({ ...form, points: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Nombre *</label>
                <input
                  type="text"
                  value={form.playerName}
                  onChange={e => setForm({ ...form, playerName: e.target.value })}
                  placeholder="Nombre y apellido"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Categoría</label>
                <input
                  type="text"
                  list="standings-categories"
                  value={form.category}
                  onChange={e => setForm({ ...form, category: e.target.value })}
                  placeholder="General"
                  className={inputClass}
                />
                <datalist id="standings-categories">
                  {categories.map(cat => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className={labelClass}>Notas</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Ej: campeón/a del Torneo Apertura"
                  className={inputClass}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
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
      )}
    </div>
  );
}
