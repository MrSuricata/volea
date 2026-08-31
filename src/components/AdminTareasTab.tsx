import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight, CalendarDays, Check, CheckCheck, Circle, Clock, ListTodo, Loader2, Pencil,
  Plus, RefreshCw, Search, SlidersHorizontal, Trash2, Undo2, UserRound, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { MiembroEquipo, Tarea, TareaEstado, TareaPrioridad } from '../types';
import { SupabaseService } from '../services/supabaseService';
import { normalizar } from '../utils/nombres';

/**
 * Pestaña Tareas: la agenda compartida del equipo (Brian, Pauli, Gastón).
 *
 * La regla de diseño acá es "que no complique": anotar algo tiene que salir en
 * un renglón + Enter (sin abrir nada), y mover una tarea de estado tiene que ser
 * un toque en la propia tarjeta. El modal existe solo para lo que no entra en
 * una línea (detalle, asignado, prioridad, fecha).
 */

const TZ = 'America/Montevideo';
const DIA_MS = 24 * 60 * 60 * 1000;

/** Día calendario (YYYY-MM-DD) de un instante, visto desde Montevideo. */
const diaEnMvd = (ms: number): string => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });

/** 'YYYY-MM-DD' (o un ISO completo) → "vie 5/9". */
const fechaCorta = (valor: string): string => {
  const dia = valor.slice(0, 10);
  // Mediodía a propósito: construir la fecha al mediodía local evita que el día
  // se corra por zona horaria al formatear.
  const d = new Date(`${dia}T12:00:00`);
  if (isNaN(d.getTime())) return dia;
  const semana = d.toLocaleDateString('es-UY', { weekday: 'short' });
  const numero = d.toLocaleDateString('es-UY', { day: 'numeric', month: 'numeric' });
  return `${semana} ${numero}`;
};

/** Las tarjetas recién anotadas viven con un id temporal hasta que vuelve el real. */
const esTemporal = (id: string): boolean => id.startsWith('tmp:');

type Filtro = 'todas' | 'mias' | 'sin';

const COLUMNAS: { id: TareaEstado; label: string; icono: LucideIcon; acento: string }[] = [
  { id: 'pendiente', label: 'Pendiente', icono: Circle, acento: 'text-gray-400' },
  { id: 'en_curso', label: 'En curso', icono: Clock, acento: 'text-navy-500' },
  { id: 'hecha', label: 'Hecha', icono: CheckCheck, acento: 'text-green-600' },
];

const VACIO: Record<TareaEstado, string> = {
  pendiente: 'Nada pendiente por ahora',
  en_curso: 'Nada en curso',
  hecha: 'Todavía nada terminado',
};

const PRIORIDADES: { id: TareaPrioridad; label: string; activo: string }[] = [
  { id: 'baja', label: 'Baja', activo: 'border-gray-300 bg-gray-100 text-gray-500' },
  { id: 'normal', label: 'Normal', activo: 'border-navy-700 bg-navy-700 text-white' },
  { id: 'alta', label: 'Alta', activo: 'border-red-300 bg-red-50 text-red-600' },
];

const ESTADOS: { id: TareaEstado; label: string }[] = [
  { id: 'pendiente', label: 'Pendiente' },
  { id: 'en_curso', label: 'En curso' },
  { id: 'hecha', label: 'Hecha' },
];

const PESO_PRIORIDAD: Record<TareaPrioridad, number> = { alta: 0, normal: 1, baja: 2 };

/** Agenda: primero lo que tiene fecha (más próximo arriba), después prioridad, después lo último anotado. */
const ordenAgenda = (a: Tarea, b: Tarea): number => {
  const fa = a.venceEl ? a.venceEl.slice(0, 10) : null;
  const fb = b.venceEl ? b.venceEl.slice(0, 10) : null;
  if (fa !== fb) {
    if (fa === null) return 1;
    if (fb === null) return -1;
    return fa < fb ? -1 : 1;
  }
  const pa = PESO_PRIORIDAD[a.prioridad] ?? 1;
  const pb = PESO_PRIORIDAD[b.prioridad] ?? 1;
  if (pa !== pb) return pa - pb;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
};

/** Las hechas van al revés: lo último completado arriba. */
const ordenHechas = (a: Tarea, b: Tarea): number => {
  const ca = a.completadaAt || a.updatedAt || a.createdAt;
  const cb = b.completadaAt || b.updatedAt || b.createdAt;
  return ca < cb ? 1 : ca > cb ? -1 : 0;
};

/** Chip de vencimiento: el "hoy"/"vencida" es toda la parte de agenda del pedido. */
const chipVencimiento = (
  t: Tarea, hoy: string, manana: string,
): { texto: string; clase: string } | null => {
  if (!t.venceEl) return null;
  const dia = t.venceEl.slice(0, 10);
  if (t.estado === 'hecha') return { texto: fechaCorta(dia), clase: 'bg-gray-100 text-gray-400' };
  if (dia < hoy) return { texto: `vencida · ${fechaCorta(dia)}`, clase: 'bg-red-50 text-red-600' };
  if (dia === hoy) return { texto: 'hoy', clase: 'bg-amber-100 text-amber-700' };
  if (dia === manana) return { texto: 'mañana', clase: 'bg-navy-50 text-navy-600' };
  return { texto: fechaCorta(dia), clase: 'bg-gray-100 text-gray-500' };
};

const chipClass = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';
const inputClass = 'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-navy-700 focus:border-lime-400 focus:outline-none';
const labelClass = 'mb-1 block font-display text-xs font-bold uppercase tracking-wide text-gray-500';

/** Cuántas hechas se ven antes de tener que pedir "ver todas". */
const LIMITE_HECHAS = 5;

/** Tarea nueva en blanco, lista para el modal (id '' = la crea el service). */
const tareaVacia = (adminEmail: string, titulo: string): Tarea => ({
  id: '',
  titulo,
  detalle: '',
  estado: 'pendiente',
  prioridad: 'normal',
  asignadoA: adminEmail.trim() === '' ? null : adminEmail,
  creadoPor: adminEmail,
  venceEl: null,
  completadaAt: null,
  createdAt: '',
  updatedAt: '',
});

export default function AdminTareasTab({ adminEmail }: { adminEmail: string }) {
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [equipo, setEquipo] = useState<MiembroEquipo[]>([]);
  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [recargando, setRecargando] = useState(false);
  // null de getTareas() = falló la LECTURA. No es lo mismo que "no hay tareas":
  // decir "no hay nada anotado" cuando en realidad se cayó la sesión es la peor
  // mentira posible en una pantalla de pendientes.
  const [falloCarga, setFalloCarga] = useState(false);
  const [nuevoTitulo, setNuevoTitulo] = useState('');
  const [creando, setCreando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busqueda, setBusqueda] = useState('');
  const [editando, setEditando] = useState<Tarea | null>(null);
  const [aBorrar, setABorrar] = useState<string | null>(null);
  const [ocupadas, setOcupadas] = useState<string[]>([]);
  const [verHechas, setVerHechas] = useState(false);

  // Secuencia de fetches: una respuesta vieja que llega tarde no pisa a una nueva.
  const seq = useRef(0);
  // Lista viva, para decidir si un fallo de lectura deja la pantalla en error
  // (no había nada) o solo avisa con un toast (ya había datos en pantalla).
  const tareasRef = useRef<Tarea[]>([]);
  useEffect(() => { tareasRef.current = tareas; }, [tareas]);
  // Altas rápidas todavía en vuelo: sus tarjetas temporales sobreviven a un
  // refresh disparado por otra alta.
  const enVuelo = useRef<Set<string>>(new Set());

  const cargar = useCallback(async () => {
    const n = ++seq.current;
    setRecargando(true);
    const [ts, eq] = await Promise.all([SupabaseService.getTareas(), SupabaseService.getEquipo()]);
    if (n !== seq.current) return; // llegó tarde
    if (ts === null) {
      setFalloCarga(tareasRef.current.length === 0);
      toast.error('No se pudieron cargar las tareas. Verificá tu sesión de admin.');
    } else {
      setFalloCarga(false);
      setTareas(prev => [...prev.filter(t => esTemporal(t.id) && enVuelo.current.has(t.id)), ...ts]);
    }
    // El taller de sublimación no es del equipo: no se le asignan tareas.
    if (eq !== null) setEquipo(eq.filter(m => m.role !== 'sublimacion'));
    setRecargando(false);
    setCargandoInicial(false);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const hoy = diaEnMvd(Date.now());
  const manana = diaEnMvd(Date.now() + DIA_MS);
  const yo = adminEmail.trim().toLowerCase();

  const nombreDe = useCallback((email: string | null): string => {
    if (!email) return 'Sin asignar';
    const m = equipo.find(x => x.email.toLowerCase() === email.toLowerCase());
    if (m && m.name.trim() !== '') return m.name.trim().split(' ')[0];
    return email.split('@')[0];
  }, [equipo]);

  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return tareas.filter(t => {
      if (filtro === 'mias' && (t.asignadoA || '').toLowerCase() !== yo) return false;
      if (filtro === 'sin' && t.asignadoA) return false;
      if (q !== '' && !normalizar(`${t.titulo} ${t.detalle} ${nombreDe(t.asignadoA)}`).includes(q)) return false;
      return true;
    });
  }, [tareas, filtro, busqueda, yo, nombreDe]);

  const porEstado = useMemo(() => {
    const grupos: Record<TareaEstado, Tarea[]> = { pendiente: [], en_curso: [], hecha: [] };
    for (const t of visibles) (grupos[t.estado] || grupos.pendiente).push(t);
    grupos.pendiente.sort(ordenAgenda);
    grupos.en_curso.sort(ordenAgenda);
    grupos.hecha.sort(ordenHechas);
    return grupos;
  }, [visibles]);

  // Resumen de arriba: sobre TODAS las tareas, no sobre el filtro, para que el
  // "2 vencidas" no desaparezca por estar mirando "Mías".
  const resumen = useMemo(() => {
    let abiertas = 0, vencidas = 0, paraHoy = 0;
    for (const t of tareas) {
      if (t.estado === 'hecha') continue;
      abiertas++;
      if (!t.venceEl) continue;
      const dia = t.venceEl.slice(0, 10);
      if (dia < hoy) vencidas++;
      else if (dia === hoy) paraHoy++;
    }
    return { abiertas, vencidas, paraHoy };
  }, [tareas, hoy]);

  /** Alta rápida: se ve al instante, se sincroniza atrás y si falla se devuelve el texto. */
  const anotarRapido = async () => {
    const titulo = nuevoTitulo.trim();
    if (titulo === '') return;
    const ahora = new Date().toISOString();
    const tmp: Tarea = {
      ...tareaVacia(adminEmail, titulo),
      id: `tmp:${ahora}:${Math.random().toString(36).slice(2, 8)}`,
      createdAt: ahora,
      updatedAt: ahora,
    };
    enVuelo.current.add(tmp.id);
    setTareas(prev => [tmp, ...prev]);
    setNuevoTitulo('');
    setCreando(true);
    try {
      const ok = await SupabaseService.saveTarea({ ...tmp, id: '' });
      enVuelo.current.delete(tmp.id);
      if (!ok) {
        setTareas(prev => prev.filter(t => t.id !== tmp.id));
        setNuevoTitulo(prev => (prev === '' ? titulo : prev)); // no perderle lo escrito
        toast.error('No se pudo anotar la tarea. Probá de nuevo.');
        return;
      }
      await cargar(); // trae el id real de la fila recién creada
    } catch (e) {
      console.error('Error anotando tarea:', e);
      enVuelo.current.delete(tmp.id);
      setTareas(prev => prev.filter(t => t.id !== tmp.id));
      setNuevoTitulo(prev => (prev === '' ? titulo : prev));
      toast.error('No se pudo anotar la tarea. Probá de nuevo.');
    } finally {
      setCreando(false);
    }
  };

  /** Cambio de estado optimista: se ve al toque y si la escritura falla se revierte. */
  const cambiarEstado = async (tarea: Tarea, estado: TareaEstado) => {
    if (esTemporal(tarea.id) || ocupadas.includes(tarea.id) || tarea.estado === estado) return;
    const ahora = new Date().toISOString();
    const nueva: Tarea = {
      ...tarea,
      estado,
      // La marca de completada la manda el estado (igual que en el service).
      completadaAt: estado === 'hecha' ? (tarea.completadaAt || ahora) : null,
      updatedAt: ahora,
    };
    setTareas(prev => prev.map(t => (t.id === tarea.id ? nueva : t)));
    setOcupadas(prev => [...prev, tarea.id]);
    try {
      const ok = await SupabaseService.saveTarea(nueva);
      if (!ok) {
        setTareas(prev => prev.map(t => (t.id === tarea.id ? tarea : t)));
        toast.error('No se pudo cambiar el estado. Quedó como estaba.');
      }
    } catch (e) {
      console.error('Error cambiando estado de tarea:', e);
      setTareas(prev => prev.map(t => (t.id === tarea.id ? tarea : t)));
      toast.error('No se pudo cambiar el estado. Quedó como estaba.');
    } finally {
      setOcupadas(prev => prev.filter(id => id !== tarea.id));
    }
  };

  const borrar = async (tarea: Tarea) => {
    setABorrar(null);
    if (esTemporal(tarea.id)) return;
    const posicion = tareasRef.current.findIndex(t => t.id === tarea.id);
    setTareas(prev => prev.filter(t => t.id !== tarea.id));
    try {
      const ok = await SupabaseService.deleteTarea(tarea.id);
      if (!ok) throw new Error('delete rechazado');
      toast.success('Tarea borrada');
    } catch (e) {
      console.error('Error borrando tarea:', e);
      // Vuelve a su lugar, no al final: si estaba a mitad de lista, ahí queda.
      setTareas(prev => {
        if (prev.some(t => t.id === tarea.id)) return prev;
        const copia = prev.slice();
        copia.splice(posicion < 0 ? copia.length : Math.min(posicion, copia.length), 0, tarea);
        return copia;
      });
      toast.error('No se pudo borrar la tarea');
    }
  };

  const filtros: { id: Filtro; label: string }[] = [
    { id: 'todas', label: 'Todas' },
    ...(yo !== '' ? [{ id: 'mias' as Filtro, label: 'Mías' }] : []),
    { id: 'sin', label: 'Sin asignar' },
  ];

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="hidden font-display text-2xl font-bold text-navy-700 lg:block">Tareas</h1>
        <button
          onClick={() => void cargar()}
          disabled={recargando}
          className="ml-auto flex items-center gap-2 rounded-lg bg-navy-700 px-5 py-2.5 font-display text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:bg-gray-400"
        >
          <RefreshCw size={16} className={recargando ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {/* Alta rápida: un renglón + Enter. Lo demás (detalle, asignado, prioridad,
          fecha) sale por el botón de al lado, que se lleva lo ya escrito. */}
      <div className="mb-5 rounded-xl border border-gray-100 bg-white p-3 shadow-sm sm:p-4">
        <form
          onSubmit={e => { e.preventDefault(); void anotarRapido(); }}
          className="flex flex-wrap items-center gap-2"
        >
          <label htmlFor="tarea-rapida" className="sr-only">¿Qué hay que hacer?</label>
          <input
            id="tarea-rapida"
            type="text"
            value={nuevoTitulo}
            onChange={e => setNuevoTitulo(e.target.value)}
            placeholder="¿Qué hay que hacer?"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-navy-700 placeholder:text-gray-400 focus:border-lime-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={nuevoTitulo.trim() === ''}
            className="flex items-center gap-1.5 rounded-lg bg-lime-400 px-4 py-2.5 font-display text-sm font-bold text-navy-700 transition-colors hover:bg-lime-300 disabled:bg-gray-100 disabled:text-gray-400"
          >
            {creando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} strokeWidth={2.5} />}
            Anotar
          </button>
          <button
            type="button"
            onClick={() => setEditando(tareaVacia(adminEmail, nuevoTitulo.trim()))}
            title="Anotar con detalle, asignado, prioridad y fecha"
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2.5 font-display text-sm font-semibold text-navy-700 transition-colors hover:border-navy-700"
          >
            <SlidersHorizontal size={16} /> Con detalle
          </button>
        </form>
        <p className="mt-2 text-[11px] text-gray-400">
          Enter la anota a tu nombre y queda en <b>Pendiente</b>. Con «Con detalle» le ponés a quién,
          prioridad y para cuándo.
        </p>
      </div>

      {/* Resumen — la lectura de un vistazo antes de mirar las columnas */}
      {!cargandoInicial && !falloCarga && (
        <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
          <span className={`${chipClass} bg-navy-50 text-navy-600`}>
            <ListTodo size={12} /> {resumen.abiertas} sin terminar
          </span>
          {resumen.paraHoy > 0 && (
            <span className={`${chipClass} bg-amber-100 text-amber-700`}>
              <CalendarDays size={12} /> {resumen.paraHoy} para hoy
            </span>
          )}
          {resumen.vencidas > 0 && (
            <span className={`${chipClass} bg-red-50 text-red-600`}>
              {resumen.vencidas} {resumen.vencidas === 1 ? 'vencida' : 'vencidas'}
            </span>
          )}
        </div>
      )}

      {/* Filtros + buscador */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {filtros.map(f => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            aria-pressed={filtro === f.id}
            className={`rounded-full px-3.5 py-1.5 font-display text-xs font-bold transition-colors ${
              filtro === f.id ? 'bg-navy-700 text-white' : 'bg-gray-100 text-gray-500 hover:text-navy-700'
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="relative w-full sm:ml-auto sm:w-64">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar tarea, persona…"
            aria-label="Buscar tareas"
            className="w-full rounded-full border border-gray-200 py-1.5 pl-9 pr-8 text-xs focus:border-lime-400 focus:outline-none"
          />
          {busqueda !== '' && (
            <button
              onClick={() => setBusqueda('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-navy-700"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {cargandoInicial ? (
        <div className="rounded-2xl border border-dashed border-gray-300 py-10 text-center">
          <Loader2 size={32} strokeWidth={1.5} className="mx-auto mb-3 animate-spin text-gray-300" />
          <p className="font-display text-sm font-bold text-gray-500">Cargando las tareas…</p>
        </div>
      ) : falloCarga ? (
        <div className="rounded-2xl border border-dashed border-gray-300 py-10 text-center">
          <ListTodo size={32} strokeWidth={1.5} className="mx-auto mb-3 text-gray-300" />
          <p className="font-display text-sm font-bold text-gray-500">No se pudieron cargar las tareas</p>
          <p className="mt-1 text-xs text-gray-400">
            Puede ser la sesión vencida: entrá de nuevo con el link mágico y probá «Actualizar».
          </p>
        </div>
      ) : (
        /* Tres columnas en desktop, apiladas en el celular */
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNAS.map(col => {
            const lista = porEstado[col.id];
            const esHecha = col.id === 'hecha';
            const mostradas = esHecha && !verHechas ? lista.slice(0, LIMITE_HECHAS) : lista;
            const Icono = col.icono;
            return (
              <section key={col.id} className={esHecha ? 'opacity-90' : undefined}>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <Icono size={14} className={col.acento} />
                  <h2 className="font-display text-sm font-bold uppercase tracking-wide text-gray-500">
                    {col.label}
                  </h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">
                    {lista.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {mostradas.map(t => (
                    <TarjetaTarea
                      key={t.id}
                      tarea={t}
                      quien={nombreDe(t.asignadoA)}
                      hoy={hoy}
                      manana={manana}
                      ocupada={ocupadas.includes(t.id) || esTemporal(t.id)}
                      confirmando={aBorrar === t.id}
                      onEstado={estado => void cambiarEstado(t, estado)}
                      onEditar={() => setEditando(t)}
                      onPedirBorrar={() => setABorrar(t.id)}
                      onCancelarBorrar={() => setABorrar(null)}
                      onBorrar={() => void borrar(t)}
                    />
                  ))}
                  {lista.length === 0 && (
                    <div className="rounded-xl border border-dashed border-gray-200 py-6 text-center text-xs text-gray-400">
                      {busqueda.trim() !== '' || filtro !== 'todas'
                        ? 'Nada con este filtro'
                        : VACIO[col.id]}
                    </div>
                  )}
                  {esHecha && lista.length > LIMITE_HECHAS && (
                    <button
                      onClick={() => setVerHechas(v => !v)}
                      className="w-full rounded-xl border border-dashed border-gray-200 py-2 font-display text-xs font-bold text-gray-500 transition-colors hover:text-navy-700"
                    >
                      {verHechas ? 'Ver menos' : `Ver todas (${lista.length})`}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {editando && (
        <TareaModal
          tarea={editando}
          equipo={equipo}
          adminEmail={adminEmail}
          onClose={() => setEditando(null)}
          onGuardada={esNueva => {
            setEditando(null);
            if (esNueva) setNuevoTitulo('');
            void cargar();
          }}
        />
      )}
    </div>
  );
}

/**
 * Tarjeta de una tarea. Todo lo de todos los días (mover de estado) se resuelve
 * acá adentro con un toque; el modal queda para editar el contenido.
 */
function TarjetaTarea({
  tarea, quien, hoy, manana, ocupada, confirmando,
  onEstado, onEditar, onPedirBorrar, onCancelarBorrar, onBorrar,
}: {
  tarea: Tarea;
  quien: string;
  hoy: string;
  manana: string;
  ocupada: boolean;
  confirmando: boolean;
  onEstado: (estado: TareaEstado) => void;
  onEditar: () => void;
  onPedirBorrar: () => void;
  onCancelarBorrar: () => void;
  onBorrar: () => void;
}) {
  const hecha = tarea.estado === 'hecha';
  const venc = chipVencimiento(tarea, hoy, manana);
  const vencida = venc !== null && venc.texto.startsWith('vencida');

  const botonBase = 'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-display text-[11px] font-bold transition-colors disabled:opacity-40';

  return (
    <article
      className={`rounded-xl border bg-white p-3 shadow-sm transition-opacity ${
        hecha ? 'border-gray-100 opacity-60' : vencida ? 'border-red-200' : 'border-gray-100'
      }`}
    >
      <div className="flex items-start gap-2">
        <p className={`min-w-0 flex-1 break-words text-sm font-semibold ${
          hecha ? 'text-gray-400 line-through' : 'text-navy-700'
        }`}>
          {tarea.titulo}
        </p>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <button
            onClick={onEditar}
            disabled={ocupada}
            title="Editar"
            aria-label={`Editar ${tarea.titulo}`}
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy-700 disabled:opacity-40"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={onPedirBorrar}
            disabled={ocupada}
            title="Borrar"
            aria-label={`Borrar ${tarea.titulo}`}
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {tarea.detalle.trim() !== '' && (
        <p className="mt-1 line-clamp-2 text-xs text-gray-500">{tarea.detalle}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={`${chipClass} ${
          tarea.asignadoA ? 'bg-navy-50 text-navy-600' : 'bg-gray-100 text-gray-400'
        }`}>
          <UserRound size={11} /> {quien}
        </span>
        {/* Prioridad: solo se canta si es alta (rojo) o baja (gris tenue). La
            normal no ocupa lugar, que es el caso del 90% de las tareas. */}
        {tarea.prioridad === 'alta' && !hecha && (
          <span className={`${chipClass} bg-red-50 text-red-600`}>Alta</span>
        )}
        {tarea.prioridad === 'baja' && !hecha && (
          <span className={`${chipClass} bg-gray-100 text-gray-400`}>Baja</span>
        )}
        {venc && <span className={`${chipClass} ${venc.clase}`}>{venc.texto}</span>}
      </div>

      {confirmando ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-2.5 py-1.5">
          <span className="flex-1 text-[11px] font-semibold text-red-600">¿Borrar esta tarea?</span>
          <button
            onClick={onBorrar}
            className="rounded-md bg-red-500 px-2.5 py-1 font-display text-[11px] font-bold text-white transition-colors hover:bg-red-600"
          >
            Sí, borrar
          </button>
          <button
            onClick={onCancelarBorrar}
            className="rounded-md px-2 py-1 font-display text-[11px] font-bold text-gray-500 transition-colors hover:text-navy-700"
          >
            No
          </button>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2.5">
          {tarea.estado === 'pendiente' && (
            <>
              <button
                onClick={() => onEstado('en_curso')}
                disabled={ocupada}
                className={`${botonBase} border border-gray-200 text-navy-700 hover:border-navy-700`}
              >
                <ArrowRight size={12} /> En curso
              </button>
              <button
                onClick={() => onEstado('hecha')}
                disabled={ocupada}
                className={`${botonBase} bg-lime-400 text-navy-700 hover:bg-lime-300`}
              >
                <Check size={12} strokeWidth={3} /> Hecha
              </button>
            </>
          )}
          {tarea.estado === 'en_curso' && (
            <>
              <button
                onClick={() => onEstado('pendiente')}
                disabled={ocupada}
                title="Volver a Pendiente"
                className={`${botonBase} text-gray-500 hover:text-navy-700`}
              >
                <Undo2 size={12} /> Pendiente
              </button>
              <button
                onClick={() => onEstado('hecha')}
                disabled={ocupada}
                className={`${botonBase} bg-lime-400 text-navy-700 hover:bg-lime-300`}
              >
                <Check size={12} strokeWidth={3} /> Marcar hecha
              </button>
            </>
          )}
          {hecha && (
            <button
              onClick={() => onEstado('pendiente')}
              disabled={ocupada}
              title="Reabrir la tarea"
              className={`${botonBase} text-gray-500 hover:text-navy-700`}
            >
              <Undo2 size={12} /> Reabrir
            </button>
          )}
          {ocupada && <Loader2 size={12} className="animate-spin text-gray-300" />}
        </div>
      )}
    </article>
  );
}

/**
 * Modal de alta/edición con lo que no entra en un renglón. Va por PORTAL a
 * <body> sí o sí: los contenedores del panel tienen transform (fade-in / framer)
 * y un ancestro con transform rompe el `position: fixed`.
 */
function TareaModal({ tarea, equipo, adminEmail, onClose, onGuardada }: {
  tarea: Tarea;
  equipo: MiembroEquipo[];
  adminEmail: string;
  onClose: () => void;
  onGuardada: (esNueva: boolean) => void;
}) {
  const esNueva = tarea.id === '';
  const [titulo, setTitulo] = useState(tarea.titulo);
  const [detalle, setDetalle] = useState(tarea.detalle);
  const [asignado, setAsignado] = useState(tarea.asignadoA ?? '');
  const [prioridad, setPrioridad] = useState<TareaPrioridad>(tarea.prioridad);
  const [estado, setEstado] = useState<TareaEstado>(tarea.estado);
  const [vence, setVence] = useState(tarea.venceEl ? tarea.venceEl.slice(0, 10) : '');
  const [guardando, setGuardando] = useState(false);

  const cerrar = useCallback(() => { if (!guardando) onClose(); }, [guardando, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', onKey);
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflowPrevio;
    };
  }, [cerrar]);

  // Si la tarea está asignada a alguien que ya no figura en el equipo (dado de
  // baja, o el equipo no cargó), igual se lo muestra: no se pierde el dato.
  const opciones = useMemo(() => {
    const lista = equipo.map(m => ({ email: m.email, label: m.name.trim() !== '' ? m.name : m.email }));
    const actual = tarea.asignadoA;
    if (actual && !lista.some(o => o.email.toLowerCase() === actual.toLowerCase())) {
      lista.push({ email: actual, label: actual });
    }
    return lista;
  }, [equipo, tarea.asignadoA]);

  const hoy = diaEnMvd(Date.now());
  const manana = diaEnMvd(Date.now() + DIA_MS);
  const listo = titulo.trim() !== '';

  const guardar = async () => {
    if (!listo || guardando) return;
    setGuardando(true);
    const ahora = new Date().toISOString();
    const payload: Tarea = {
      ...tarea,
      titulo: titulo.trim(),
      detalle: detalle.trim(),
      estado,
      prioridad,
      asignadoA: asignado === '' ? null : asignado,
      creadoPor: tarea.creadoPor || adminEmail,
      venceEl: vence === '' ? null : vence,
      completadaAt: estado === 'hecha' ? (tarea.completadaAt || ahora) : null,
      updatedAt: ahora,
    };
    try {
      const ok = await SupabaseService.saveTarea(payload);
      if (!ok) {
        toast.error('No se pudo guardar la tarea. Probá de nuevo.');
        return;
      }
      toast.success(esNueva ? 'Tarea anotada ✓' : 'Tarea guardada ✓');
      onGuardada(esNueva);
    } catch (e) {
      console.error('Error guardando tarea:', e);
      toast.error('No se pudo guardar la tarea. Probá de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  const botonFecha = 'rounded-lg border border-gray-200 px-2.5 py-1 font-display text-[11px] font-bold text-gray-500 transition-colors hover:border-navy-700 hover:text-navy-700';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={cerrar} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={esNueva ? 'Nueva tarea' : 'Editar tarea'}
        className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h3 className="font-display text-lg font-bold text-navy-700">
            {esNueva ? 'Nueva tarea' : 'Editar tarea'}
          </h3>
          <button
            onClick={cerrar}
            disabled={guardando}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy-700 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div>
            <label htmlFor="tarea-titulo" className={labelClass}>¿Qué hay que hacer?</label>
            <input
              id="tarea-titulo"
              type="text"
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder="Ej: pedir remeras talle M"
              autoFocus
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="tarea-detalle" className={labelClass}>Detalle (opcional)</label>
            <textarea
              id="tarea-detalle"
              value={detalle}
              onChange={e => setDetalle(e.target.value)}
              rows={3}
              placeholder="Lo que haga falta aclarar"
              className={`${inputClass} resize-y`}
            />
          </div>

          <div>
            <label htmlFor="tarea-asignado" className={labelClass}>¿Quién la tiene?</label>
            <select
              id="tarea-asignado"
              value={asignado}
              onChange={e => setAsignado(e.target.value)}
              className={inputClass}
            >
              <option value="">Sin asignar</option>
              {opciones.map(o => (
                <option key={o.email} value={o.email}>{o.label}</option>
              ))}
            </select>
            {opciones.length === 0 && (
              <p className="mt-1 text-[11px] text-gray-400">
                No se pudo leer el equipo. Guardala igual y asigná después con «Actualizar».
              </p>
            )}
          </div>

          <div>
            <span className={labelClass}>Prioridad</span>
            <div className="grid grid-cols-3 gap-2">
              {PRIORIDADES.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPrioridad(p.id)}
                  aria-pressed={prioridad === p.id}
                  className={`rounded-lg border py-2 font-display text-sm font-bold transition-colors ${
                    prioridad === p.id ? p.activo : 'border-gray-200 text-gray-500 hover:border-navy-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="tarea-vence" className={labelClass}>¿Para cuándo?</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="tarea-vence"
                type="date"
                value={vence}
                onChange={e => setVence(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-navy-700 focus:border-lime-400 focus:outline-none"
              />
              <button type="button" onClick={() => setVence(hoy)} className={botonFecha}>Hoy</button>
              <button type="button" onClick={() => setVence(manana)} className={botonFecha}>Mañana</button>
              {vence !== '' && (
                <button type="button" onClick={() => setVence('')} className={botonFecha}>Sin fecha</button>
              )}
            </div>
          </div>

          {!esNueva && (
            <div>
              <span className={labelClass}>Estado</span>
              <div className="grid grid-cols-3 gap-2">
                {ESTADOS.map(e => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setEstado(e.id)}
                    aria-pressed={estado === e.id}
                    className={`rounded-lg border py-2 font-display text-sm font-bold transition-colors ${
                      estado === e.id
                        ? 'border-navy-700 bg-navy-700 text-white'
                        : 'border-gray-200 text-gray-500 hover:border-navy-700'
                    }`}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 p-4">
          <button
            onClick={() => void guardar()}
            disabled={!listo || guardando}
            className="w-full rounded-lg bg-lime-400 py-3 font-display text-sm font-bold text-navy-700 transition-colors hover:bg-lime-300 disabled:bg-gray-200 disabled:text-gray-400"
          >
            {guardando ? 'Guardando…' : esNueva ? 'Anotar tarea' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
