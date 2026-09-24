import { useId, useMemo, useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import type { StandingEntry } from '../types';
import { Boton, BotonIcono, Campo, Confirmar, Dialogo, EncabezadoPagina, Entrada, Tarjeta, Vacio } from '../admin/ui';

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
  const [deleteConfirm, setDeleteConfirm] = useState<StandingEntry | null>(null);
  const idForm = useId();

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
    // onSave (App.saveStanding) actualiza la lista al toque y sube en segundo plano; si la
    // nube falla, avisa aparte. Por eso el toast dice lo que ya pasó: quedó en la tabla.
    onSave(entry);
    toast.success(editing ? 'Cambios guardados' : 'Se agregó a la clasificación');
    closeModal();
  };

  const handleDelete = (id: string) => {
    onDelete(id);
    setDeleteConfirm(null);
    toast.success('Se eliminó de la clasificación');
  };

  const sucio = modalOpen && JSON.stringify(form) !== JSON.stringify(editing ? toForm(editing) : emptyForm());

  return (
    <div>
      <EncabezadoPagina
        rotulo="Torneos"
        titulo="Clasificación"
        descripcion="Se muestra en la web, en la sección Clasificación — Camino al Mundial."
        acciones={<Boton icono={<Plus size={18} />} onClick={openCreate}>Agregar jugador/a</Boton>}
      />

      {standings.length === 0 && (
        <Vacio
          icono={<Trophy size={22} />}
          titulo="Todavía no hay nadie en la clasificación"
          descripcion="Empezá a armar la tabla con «Agregar jugador/a»."
          accion={<Boton icono={<Plus size={18} />} onClick={openCreate}>Agregar jugador/a</Boton>}
        />
      )}

      <div className="space-y-6">
        {grouped.map(group => (
          <Tarjeta key={group.category} titulo={group.category} sinPadding acciones={<span className="text-[13px] text-gray-500">{group.entries.length}</span>}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    <th scope="col" className="w-14 px-4 py-2.5 text-left font-display text-[11px] font-bold uppercase tracking-wider text-gray-600">Pos</th>
                    <th scope="col" className="px-4 py-2.5 text-left font-display text-[11px] font-bold uppercase tracking-wider text-gray-600">Jugador/a</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-display text-[11px] font-bold uppercase tracking-wider text-gray-600">Puntos</th>
                    <th scope="col" className="hidden px-4 py-2.5 text-left font-display text-[11px] font-bold uppercase tracking-wider text-gray-600 md:table-cell">Notas</th>
                    <th scope="col" className="w-24 px-2 py-2.5"><span className="sr-only">Acciones</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {group.entries.map(entry => (
                    <tr key={entry.id}>
                      <td className="px-4 py-2">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-navy-50 text-xs font-bold tabular-nums text-navy-700">
                          {entry.position}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className="font-display font-semibold text-navy-700">{entry.playerName}</span>
                        {entry.notes && <span className="block text-[13px] text-gray-500 md:hidden">{entry.notes}</span>}
                      </td>
                      <td className="px-4 py-2 text-right font-bold tabular-nums text-navy-700">{formatPoints(entry.points)}</td>
                      <td className="hidden px-4 py-2 text-gray-600 md:table-cell">{entry.notes}</td>
                      <td className="px-2 py-1">
                        <div className="flex justify-end">
                          <BotonIcono etiqueta={`Editar ${entry.playerName}`} icono={<Pencil size={17} />} onClick={() => openEdit(entry)} />
                          <BotonIcono etiqueta={`Eliminar ${entry.playerName}`} icono={<Trash2 size={17} />} tono="peligro" onClick={() => setDeleteConfirm(entry)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Tarjeta>
        ))}
      </div>

      <Confirmar
        abierto={deleteConfirm !== null}
        titulo={deleteConfirm ? `¿Eliminar a ${deleteConfirm.playerName}?` : ''}
        mensaje="Sale de la clasificación pública. No se puede deshacer."
        textoConfirmar="Eliminar"
        alCerrar={() => setDeleteConfirm(null)}
        alConfirmar={() => { if (deleteConfirm) handleDelete(deleteConfirm.id); }}
      />

      <Dialogo
        abierto={modalOpen}
        titulo={editing ? 'Editar jugador/a' : 'Agregar jugador/a'}
        alCerrar={closeModal}
        sucio={sucio}
        pie={(
          <>
            <Boton variante="secundario" onClick={closeModal}>Cancelar</Boton>
            <Boton type="submit" form={idForm}>Guardar</Boton>
          </>
        )}
      >
        <form id={idForm} onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Campo etiqueta="Posición">
              <Entrada type="text" inputMode="numeric" value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} />
            </Campo>
            <Campo etiqueta="Puntos">
              <Entrada type="text" inputMode="decimal" value={form.points} onChange={e => setForm({ ...form, points: e.target.value })} />
            </Campo>
          </div>
          <Campo etiqueta="Nombre" requerido>
            <Entrada type="text" value={form.playerName} onChange={e => setForm({ ...form, playerName: e.target.value })} placeholder="Nombre y apellido" />
          </Campo>
          <Campo etiqueta="Categoría">
            <Entrada type="text" list="standings-categories" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="General" />
          </Campo>
          <datalist id="standings-categories">
            {categories.map(cat => (
              <option key={cat} value={cat} />
            ))}
          </datalist>
          <Campo etiqueta="Notas">
            <Entrada type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Ej: campeón/a del Torneo Apertura" />
          </Campo>
        </form>
      </Dialogo>
    </div>
  );
}
