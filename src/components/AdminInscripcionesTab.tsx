import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BadgeCheck, ClipboardList, DollarSign, FileDown, Lightbulb, Pencil, Plus, RefreshCw, Search, Users } from 'lucide-react';
import { asignacionesAGuardar, matchearDupr, parsearDuprPegado } from '../utils/dupr';
import type { EstadoMatch, JugadorPadron, MatchDupr } from '../utils/dupr';
import { exportPlanillaExcel } from '../utils/inscripcionesExcel';
import { toast } from 'sonner';
import type { Event, Inscripcion, TarifaEvento } from '../types';
import { SupabaseService } from '../services/supabaseService';
import {
  armarSeccionesCategoria, buscanPareja, categoriasDe, costoInscripcion, estadisticasTorneo, faltaInscribirse,
  parejaDe, resumenArmado, MARCA_INSC_VISTAS, MIN_UNIDADES_VIABLE, marcaVisitaPrevia,
} from '../utils/inscripciones';
import { distancia, normalizar } from '../utils/nombres';

const money = (n: number) => '$ ' + n.toLocaleString('es-UY', { maximumFractionDigits: 0 });
const METODO_LBL: Record<string, string> = {
  mp: 'Mercado Pago', efectivo: 'Efectivo', transferencia: 'Transferencia', freepass: 'Free pass',
};
import { fechaHumana } from '../utils/fechas';
import { waUruguay } from '../utils/telefono';

const ESTADO_CHIP: Record<Inscripcion['estado'], string> = {
  pendiente: 'bg-amber-50 text-amber-700',
  confirmada: 'bg-green-50 text-green-700',
  baja: 'bg-gray-100 text-gray-500',
};

/**
 * Pestaña Inscripciones del admin: recientes de un evento (con acciones de
 * estado, como el viejo modal de Eventos) y vista "spliteada" por categoría
 * con duplas armadas por mención mutua, como la planilla.
 */
export default function AdminInscripcionesTab({ events, eventoInicialId, alVerla }: {
  events: Event[];
  /** Evento preseleccionado cuando se llega desde el atajo de la pestaña Eventos. */
  eventoInicialId: string | null;
  /** AdminPage apaga el badge de nuevas cuando la pestaña se abre. */
  alVerla: () => void;
}) {
  // Eventos elegibles: abiertos primero (próximos antes), después el resto por fecha desc.
  const elegibles = [...events].sort((a, b) => {
    const abiertoA = a.inscripcionesAbiertas ? 0 : 1;
    const abiertoB = b.inscripcionesAbiertas ? 0 : 1;
    if (abiertoA !== abiertoB) return abiertoA - abiertoB;
    return (b.date || '').localeCompare(a.date || '');
  });
  const [eventoId, setEventoId] = useState<string | null>(eventoInicialId ?? elegibles[0]?.id ?? null);
  const evt = events.find(e => e.id === eventoId) ?? null;

  const [filas, setFilas] = useState<Inscripcion[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [cambiando, setCambiando] = useState<string | null>(null);
  const [vista, setVista] = useState<'recientes' | 'categorias'>('recientes');
  // Alta/edición manual: 'nueva' abre el modal vacío, una Inscripcion lo abre precargado.
  const [editando, setEditando] = useState<Inscripcion | 'nueva' | null>(null);
  // Registro de pago (solo eventos con tarifa) y buscador de jugadores.
  const [pagando, setPagando] = useState<Inscripcion | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [duprAbierto, setDuprAbierto] = useState(false);
  // Tocar una tarjeta del semáforo abre esa categoría en la vista Por categoría
  // (scroll + resaltado breve).
  const [catDestacada, setCatDestacada] = useState<string | null>(null);
  useEffect(() => {
    if (!catDestacada || vista !== 'categorias') return;
    document.getElementById('sec-' + catDestacada.replace(/\s+/g, '-'))
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const t = setTimeout(() => setCatDestacada(null), 2500);
    return () => clearTimeout(t);
  }, [catDestacada, vista]);
  const abrirCategoria = (c: string) => {
    setBusqueda('');
    setVista('categorias');
    setCatDestacada(c);
  };
  // Nombres del padrón para los datalist del modal (se cargan al abrirlo por primera vez).
  const [nombresPadron, setNombresPadron] = useState<string[] | null>(null);
  useEffect(() => {
    if (editando === null || nombresPadron !== null) return;
    let vivo = true;
    void SupabaseService.getJugadoresNombres().then(ns => { if (vivo) setNombresPadron(ns); });
    return () => { vivo = false; };
  }, [editando, nombresPadron]);

  // La marca de visita ANTERIOR (congelada por carga de página, ver utils)
  // pinta el chip «nueva»; al montar se pisa la guardada con ahora y el badge
  // del panel se apaga vía alVerla.
  useEffect(() => {
    marcaVisitaPrevia(); // congela la previa antes de pisarla
    localStorage.setItem(MARCA_INSC_VISTAS, new Date().toISOString());
    alVerla();
    // Solo al montar: alVerla es estable a efectos prácticos (setState del padre).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargar = useCallback(async () => {
    if (!eventoId) { setFilas([]); return; }
    const data = await SupabaseService.getInscripciones(eventoId);
    if (data === null) { setFallo(true); return; }
    setFallo(false);
    setFilas(data);
  }, [eventoId]);

  useEffect(() => {
    setFilas(null);
    setFallo(false);
    void cargar();
  }, [cargar]);

  const refrescar = async () => {
    setRefrescando(true);
    try { await cargar(); } finally { setRefrescando(false); }
  };

  const [exportando, setExportando] = useState(false);
  const exportar = async () => {
    if (!evt || !filas || exportando) return;
    setExportando(true);
    try {
      await exportPlanillaExcel(evt, filas);
    } catch (e) {
      console.error('Error exportando planilla:', e);
      toast.error('No se pudo generar el Excel');
    } finally {
      setExportando(false);
    }
  };

  const cambiarEstado = async (id: string, estado: Inscripcion['estado']) => {
    if (cambiando) return;
    setCambiando(id);
    try {
      const ok = await SupabaseService.setEstadoInscripcion(id, estado);
      if (!ok) { toast.error('No se pudo actualizar. Verificá tu sesión de admin.'); return; }
      await cargar();
    } finally {
      setCambiando(null);
    }
  };

  const ahoraMs = Date.now();
  const activos = (filas ?? []).filter(f => f.estado !== 'baja');
  const bajas = (filas ?? []).filter(f => f.estado === 'baja');
  const recientes = [...activos].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Buscador: matchea nombre y parejas declaradas, sin tildes. Solo filtra la
  // vista Recientes (al escribir se salta ahí; las secciones no se rompen).
  const q = normalizar(busqueda);
  const matchBusqueda = (i: Inscripcion) =>
    q === '' || normalizar(i.nombre).includes(q)
    || Object.values(i.parejas).some(p => normalizar(p).includes(q))
    || normalizar(i.pareja).includes(q);
  const recientesFiltradas = recientes.filter(matchBusqueda);
  const bajasFiltradas = bajas.filter(matchBusqueda);

  // Cobros (solo eventos con tarifa): resumen arriba + chip por fila.
  const tarifa: TarifaEvento | null = evt?.tarifa ?? null;
  const cobrado = activos.reduce((s, i) => s + (i.pagoAt ? (i.pagoMonto ?? 0) : 0), 0);
  const enDeuda = activos.reduce((s, i) => s + (i.pagoAt ? (i.pagoDeuda ?? 0) : 0), 0);
  const sinRegistrar = tarifa ? activos.filter(i => !i.pagoAt) : [];
  const sinRegistrarTotal = tarifa
    ? sinRegistrar.reduce((s, i) => s + costoInscripcion(categoriasDe(i).length, tarifa), 0)
    : 0;
  const esNueva = (i: Inscripcion) => i.createdAt > marcaVisitaPrevia();
  const linkPublico = evt ? `volea.vercel.app/#/inscripcion/${evt.id}` : '';

  const parejasDeFila = (i: Inscripcion): { categoria: string; pareja: string }[] =>
    categoriasDe(i)
      .filter(c => c.toLowerCase().includes('doble'))
      .map(c => ({ categoria: c, pareja: parejaDe(i, c) }));

  const filaAcciones = (i: Inscripcion) => (
    <div className="mt-2 flex flex-wrap gap-2">
      <button onClick={() => setEditando(i)} disabled={cambiando !== null}
        className="inline-flex items-center gap-1 rounded-lg bg-navy-700/10 px-3 py-1 text-xs font-bold text-navy-700 hover:bg-navy-700/20 disabled:opacity-50">
        <Pencil size={12} /> Editar
      </button>
      {tarifa && !i.pagoAt && i.estado !== 'baja' && (
        <button onClick={() => setPagando(i)} disabled={cambiando !== null}
          className="inline-flex items-center gap-1 rounded-lg bg-lime-400 px-3 py-1 text-xs font-bold text-navy-700 hover:bg-lime-300 disabled:opacity-50">
          <DollarSign size={12} /> Registrar pago
        </button>
      )}
      {i.estado !== 'confirmada' && (
        <button onClick={() => void cambiarEstado(i.id, 'confirmada')} disabled={cambiando !== null}
          className="rounded-lg bg-green-50 px-3 py-1 text-xs font-bold text-green-700 hover:bg-green-100 disabled:opacity-50">
          {cambiando === i.id ? '…' : 'Confirmar'}
        </button>
      )}
      {i.estado !== 'pendiente' && (
        <button onClick={() => void cambiarEstado(i.id, 'pendiente')} disabled={cambiando !== null}
          className="rounded-lg bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50">
          A pendiente
        </button>
      )}
      {i.estado !== 'baja' && (
        <button onClick={() => void cambiarEstado(i.id, 'baja')} disabled={cambiando !== null}
          className="rounded-lg bg-gray-100 px-3 py-1 text-xs font-bold text-gray-500 hover:bg-gray-200 disabled:opacity-50">
          Dar de baja
        </button>
      )}
    </div>
  );

  const filaPersona = (i: Inscripcion) => (
    <div key={i.id} className={`rounded-xl border border-gray-100 bg-white p-3 ${i.estado === 'baja' ? 'opacity-50' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display font-bold text-navy-700">{i.nombre}</span>
        {esNueva(i) && i.estado !== 'baja' && (
          <span className="rounded-full bg-lime-400 px-2 py-0.5 text-[11px] font-bold text-navy-700">nueva</span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ESTADO_CHIP[i.estado]}`}>{i.estado}</span>
        {tarifa && i.estado !== 'baja' && (
          i.pagoAt ? (
            i.pagoMetodo === 'freepass' ? (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">FREE PASS</span>
            ) : (i.pagoDeuda ?? 0) > 0 ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                pagó {money(i.pagoMonto ?? 0)} · debe {money(i.pagoDeuda ?? 0)}
              </span>
            ) : (
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold text-green-700">
                pagó {money(i.pagoMonto ?? 0)} · {METODO_LBL[i.pagoMetodo ?? ''] ?? i.pagoMetodo}
              </span>
            )
          ) : (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">
              a cobrar {money(costoInscripcion(categoriasDe(i).length, tarifa))}
            </span>
          )
        )}
        {i.duprId && <span className="rounded-full bg-navy-700/10 px-2 py-0.5 text-[11px] font-bold text-navy-700">DUPR {i.duprId}</span>}
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {categoriasDe(i).map(c => (
          <span key={c} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">{c}</span>
        ))}
      </div>
      {parejasDeFila(i).length > 0 && (
        <div className="mt-1 space-y-0.5 text-xs text-gray-500">
          {parejasDeFila(i).map(({ categoria, pareja }) => (
            <p key={categoria}>
              <span className="font-semibold text-gray-600">{categoria}:</span>{' '}
              {pareja || <span className="italic text-amber-600">pareja a confirmar</span>}
            </p>
          ))}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-gray-400">
        {waUruguay(i.celular) ? (
          <a href={`https://wa.me/${waUruguay(i.celular)}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-lime-800 hover:underline">
            {i.celular}
          </a>
        ) : (i.celular && <span>{i.celular}</span>)}
        {i.email && <span>{i.email}</span>}
        <span>{fechaHumana(i.createdAt, ahoraMs)}</span>
      </div>
      {i.notas && <p className="mt-1 text-xs italic text-gray-500">"{i.notas}"</p>}
      {filaAcciones(i)}
    </div>
  );

  const porId = new Map(activos.map(i => [i.id, i]));
  const secciones = evt && filas
    ? armarSeccionesCategoria(filas, (evt.categorias || '').split(',').map(c => c.trim()).filter(Boolean))
    : [];
  // Gestión del armado: semáforo, quiénes buscan pareja (con cruces) y quiénes
  // fueron declarados como pareja pero no se anotaron.
  const armado = resumenArmado(secciones, filas ?? []);
  // Separado por estado (pedido de Brian): qué se juega, qué viene en camino y
  // qué está flojo — dentro de cada grupo, las que tienen gente primero.
  const porGente = (a: typeof armado[number], b: typeof armado[number]) => b.totalPersonas - a.totalPersonas;
  const gruposArmado = [
    { titulo: 'Se juegan', nota: `${MIN_UNIDADES_VIABLE}+ duplas/jugadores`, clase: 'text-green-700', items: armado.filter(a => a.nivel === 'verde') },
    { titulo: 'En armado', nota: '2-3, les falta poco', clase: 'text-amber-600', items: armado.filter(a => a.nivel === 'ambar') },
    { titulo: 'Flojas o vacías', nota: '0-1', clase: 'text-gray-400', items: [...armado.filter(a => a.nivel === 'gris')].sort(porGente) },
  ].filter(g => g.items.length > 0);
  const buscan = buscanPareja(secciones, filas ?? []);
  const faltan = faltaInscribirse(filas ?? []);
  const stats = estadisticasTorneo(filas ?? [], armado);
  const PUNTO_NIVEL = { verde: 'bg-green-500', ambar: 'bg-amber-400', gris: 'bg-gray-300' } as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold text-navy-700">
          <ClipboardList size={22} /> Inscripciones
        </h2>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setEditando('nueva')} disabled={!evt}
            className="inline-flex items-center gap-1.5 rounded-lg bg-lime-400 px-3 py-1.5 font-display text-sm font-bold text-navy-700 hover:bg-lime-300 disabled:opacity-50">
            <Plus size={14} /> Nueva inscripción
          </button>
          <button onClick={() => setDuprAbierto(true)}
            title="Cargar DUPR IDs en lote, pegando una lista"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-navy-700 hover:border-navy-700">
            <BadgeCheck size={14} /> DUPR
          </button>
          <button onClick={() => void exportar()} disabled={exportando || !evt || !filas || filas.length === 0}
            title="Descarga el Excel con el formato de la planilla (hojas DOBLES y SINGLES)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-navy-700 hover:border-navy-700 disabled:opacity-50">
            <FileDown size={14} /> {exportando ? 'Exportando…' : 'Exportar planilla'}
          </button>
          <button onClick={() => void refrescar()} disabled={refrescando}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-navy-700 hover:border-navy-700 disabled:opacity-50">
            <RefreshCw size={14} className={refrescando ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      {elegibles.length > 1 && (
        <select
          value={eventoId ?? ''}
          onChange={e => setEventoId(e.target.value)}
          className="w-full max-w-md rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-navy-700 focus:border-lime-400 outline-none sm:w-auto"
          aria-label="Evento"
        >
          {elegibles.map(e => (
            <option key={e.id} value={e.id}>
              {e.name}{e.inscripcionesAbiertas ? ' · inscripción abierta' : ''}
            </option>
          ))}
        </select>
      )}

      {evt && (
        <div className="flex flex-wrap items-center gap-2">
          {([['recientes', 'Recientes'], ['categorias', 'Por categoría']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setVista(id)} aria-pressed={vista === id}
              className={`rounded-full px-4 py-1.5 font-display text-sm font-bold transition-colors ${
                vista === id ? 'bg-navy-700 text-white' : 'bg-gray-100 text-gray-500 hover:text-navy-700'
              }`}>
              {label}
            </button>
          ))}
          {filas && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-sm text-gray-500">
              <Users size={15} /> {activos.length} {activos.length === 1 ? 'inscripción' : 'inscripciones'}
            </span>
          )}
        </div>
      )}

      {/* Buscador de jugadores (filtra Recientes; matchea nombre y parejas) */}
      {evt && filas !== null && filas.length > 0 && (
        <div className="relative max-w-md">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={busqueda}
            onChange={e => { setBusqueda(e.target.value); if (e.target.value.trim() !== '') setVista('recientes'); }}
            placeholder="Buscar jugador o pareja…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-8 text-sm focus:border-lime-400 outline-none"
          />
          {busqueda !== '' && (
            <button onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-navy-700">✕</button>
          )}
        </div>
      )}

      {/* Tarifa y totales de cobro */}
      {evt && tarifa && filas !== null && filas.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-gray-100 bg-white px-4 py-2.5 text-sm">
          <span className="text-gray-500">
            Inscripción <b className="text-navy-700">{money(tarifa.base)}</b> (hasta {tarifa.incluye} categorías)
            + <b className="text-navy-700">{money(tarifa.extra)}</b> c/adicional
          </span>
          <span className="font-semibold text-green-700">Cobrado {money(cobrado)}</span>
          {enDeuda > 0 && <span className="font-semibold text-amber-600">En deuda {money(enDeuda)}</span>}
          {sinRegistrar.length > 0 && (
            <span className="font-semibold text-gray-500">
              Sin registrar {money(sinRegistrarTotal)} ({sinRegistrar.length})
            </span>
          )}
        </div>
      )}

      {/* Números del torneo (pedido de Brian: jugadores, géneros, más jugada, partidos ≈) */}
      {evt && filas !== null && filas.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-gray-100 bg-white px-4 py-2.5 text-sm text-gray-600">
          <span><b className="text-navy-700">{stats.jugadores}</b> jugadores únicos</span>
          <span>
            <b className="text-pink-600">{stats.mujeres}</b> mujeres · <b className="text-blue-700">{stats.hombres}</b> hombres
            {stats.sinGenero > 0 && <span className="text-gray-400"> · {stats.sinGenero} sin definir</span>}
          </span>
          {stats.masJugada && (
            <span>más jugada: <b className="text-navy-700">{stats.masJugada.categoria}</b> ({stats.masJugada.personas})</span>
          )}
          <span title="Estimado grueso: ~2 partidos por dupla/jugador entre grupos y llave, en las categorías con 2+">
            ≈ <b className="text-navy-700">{stats.partidosAprox}</b> partidos estimados
          </span>
        </div>
      )}

      {/* Semáforo de armado, separado por estado (umbral: 4 duplas/jugadores) */}
      {evt && filas !== null && filas.length > 0 && (
        <div className="space-y-3">
          {gruposArmado.map(g => (
            <div key={g.titulo}>
              <p className={`mb-1.5 text-xs font-bold uppercase tracking-wide ${g.clase}`}>
                {g.titulo} ({g.items.length}) <span className="font-normal normal-case text-gray-400">· {g.nota}</span>
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {g.items.map(a => (
                  <button key={a.categoria} type="button"
                    onClick={() => a.totalPersonas > 0 && abrirCategoria(a.categoria)}
                    disabled={a.totalPersonas === 0}
                    title={a.totalPersonas > 0 ? `Ver ${a.categoria}` : undefined}
                    className={`rounded-xl border border-gray-100 bg-white px-3 py-2 text-left transition-colors ${
                      a.totalPersonas === 0 ? 'opacity-50' : 'cursor-pointer hover:border-lime-400 hover:bg-lime-50/50'
                    }`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${PUNTO_NIVEL[a.nivel]}`} />
                      <p className="truncate font-display text-xs font-bold text-navy-700">{a.categoria}</p>
                    </div>
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      {a.totalPersonas === 0
                        ? 'sin anotados'
                        : a.esDoble
                          ? `${a.unidades} ${a.unidades === 1 ? 'dupla' : 'duplas'}${a.buscanPareja > 0 ? ` + ${a.buscanPareja} busca${a.buscanPareja > 1 ? 'n' : ''}` : ''}`
                          : `${a.unidades} ${a.unidades === 1 ? 'jugador' : 'jugadores'}`}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Buscan pareja (con cruces sugeridos) y declarados sin anotarse */}
      {evt && filas !== null && buscan.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-700">Buscan pareja</p>
          <div className="space-y-2">
            {buscan.map(b => (
              <div key={b.categoria}>
                <p className="text-sm text-gray-700">
                  <span className="font-display font-bold text-navy-700">{b.categoria}:</span>{' '}
                  {b.buscan.map(i => i.nombre).join(' · ')}
                </p>
                {b.cruces.map(([aId, bId]) => {
                  const pa = porId.get(aId);
                  const pb = porId.get(bId);
                  if (!pa || !pb) return null;
                  return (
                    <p key={aId + bId} className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-amber-700">
                      <Lightbulb size={12} /> {pa.nombre} + {pb.nombre} podrían jugar juntos
                    </p>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      {evt && filas !== null && faltan.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Falta que se anoten</p>
          <div className="space-y-1">
            {faltan.map(f => (
              <p key={f.nombre} className="text-sm text-gray-700">
                <span className="font-semibold text-navy-700">{f.nombre}</span>
                <span className="text-gray-500">
                  {' — '}la declaró {f.declaradaPor.map(d => `${d.nombre} (${d.categoria})`).join(', ')}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      {!evt && <p className="py-10 text-center text-sm text-gray-400">No hay eventos todavía.</p>}
      {evt && fallo && (
        <p className="py-10 text-center text-sm text-gray-400">No se pudieron cargar. Verificá tu sesión de admin y probá «Actualizar».</p>
      )}
      {evt && !fallo && filas === null && <p className="py-10 text-center text-sm text-gray-400">Cargando…</p>}

      {evt && filas !== null && filas.length === 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-500">
          Todavía no hay inscriptos en {evt.name}.
          <br />Compartí el link: <span className="font-semibold text-navy-700">{linkPublico}</span>
        </div>
      )}

      {evt && filas !== null && filas.length > 0 && vista === 'recientes' && (
        <div className="space-y-2">
          {q !== '' && (
            <p className="text-xs text-gray-400">
              {recientesFiltradas.length} de {recientes.length} inscripciones matchean «{busqueda.trim()}»
            </p>
          )}
          {recientesFiltradas.map(filaPersona)}
          {bajasFiltradas.length > 0 && (
            <>
              <p className="pt-2 text-xs font-bold uppercase tracking-wide text-gray-400">Bajas ({bajasFiltradas.length})</p>
              {bajasFiltradas.map(filaPersona)}
            </>
          )}
        </div>
      )}

      {evt && filas !== null && filas.length > 0 && vista === 'categorias' && (
        <div className="space-y-3">
          {secciones.map(sec => (
            <div key={sec.categoria}
              id={'sec-' + sec.categoria.replace(/\s+/g, '-')}
              className={`scroll-mt-20 rounded-2xl border bg-white p-4 transition-shadow ${
                catDestacada === sec.categoria ? 'border-lime-400 ring-2 ring-lime-400/60' : 'border-gray-100'
              } ${sec.total === 0 ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-2">
                <h3 className="font-display font-bold text-navy-700">{sec.categoria}</h3>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">
                  {sec.categoria.toLowerCase().includes('doble')
                    ? `${sec.duplas.length} ${sec.duplas.length === 1 ? 'dupla' : 'duplas'}${sec.sueltos.length ? ` + ${sec.sueltos.length} sin armar` : ''}`
                    : `${sec.total} ${sec.total === 1 ? 'jugador' : 'jugadores'}`}
                </span>
              </div>
              {sec.total > 0 && (
                <div className="mt-2 space-y-1.5">
                  {sec.duplas.map(([aId, bId]) => {
                    const a = porId.get(aId);
                    const b = porId.get(bId);
                    if (!a || !b) return null;
                    return (
                      <p key={aId + bId} className="text-sm text-gray-700">
                        <span className="font-semibold text-navy-700">{a.nombre}</span>
                        {' + '}
                        <span className="font-semibold text-navy-700">{b.nombre}</span>
                      </p>
                    );
                  })}
                  {sec.sueltos.map(id => {
                    const i = porId.get(id);
                    if (!i) return null;
                    const pareja = parejaDe(i, sec.categoria);
                    const esDoble = sec.categoria.toLowerCase().includes('doble');
                    return (
                      <p key={id} className="text-sm text-gray-700">
                        <span className="font-semibold text-navy-700">{i.nombre}</span>
                        {esDoble && (
                          pareja
                            ? <span className="text-gray-500"> — con {pareja} <span className="text-gray-400">(declarada)</span></span>
                            : <span className="italic text-amber-600"> — pareja a confirmar</span>
                        )}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {duprAbierto && <DuprMasivoModal onClose={() => setDuprAbierto(false)} />}

      {pagando && evt && tarifa && (
        <PagoModal
          key={pagando.id}
          inscripcion={pagando}
          tarifa={tarifa}
          onClose={() => setPagando(null)}
          onDone={() => { setPagando(null); void cargar(); }}
        />
      )}

      {editando !== null && evt && (
        <InscripcionModal
          key={editando === 'nueva' ? 'nueva' : editando.id}
          evento={evt}
          inicial={editando === 'nueva' ? null : editando}
          existentes={activos}
          nombresPadron={nombresPadron ?? []}
          onEditarExistente={i => setEditando(i)}
          onClose={() => setEditando(null)}
          onDone={() => {
            setEditando(null);
            // Puede haber fichas nuevas en el padrón: refrescar el datalist la próxima vez.
            setNombresPadron(null);
            void cargar();
          }}
        />
      )}
    </div>
  );
}

// ─── Carga masiva de DUPR ID ─────────────────────────────────────────────────

const ESTADO_DUPR: Record<EstadoMatch, { chip: string; texto: string }> = {
  nuevo: { chip: 'bg-green-50 text-green-700', texto: 'se carga' },
  actualiza: { chip: 'bg-amber-50 text-amber-700', texto: 'reemplaza el que tenía' },
  igual: { chip: 'bg-gray-100 text-gray-500', texto: 'ya lo tenía igual' },
  dudoso: { chip: 'bg-blue-50 text-blue-700', texto: '¿es esta persona?' },
  'sin-match': { chip: 'bg-red-50 text-red-600', texto: 'no está en el padrón' },
  duplicado: { chip: 'bg-gray-100 text-gray-500', texto: 'repetido en la lista' },
  invalido: { chip: 'bg-red-50 text-red-600', texto: 'no se entiende la línea' },
};

/**
 * Pegar una lista "Nombre, DUPRID" y cargarla al padrón de una. Muestra qué va
 * a hacer con cada línea ANTES de guardar; los nombres parecidos se confirman
 * a mano y los que no están en el padrón se reportan (no se inventa nadie).
 */
function DuprMasivoModal({ onClose }: { onClose: () => void }) {
  const [padron, setPadron] = useState<JugadorPadron[] | null>(null);
  const [texto, setTexto] = useState('');
  const [matches, setMatches] = useState<MatchDupr[] | null>(null);
  // Dudosos que Brian confirmó: línea → jugador elegido.
  const [resueltos, setResueltos] = useState<Record<number, { id: string; nombre: string }>>({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void SupabaseService.getJugadoresPadron().then(p => { if (vivo) setPadron(p); });
    return () => { vivo = false; };
  }, []);

  const analizar = () => {
    if (!padron) return;
    setResueltos({});
    setMatches(matchearDupr(parsearDuprPegado(texto), padron));
  };

  // Los dudosos confirmados entran como asignaciones normales.
  const aGuardar = matches
    ? [
        ...asignacionesAGuardar(matches),
        ...matches
          .filter(m => m.estado === 'dudoso' && resueltos[m.linea])
          .map(m => ({ id: resueltos[m.linea].id, duprId: m.duprId })),
      ]
    : [];

  const guardar = async () => {
    if (aGuardar.length === 0 || guardando) return;
    setGuardando(true);
    try {
      const r = await SupabaseService.setDuprIds(aGuardar);
      if (!r.ok) { toast.error(r.error || 'No se pudo guardar'); return; }
      toast.success(`${r.tocados ?? aGuardar.length} DUPR ID guardados en el padrón ✓`);
      onClose();
    } finally {
      setGuardando(false);
    }
  };

  const conDupr = padron?.filter(j => j.duprId).length ?? 0;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => !guardando && onClose()} />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h3 className="font-display text-lg font-bold text-navy-700">Cargar DUPR IDs</h3>
          <button onClick={onClose} disabled={guardando} aria-label="Cerrar" className="text-gray-400 hover:text-navy-700">✕</button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-sm text-gray-500">
            Pegá una lista de <b className="text-navy-700">Nombre, DUPR ID</b> (uno por línea; sirve copiado de un Excel o de WhatsApp).
            {padron && <> El padrón tiene <b className="text-navy-700">{padron.length}</b> jugadores, {conDupr} con DUPR cargado.</>}
          </p>
          <textarea
            rows={6}
            value={texto}
            onChange={e => setTexto(e.target.value)}
            placeholder={'Gastón Moirano, 7XZ4V2\nPaula Segura, K92MB1\nMia Batista\tQ4LP08'}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm focus:border-lime-400 outline-none"
          />
          <button onClick={analizar} disabled={!padron || texto.trim() === ''}
            className="rounded-lg bg-navy-700 px-4 py-2 font-display text-sm font-bold text-white hover:bg-navy-800 disabled:bg-gray-200 disabled:text-gray-400">
            {padron ? 'Analizar lista' : 'Cargando padrón…'}
          </button>

          {matches && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
                {matches.length} líneas · {aGuardar.length} se van a guardar
              </p>
              {matches.map(m => (
                <div key={m.linea} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm">
                  <span className="font-semibold text-navy-700">{m.nombrePegado}</span>
                  {m.duprId && <span className="rounded bg-navy-700/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-navy-700">{m.duprId}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ESTADO_DUPR[m.estado].chip}`}>
                    {resueltos[m.linea] ? 'se carga' : ESTADO_DUPR[m.estado].texto}
                  </span>
                  {m.estado === 'actualiza' && m.jugador?.duprId && (
                    <span className="text-xs text-gray-400">tenía {m.jugador.duprId}</span>
                  )}
                  {m.estado === 'dudoso' && !resueltos[m.linea] && m.candidatos?.map(c => (
                    <button key={c.id} onClick={() => setResueltos(r => ({ ...r, [m.linea]: c }))}
                      className="rounded-lg border border-blue-300 px-2 py-0.5 text-xs font-bold text-blue-700 hover:bg-blue-50">
                      es {c.nombre}
                    </button>
                  ))}
                  {resueltos[m.linea] && <span className="text-xs text-gray-500">→ {resueltos[m.linea].nombre}</span>}
                  {m.error && <span className="text-xs text-red-500">{m.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 p-4">
          <button onClick={() => void guardar()} disabled={aGuardar.length === 0 || guardando}
            className="w-full rounded-lg bg-lime-400 py-2.5 font-display text-sm font-bold text-navy-700 hover:bg-lime-300 disabled:bg-gray-200 disabled:text-gray-400">
            {guardando ? 'Guardando…' : aGuardar.length > 0 ? `Guardar ${aGuardar.length} DUPR ID` : 'Nada para guardar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Modal de pago de inscripción ────────────────────────────────────────────

/**
 * Registra el pago: costo calculado por tarifa (el server lo recalcula igual),
 * monto editable (lo que falte queda como deuda con el nombre en la Caja) y
 * free pass sin cargo para socios/invitados. Al confirmar, la inscripción pasa
 * a confirmada.
 */
function PagoModal({ inscripcion, tarifa, onClose, onDone }: {
  inscripcion: Inscripcion;
  tarifa: TarifaEvento;
  onClose: () => void;
  onDone: () => void;
}) {
  const nCats = categoriasDe(inscripcion).length;
  const costo = costoInscripcion(nCats, tarifa);
  const extras = Math.max(0, nCats - tarifa.incluye);
  const [metodo, setMetodo] = useState<'efectivo' | 'mp' | 'transferencia' | 'freepass' | null>(null);
  const [monto, setMonto] = useState(String(costo));
  const [guardando, setGuardando] = useState(false);

  const montoNum = metodo === 'freepass' ? 0 : Number(monto);
  const montoOk = Number.isFinite(montoNum) && montoNum >= 0 && montoNum <= costo;
  const deuda = montoOk ? Math.round((costo - montoNum) * 100) / 100 : 0;
  const listo = !!metodo && montoOk && !guardando;

  const confirmar = async () => {
    if (!listo || !metodo) return;
    setGuardando(true);
    try {
      const r = await SupabaseService.pagoInscripcion(inscripcion.id, montoNum, metodo, '');
      if (!r.ok) { toast.error(r.error || 'No se pudo registrar el pago'); return; }
      if (metodo === 'freepass') toast.success(`${inscripcion.nombre}: free pass ✓ (confirmada)`);
      else if ((r.deuda ?? 0) > 0) toast.success(`Pago registrado — quedan ${money(r.deuda ?? 0)} como deuda de ${inscripcion.nombre} en la Caja`);
      else toast.success(`${inscripcion.nombre} pagó ${money(montoNum)} ✓`);
      onDone();
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => !guardando && onClose()} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-navy-700">Pago — {inscripcion.nombre}</h3>
          <button onClick={onClose} disabled={guardando} aria-label="Cerrar" className="text-gray-400 hover:text-navy-700">✕</button>
        </div>

        <div className="mb-3 rounded-xl bg-gray-50 px-4 py-3 text-sm">
          <p className="text-gray-600">
            {nCats} {nCats === 1 ? 'categoría' : 'categorías'}: {money(tarifa.base)}
            {extras > 0 && <> + {extras} × {money(tarifa.extra)}</>}
          </p>
          <p className="mt-0.5 font-display text-xl font-bold text-navy-700">{money(costo)}</p>
        </div>

        <span className="mb-1 block text-xs font-display font-semibold uppercase text-gray-500">¿Cómo paga?</span>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {(['efectivo', 'mp', 'transferencia', 'freepass'] as const).map(m => (
            <button key={m} onClick={() => setMetodo(m)} aria-pressed={metodo === m}
              className={`rounded-lg border py-2 font-display text-xs font-bold transition-colors ${
                metodo === m
                  ? m === 'freepass' ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-navy-700 bg-navy-700 text-white'
                  : 'border-gray-200 text-gray-500 hover:text-navy-700'
              }`}>
              {METODO_LBL[m]}
            </button>
          ))}
        </div>

        {metodo === 'freepass' ? (
          <p className="mb-3 rounded-lg bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700">
            Sin cargo (socios / invitados). No pasa por la Caja y queda confirmada.
          </p>
        ) : (
          <div className="mb-3">
            <label htmlFor="pago-monto" className="mb-1 block text-xs font-display font-semibold uppercase text-gray-500">
              ¿Cuánto paga ahora?
            </label>
            <input id="pago-monto" type="number" min={0} max={costo} step={1} value={monto}
              onChange={e => setMonto(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-lime-400 outline-none" />
            {!montoOk && <p className="mt-1 text-xs text-red-500">Entre 0 y {money(costo)}.</p>}
            {montoOk && deuda > 0 && (
              <p className="mt-1 text-xs font-semibold text-amber-700">
                Quedan {money(deuda)} como deuda de {inscripcion.nombre} en «Por cobrar» de la Caja.
              </p>
            )}
          </div>
        )}

        <button onClick={() => void confirmar()} disabled={!listo}
          className="w-full rounded-lg bg-lime-400 py-2.5 font-display text-sm font-bold text-navy-700 hover:bg-lime-300 disabled:bg-gray-200 disabled:text-gray-400">
          {guardando ? 'Registrando…' : 'Confirmar pago'}
        </button>
      </div>
    </div>
  );
}

// ─── Modal de alta/edición manual ────────────────────────────────────────────

/**
 * Carga o corrige una inscripción desde el admin (las que llegan por WhatsApp).
 * Sin las restricciones del form público: celular opcional y sirve aunque las
 * inscripciones online estén cerradas.
 */
function InscripcionModal({ evento, inicial, existentes, nombresPadron, onEditarExistente, onClose, onDone }: {
  evento: Event;
  inicial: Inscripcion | null;
  /** Inscripciones activas del evento, para avisar duplicados al escribir el nombre. */
  existentes: Inscripcion[];
  nombresPadron: string[];
  /** Saltar a editar la inscripción existente en vez de duplicarla. */
  onEditarExistente: (i: Inscripcion) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  // Opciones de categorías: las del evento más cualquiera que la fila ya tenga
  // (así una etiqueta vieja no desaparece al editar).
  const opciones = [...(evento.categorias || '').split(',').map(c => c.trim()).filter(Boolean)];
  if (inicial) for (const c of categoriasDe(inicial)) if (!opciones.includes(c)) opciones.push(c);

  const [form, setForm] = useState({
    nombre: inicial?.nombre ?? '',
    celular: inicial?.celular ?? '',
    email: inicial?.email ?? '',
    duprId: inicial?.duprId ?? '',
    notas: inicial?.notas ?? '',
  });
  const [cats, setCats] = useState<string[]>(inicial ? categoriasDe(inicial) : []);
  // Al editar, el mapa arranca con parejaDe (materializa también el texto
  // legacy de las filas viejas en el mapa por categoría).
  const [parejas, setParejas] = useState<Record<string, string>>(() => {
    if (!inicial) return {};
    const m: Record<string, string> = {};
    for (const c of categoriasDe(inicial)) {
      if (!c.toLowerCase().includes('doble')) continue;
      const p = parejaDe(inicial, c);
      if (p) m[c] = p;
    }
    return m;
  });
  const [estado, setEstado] = useState<Inscripcion['estado']>(inicial?.estado === 'confirmada' ? 'confirmada' : 'pendiente');
  const [guardando, setGuardando] = useState(false);

  const catsDobles = cats.filter(c => c.toLowerCase().includes('doble'));
  const valido = form.nombre.trim() !== '' && cats.length > 0 && !guardando;

  // Aviso de duplicado: mismo nombre normalizado (sin tildes/mayúsculas) que
  // una inscripción existente → alerta con qué juega y con quién, y salto a
  // editarla. Nombre PARECIDO (typo de 1-2 letras) → aviso más suave.
  const duplicada = useMemo(() => {
    const q = normalizar(form.nombre);
    if (!q) return null;
    return existentes.find(i => i.id !== inicial?.id && normalizar(i.nombre) === q) ?? null;
  }, [form.nombre, existentes, inicial]);
  const parecida = useMemo(() => {
    if (duplicada) return null;
    const q = normalizar(form.nombre);
    if (q.length < 5) return null;
    return existentes.find(i => i.id !== inicial?.id && distancia(normalizar(i.nombre), q) <= 2) ?? null;
  }, [form.nombre, existentes, inicial, duplicada]);

  const resumenDe = (i: Inscripcion) =>
    categoriasDe(i).map(c => {
      const p = parejaDe(i, c);
      return `${c}${p ? ` con ${p}` : ''}`;
    });

  const toggleCat = (c: string) => {
    if (cats.includes(c)) setParejas(p => { const { [c]: _, ...resto } = p; return resto; });
    setCats(prev => (prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]));
  };

  const guardar = async () => {
    if (!valido) return;
    setGuardando(true);
    try {
      const input = {
        eventId: evento.id,
        nombre: form.nombre.trim(),
        celular: form.celular.trim(),
        email: form.email.trim(),
        categorias: cats.join(', '),
        parejas: Object.fromEntries(
          Object.entries(parejas)
            .filter(([c, v]) => catsDobles.includes(c) && v.trim() !== '')
            .map(([c, v]) => [c, v.trim()]),
        ),
        duprId: form.duprId.trim(),
        notas: form.notas.trim(),
        estado,
      };
      const ok = inicial
        ? await SupabaseService.updateInscripcionAdmin(inicial.id, input)
        : await SupabaseService.addInscripcionAdmin(input);
      if (!ok) { toast.error('No se pudo guardar. Verificá tu sesión de admin.'); return; }
      toast.success(inicial ? 'Inscripción actualizada' : 'Inscripción cargada');
      // Todo el que Brian decreta tiene ficha en el padrón: el inscripto y las
      // parejas declaradas (aunque nunca hayan jugado un campeonato).
      const creados = await SupabaseService.asegurarJugadoresPadron([input.nombre, ...Object.values(input.parejas)]);
      if (creados.length > 0) toast.success(`Ficha nueva en el padrón: ${creados.join(', ')}`);
      onDone();
    } finally {
      setGuardando(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-lime-400 outline-none';
  const labelCls = 'block text-xs font-display font-semibold text-gray-500 uppercase mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => !guardando && onClose()} />
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h3 className="font-display text-lg font-bold text-navy-700">
            {inicial ? `Editar — ${inicial.nombre}` : 'Nueva inscripción'}
          </h3>
          <button onClick={onClose} disabled={guardando} aria-label="Cerrar" className="text-gray-400 hover:text-navy-700">✕</button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Nombre y apellido *</label>
              <input type="text" list="padron-nombres-admin" value={form.nombre}
                onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Celular</label>
              <input type="tel" placeholder="099 123 456" value={form.celular}
                onChange={e => setForm(f => ({ ...f, celular: e.target.value }))} className={inputCls} />
            </div>
          </div>

          {duplicada && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-bold text-amber-800">⚠ {duplicada.nombre} ya está anotado en este torneo</p>
              <div className="mt-1 space-y-0.5 text-xs text-amber-800">
                {resumenDe(duplicada).map(linea => <p key={linea}>· {linea}</p>)}
              </div>
              <button type="button" onClick={() => onEditarExistente(duplicada)}
                className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 font-display text-xs font-bold text-white hover:bg-amber-700">
                Editar esa inscripción (no crear otra)
              </button>
            </div>
          )}
          {parecida && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-semibold text-gray-700">
                ¿Es la misma persona que <span className="font-bold text-navy-700">{parecida.nombre}</span>? Ya está anotado:
              </p>
              <div className="mt-1 space-y-0.5 text-xs text-gray-600">
                {resumenDe(parecida).map(linea => <p key={linea}>· {linea}</p>)}
              </div>
              <button type="button" onClick={() => onEditarExistente(parecida)}
                className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 font-display text-xs font-bold text-navy-700 hover:border-navy-700">
                Sí, editar esa inscripción
              </button>
            </div>
          )}
          <div>
            <span className={labelCls}>Categorías *</span>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {opciones.map(c => (
                <button key={c} type="button" onClick={() => toggleCat(c)} aria-pressed={cats.includes(c)}
                  className={`rounded-lg border px-1.5 py-1.5 font-display text-[11px] font-bold transition-colors ${
                    cats.includes(c) ? 'border-navy-700 bg-navy-700 text-white' : 'border-gray-200 text-navy-700 hover:border-navy-700'
                  }`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          {catsDobles.length > 0 && (
            <div className="space-y-2">
              {catsDobles.map(c => (
                <div key={c}>
                  <label className={labelCls}>Pareja para {c}</label>
                  <input type="text" list="padron-nombres-admin" placeholder="A confirmar si queda vacío"
                    value={parejas[c] ?? ''}
                    onChange={e => setParejas(p => ({ ...p, [c]: e.target.value }))} className={inputCls} />
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>DUPR ID</label>
              <input type="text" value={form.duprId}
                onChange={e => setForm(f => ({ ...f, duprId: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Notas</label>
            <input type="text" value={form.notas}
              onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <span className={labelCls}>Estado</span>
            <div className="flex gap-2">
              {(['pendiente', 'confirmada'] as const).map(s => (
                <button key={s} type="button" onClick={() => setEstado(s)} aria-pressed={estado === s}
                  className={`rounded-lg border px-4 py-1.5 font-display text-xs font-bold transition-colors ${
                    estado === s
                      ? s === 'confirmada' ? 'border-green-600 bg-green-50 text-green-700' : 'border-amber-500 bg-amber-50 text-amber-700'
                      : 'border-gray-200 text-gray-500 hover:text-navy-700'
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          {nombresPadron.length > 0 && (
            <datalist id="padron-nombres-admin">
              {[...new Set(nombresPadron)].map(n => <option key={n} value={n} />)}
            </datalist>
          )}
        </div>
        <div className="border-t border-gray-100 p-4">
          <button onClick={() => void guardar()} disabled={!valido}
            className="w-full rounded-lg bg-lime-400 py-2.5 font-display text-sm font-bold text-navy-700 hover:bg-lime-300 disabled:bg-gray-200 disabled:text-gray-400">
            {guardando ? 'Guardando…' : inicial ? 'Guardar cambios' : 'Cargar inscripción'}
          </button>
        </div>
      </div>
    </div>
  );
}
