import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, CalendarDays, Check, CheckCheck, Circle, Clock, ListTodo, Loader2, Pencil,
  Plus, RefreshCw, SlidersHorizontal, Trash2, Undo2, UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { MiembroEquipo, Tarea, TareaEstado, TareaPrioridad } from '../types';
import { SupabaseService } from '../services/supabaseService';
import { normalizar } from '../utils/nombres';
import {
  AreaTexto, BarraFiltros, Boton, BotonIcono, Campo, CargandoFilas, Chip, Dialogo,
  EncabezadoPagina, Entrada, ErrorEstado, Insignia, Segmentado, Selector, Tarjeta, type TonoInsignia,
} from '../admin/ui';
import { cn } from '../lib/cn';

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
  { id: 'hecha', label: 'Hecha', icono: CheckCheck, acento: 'text-emerald-600' },
];

const VACIO: Record<TareaEstado, string> = {
  pendiente: 'Nada pendiente por ahora',
  en_curso: 'Nada en curso',
  hecha: 'Todavía nada terminado',
};

const PRIORIDADES: { valor: TareaPrioridad; texto: string }[] = [
  { valor: 'baja', texto: 'Baja' },
  { valor: 'normal', texto: 'Normal' },
  { valor: 'alta', texto: 'Alta' },
];

const ESTADOS: { valor: TareaEstado; texto: string }[] = [
  { valor: 'pendiente', texto: 'Pendiente' },
  { valor: 'en_curso', texto: 'En curso' },
  { valor: 'hecha', texto: 'Hecha' },
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
): { texto: string; tono: TonoInsignia; vencida: boolean } | null => {
  if (!t.venceEl) return null;
  const dia = t.venceEl.slice(0, 10);
  if (t.estado === 'hecha') return { texto: fechaCorta(dia), tono: 'neutro', vencida: false };
  if (dia < hoy) return { texto: `vencida · ${fechaCorta(dia)}`, tono: 'alerta', vencida: true };
  if (dia === hoy) return { texto: 'hoy', tono: 'atencion', vencida: false };
  if (dia === manana) return { texto: 'mañana', tono: 'navy', vencida: false };
  return { texto: fechaCorta(dia), tono: 'neutro', vencida: false };
};

/** Rótulo de un grupo de botones (Segmentado no es un input: no va dentro de Campo). */
const rotuloGrupo = 'mb-1.5 block text-[13px] font-semibold text-navy-700';

/** Mismo texto que usa Dialogo al tocar afuera: Cancelar tiene que preguntar igual. */
const confirmarDescarte = (sucio: boolean): boolean =>
  !sucio || window.confirm('Tenés cambios sin guardar. ¿Descartarlos?');

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
    <div>
      <EncabezadoPagina
        rotulo="Equipo"
        titulo="Tareas"
        descripcion="La agenda compartida: anotá en un renglón y mové cada tarea con un toque."
        acciones={(
          <Boton
            variante="secundario"
            onClick={() => void cargar()}
            disabled={recargando}
            icono={<RefreshCw size={16} className={recargando ? 'animate-spin' : undefined} />}
          >
            Actualizar
          </Boton>
        )}
      />

      {/* Alta rápida: un renglón + Enter. Lo demás (detalle, asignado, prioridad,
          fecha) sale por el botón de al lado, que se lleva lo ya escrito. */}
      <Tarjeta className="mb-5">
        <form
          onSubmit={e => { e.preventDefault(); void anotarRapido(); }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <label htmlFor="tarea-rapida" className="sr-only">¿Qué hay que hacer?</label>
          <Entrada
            id="tarea-rapida"
            type="text"
            value={nuevoTitulo}
            onChange={e => setNuevoTitulo(e.target.value)}
            placeholder="¿Qué hay que hacer?"
            autoComplete="off"
            enterKeyHint="done"
            className="sm:flex-1"
          />
          <div className="grid grid-cols-2 gap-2 sm:flex">
            {/* Sin `cargando`: ese prop deshabilita, y acá se puede seguir anotando
                mientras la anterior viaja (cada una tiene su tarjeta temporal). */}
            <Boton
              type="submit"
              disabled={nuevoTitulo.trim() === ''}
              icono={creando ? <Loader2 size={17} className="animate-spin" /> : <Plus size={17} strokeWidth={2.5} />}
            >
              Anotar
            </Boton>
            <Boton
              variante="secundario"
              onClick={() => setEditando(tareaVacia(adminEmail, nuevoTitulo.trim()))}
              title="Anotar con detalle, asignado, prioridad y fecha"
              icono={<SlidersHorizontal size={16} />}
            >
              Con detalle
            </Boton>
          </div>
        </form>
        <p className="mt-2 text-[13px] text-gray-500">
          Enter la anota a tu nombre y queda en <b className="font-semibold text-navy-700">Pendiente</b>.
          Con «Con detalle» le ponés a quién, prioridad y para cuándo.
        </p>
      </Tarjeta>

      {/* Resumen — la lectura de un vistazo antes de mirar las columnas */}
      {!cargandoInicial && !falloCarga && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Insignia tono="navy">
            <ListTodo size={13} /> {resumen.abiertas} sin terminar
          </Insignia>
          {resumen.paraHoy > 0 && (
            <Insignia tono="atencion">
              <CalendarDays size={13} /> {resumen.paraHoy} para hoy
            </Insignia>
          )}
          {resumen.vencidas > 0 && (
            <Insignia tono="alerta" punto>
              {resumen.vencidas} {resumen.vencidas === 1 ? 'vencida' : 'vencidas'}
            </Insignia>
          )}
        </div>
      )}

      {/* Filtros + buscador */}
      <BarraFiltros
        busqueda={busqueda}
        alBuscar={setBusqueda}
        placeholder="Buscar tarea, persona…"
        chips={filtros.map(f => (
          <Chip key={f.id} activo={filtro === f.id} onClick={() => setFiltro(f.id)}>
            {f.label}
          </Chip>
        ))}
      />

      {cargandoInicial ? (
        <CargandoFilas filas={4} />
      ) : falloCarga ? (
        <ErrorEstado
          mensaje="No se pudieron cargar las tareas. Puede ser la sesión vencida: entrá de nuevo y probá otra vez."
          alReintentar={() => void cargar()}
        />
      ) : (
        /* Tres columnas en desktop, apiladas en el celular */
        <div className="grid gap-5 md:grid-cols-3 md:gap-4">
          {COLUMNAS.map(col => {
            const lista = porEstado[col.id];
            const esHecha = col.id === 'hecha';
            const mostradas = esHecha && !verHechas ? lista.slice(0, LIMITE_HECHAS) : lista;
            const Icono = col.icono;
            return (
              <section key={col.id} aria-label={col.label}>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <Icono size={15} className={col.acento} />
                  <h2 className="font-display text-sm font-bold uppercase tracking-wide text-navy-700">
                    {col.label}
                  </h2>
                  <Insignia tono="neutro" className="tabular-nums">{lista.length}</Insignia>
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
                    <p className="rounded-xl border border-dashed border-gray-300 px-3 py-6 text-center text-[13px] text-gray-500">
                      {busqueda.trim() !== '' || filtro !== 'todas'
                        ? 'Nada con este filtro'
                        : VACIO[col.id]}
                    </p>
                  )}
                  {esHecha && lista.length > LIMITE_HECHAS && (
                    <Boton variante="fantasma" anchoCompleto onClick={() => setVerHechas(v => !v)}>
                      {verHechas ? 'Ver menos' : `Ver todas (${lista.length})`}
                    </Boton>
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
  const vencida = venc !== null && venc.vencida;

  return (
    <article
      className={cn(
        'rounded-xl border bg-white p-3 transition-opacity',
        hecha ? 'border-gray-200 opacity-70' : vencida ? 'border-red-300' : 'border-gray-200',
      )}
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1 pt-2.5">
          <p className={cn(
            'break-words text-[15px] font-semibold leading-snug',
            hecha ? 'text-gray-500 line-through' : 'text-navy-700',
          )}>
            {tarea.titulo}
          </p>
          {tarea.detalle.trim() !== '' && (
            <p className="mt-1 line-clamp-2 text-[13px] text-gray-500">{tarea.detalle}</p>
          )}
        </div>
        {/* 44px cada uno: se toca con el pulgar, no con la uña. */}
        <div className="-mr-1 -mt-0.5 flex shrink-0 items-center">
          <BotonIcono
            etiqueta={`Editar «${tarea.titulo}»`}
            icono={<Pencil size={17} />}
            onClick={onEditar}
            disabled={ocupada}
          />
          <BotonIcono
            etiqueta={`Borrar «${tarea.titulo}»`}
            icono={<Trash2 size={17} />}
            tono="peligro"
            onClick={onPedirBorrar}
            disabled={ocupada}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Insignia tono={tarea.asignadoA ? 'navy' : 'neutro'}>
          <UserRound size={12} /> {quien}
        </Insignia>
        {/* Prioridad: solo se canta si es alta (rojo) o baja (gris tenue). La
            normal no ocupa lugar, que es el caso del 90% de las tareas. */}
        {tarea.prioridad === 'alta' && !hecha && <Insignia tono="alerta">Alta</Insignia>}
        {tarea.prioridad === 'baja' && !hecha && <Insignia tono="neutro">Baja</Insignia>}
        {venc && <Insignia tono={venc.tono} punto={venc.vencida}>{venc.texto}</Insignia>}
      </div>

      {confirmando ? (
        <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2">
          <p className="px-1 pb-2 text-[13px] font-semibold text-red-800">¿Borrar esta tarea?</p>
          <div className="grid grid-cols-2 gap-2">
            <Boton variante="secundario" onClick={onCancelarBorrar}>No</Boton>
            <Boton variante="peligro" onClick={onBorrar} icono={<Trash2 size={16} />}>Sí, borrar</Boton>
          </div>
        </div>
      ) : (
        // Botones con borde y no llenos: con 10 tarjetas, 10 bloques azules pesaban
        // más que las tareas mismas. El tilde verde ya dice cuál es "Hecha".
        <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
          {tarea.estado === 'pendiente' && (
            <div className="grid flex-1 grid-cols-2 gap-2">
              <Boton
                variante="secundario"
                onClick={() => onEstado('en_curso')}
                disabled={ocupada}
                icono={<ArrowRight size={16} />}
                className="px-3"
              >
                En curso
              </Boton>
              <Boton
                variante="secundario"
                onClick={() => onEstado('hecha')}
                disabled={ocupada}
                icono={<Check size={16} strokeWidth={3} className="text-emerald-600" />}
                className="px-3"
              >
                Hecha
              </Boton>
            </div>
          )}
          {tarea.estado === 'en_curso' && (
            <div className="grid flex-1 grid-cols-2 gap-2">
              <Boton
                variante="fantasma"
                onClick={() => onEstado('pendiente')}
                disabled={ocupada}
                title="Volver a Pendiente"
                icono={<Undo2 size={16} />}
                className="px-3"
              >
                Pendiente
              </Boton>
              <Boton
                variante="secundario"
                onClick={() => onEstado('hecha')}
                disabled={ocupada}
                icono={<Check size={16} strokeWidth={3} className="text-emerald-600" />}
                className="px-3"
              >
                Hecha
              </Boton>
            </div>
          )}
          {hecha && (
            <Boton
              variante="fantasma"
              onClick={() => onEstado('pendiente')}
              disabled={ocupada}
              title="Reabrir la tarea"
              icono={<Undo2 size={16} />}
              className="-ml-2 px-3"
            >
              Reabrir
            </Boton>
          )}
          {ocupada && (
            <Loader2 size={16} className="shrink-0 animate-spin text-gray-400" aria-label="Guardando" />
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Modal de alta/edición con lo que no entra en un renglón. Usa el Dialogo del
 * kit, que va por PORTAL a <body>: los contenedores del panel tienen transform
 * (fade-in / framer) y un ancestro con transform rompe el `position: fixed`.
 * Dialogo además trae Escape, foco adentro, pie fijo en el celular y pregunta
 * antes de descartar lo escrito.
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

  // Tocar afuera / Escape / Cancelar no tiran lo escrito sin preguntar.
  const sucio = titulo !== tarea.titulo
    || detalle !== tarea.detalle
    || asignado !== (tarea.asignadoA ?? '')
    || prioridad !== tarea.prioridad
    || estado !== tarea.estado
    || vence !== (tarea.venceEl ? tarea.venceEl.slice(0, 10) : '');

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

  const idForm = 'tarea-form';

  return (
    <Dialogo
      abierto
      titulo={esNueva ? 'Nueva tarea' : 'Editar tarea'}
      alCerrar={onClose}
      ocupado={guardando}
      sucio={sucio}
      pie={(
        <>
          <Boton variante="secundario" onClick={() => { if (confirmarDescarte(sucio)) onClose(); }} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton type="submit" form={idForm} disabled={!listo} cargando={guardando}>
            {esNueva ? 'Anotar tarea' : 'Guardar cambios'}
          </Boton>
        </>
      )}
    >
      {/* Un <form> de verdad: Enter en el título guarda, como en el alta rápida. */}
      <form id={idForm} onSubmit={e => { e.preventDefault(); void guardar(); }} className="space-y-5">
        <Campo etiqueta="¿Qué hay que hacer?" requerido>
          <Entrada
            type="text"
            value={titulo}
            onChange={e => setTitulo(e.target.value)}
            placeholder="Ej: pedir remeras talle M"
            autoComplete="off"
          />
        </Campo>

        <Campo etiqueta="Detalle" ayuda="Opcional: lo que haga falta aclarar.">
          <AreaTexto
            value={detalle}
            onChange={e => setDetalle(e.target.value)}
            rows={3}
            className="resize-y"
          />
        </Campo>

        <Campo
          etiqueta="¿Quién la tiene?"
          ayuda={opciones.length === 0 ? 'No se pudo leer el equipo. Guardala igual y asigná después con «Actualizar».' : undefined}
        >
          <Selector value={asignado} onChange={e => setAsignado(e.target.value)}>
            <option value="">Sin asignar</option>
            {opciones.map(o => (
              <option key={o.email} value={o.email}>{o.label}</option>
            ))}
          </Selector>
        </Campo>

        <div>
          <span className={rotuloGrupo}>Prioridad</span>
          <Segmentado
            etiqueta="Prioridad"
            opciones={PRIORIDADES}
            valor={prioridad}
            alCambiar={setPrioridad}
            anchoCompleto
          />
        </div>

        <div>
          <label htmlFor="tarea-vence" className={rotuloGrupo}>¿Para cuándo?</label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Entrada
              id="tarea-vence"
              type="date"
              value={vence}
              onChange={e => setVence(e.target.value)}
              className="sm:w-48"
            />
            <div className="flex gap-2">
              <Boton variante="secundario" className="flex-1 px-4 sm:flex-none" onClick={() => setVence(hoy)}>Hoy</Boton>
              <Boton variante="secundario" className="flex-1 px-4 sm:flex-none" onClick={() => setVence(manana)}>Mañana</Boton>
              {vence !== '' && (
                <Boton variante="fantasma" className="flex-1 px-3 sm:flex-none" onClick={() => setVence('')}>Sin fecha</Boton>
              )}
            </div>
          </div>
        </div>

        {!esNueva && (
          <div>
            <span className={rotuloGrupo}>Estado</span>
            <Segmentado
              etiqueta="Estado"
              opciones={ESTADOS}
              valor={estado}
              alCambiar={setEstado}
              anchoCompleto
            />
          </div>
        )}
      </form>
    </Dialogo>
  );
}
