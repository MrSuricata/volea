import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, BadgeCheck, ChevronDown, CircleDollarSign, ClipboardList, FileDown, Lightbulb, MoreHorizontal, Pencil, Plus,
  RefreshCw, SlidersHorizontal, UserCheck, UserMinus, UserPlus, Users, Undo2,
} from 'lucide-react';
import { alertasDeTopes, asignacionesAGuardar, chequearTope, matchearDupr, parsearDuprPegado, parsearRating, TOPES_APU } from '../utils/dupr';
import type { EstadoMatch, JugadorPadron, MatchDupr, TopesEvento } from '../utils/dupr';
import { exportPlanillaExcel } from '../utils/inscripcionesExcel';
import { toast } from 'sonner';
import type { Event, Inscripcion, TarifaEvento } from '../types';
import { SupabaseService } from '../services/supabaseService';
import {
  armarSeccionesCategoria, buscanPareja, categoriasDe, costoInscripcion, estadisticasTorneo, faltaInscribirse,
  parejaDe, resumenArmado, MARCA_INSC_VISTAS, MIN_UNIDADES_VIABLE, marcaVisitaPrevia,
} from '../utils/inscripciones';
import { distancia, normalizar } from '../utils/nombres';
import {
  AreaTexto, BarraFiltros, Boton, BotonIcono, Campo, CargandoFilas, Chip, Confirmar, Dialogo, EncabezadoPagina, Entrada,
  EntradaPlata, ErrorEstado, Insignia, Segmentado, Selector, Vacio, type TonoInsignia,
} from '../admin/ui';
import { cn } from '../lib/cn';

const money = (n: number) => '$ ' + n.toLocaleString('es-UY', { maximumFractionDigits: 0 });
const METODO_LBL: Record<string, string> = {
  mp: 'Mercado Pago', efectivo: 'Efectivo', transferencia: 'Transferencia', freepass: 'Free pass',
};
import { fechaHumana } from '../utils/fechas';
import { waUruguay } from '../utils/telefono';
import { almacenLocal } from '../utils/almacen';

const ESTADO_TONO: Record<Inscripcion['estado'], TonoInsignia> = {
  pendiente: 'atencion',
  confirmada: 'bien',
  baja: 'neutro',
};

// ─── Menú "⋯" ────────────────────────────────────────────────────────────────

type ItemMenu = { texto: string; icono?: ReactNode; onClick: () => void; disabled?: boolean; peligro?: boolean };

/**
 * Acciones secundarias detrás de un "⋯" (rediseño 24/09): en el celular la cabecera tenía
 * 5 botones que se salían de la pantalla y cada fila otros 5. Cierra con Escape, tocando
 * afuera o al elegir.
 */
function MenuAcciones({ etiqueta, items, className }: { etiqueta: string; items: ItemMenu[]; className?: string }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const alTocarAfuera = (e: PointerEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(false); };
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('pointerdown', alTocarAfuera);
    document.addEventListener('keydown', alTeclear);
    return () => {
      document.removeEventListener('pointerdown', alTocarAfuera);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [abierto]);
  return (
    <div ref={caja} className={cn('relative', className)}>
      <BotonIcono
        etiqueta={etiqueta}
        icono={<MoreHorizontal size={20} />}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => setAbierto((a) => !a)}
        className="border border-gray-300 bg-white text-navy-700"
      />
      {abierto && (
        <div role="menu" aria-label={etiqueta} className="absolute right-0 top-full z-20 mt-1 min-w-[230px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {items.map((it) => (
            <button
              key={it.texto}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => { setAbierto(false); it.onClick(); }}
              className={cn(
                'flex h-11 w-full items-center gap-3 px-4 text-left text-sm font-semibold transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent',
                it.peligro ? 'text-red-700' : 'text-navy-700',
              )}
            >
              {it.icono}
              {it.texto}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Panel plegable ──────────────────────────────────────────────────────────

/** Bloque plegable con resumen a la vista: arriba de la lista había ~10 bloques apilados. */
function Panel({ icono, titulo, resumen, abierto, alAlternar, children }: {
  icono: ReactNode;
  titulo: string;
  resumen?: ReactNode;
  abierto: boolean;
  alAlternar: () => void;
  children: ReactNode;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={alAlternar}
        aria-expanded={abierto}
        className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-gray-50"
      >
        <span className="shrink-0 text-navy-700" aria-hidden>{icono}</span>
        <span className="min-w-0 flex-1 font-display text-sm font-bold text-navy-700">{titulo}</span>
        {resumen}
        <ChevronDown size={18} aria-hidden className={cn('shrink-0 text-gray-500 transition-transform', abierto && 'rotate-180')} />
      </button>
      {abierto && <div className="px-4 pb-4 pt-1">{children}</div>}
    </section>
  );
}

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
  // Filas con un cambio de estado en vuelo. Antes era UNA sola y mientras tanto se
  // deshabilitaban los botones de todas las filas; ahora cada fila se bloquea sola
  // (el doble toque en la misma sigue frenado) y la recarga que llega tarde no pisa a
  // una más nueva (ver `pedido` en cargar).
  const [cambiando, setCambiando] = useState<ReadonlySet<string>>(new Set());
  const [vista, setVista] = useState<'recientes' | 'categorias'>('recientes');
  // Alta/edición manual: 'nueva' abre el modal vacío, una Inscripcion lo abre precargado.
  const [editando, setEditando] = useState<Inscripcion | 'nueva' | null>(null);
  // Registro de pago (solo eventos con tarifa) y buscador de jugadores.
  const [pagando, setPagando] = useState<Inscripcion | null>(null);
  const [busqueda, setBusqueda] = useState('');
  // Filtro por estado de cobro (chips de la barra de totales). Tocar el chip
  // activo lo apaga; filtra Recientes igual que el buscador.
  const [filtroPago, setFiltroPago] = useState<'todos' | 'cobrados' | 'deudores' | 'sin'>('todos');
  const [duprAbierto, setDuprAbierto] = useState(false);
  // Dar de baja pide confirmación (antes era un toque, pegado a "A pendiente").
  const [bajaDe, setBajaDe] = useState<Inscripcion | null>(null);
  // Paneles plegables de arriba de la lista (cobranza, DUPR, armado, parejas…).
  const [panelesAbiertos, setPanelesAbiertos] = useState<ReadonlySet<string>>(new Set());
  const alternarPanel = (id: string) => setPanelesAbiertos(prev => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });
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

  // Padrón con ratings: alimenta el chequeo de topes por categoría (APU).
  const [padron, setPadron] = useState<JugadorPadron[]>([]);
  useEffect(() => {
    let vivo = true;
    void SupabaseService.getJugadoresPadron().then(p => { if (vivo) setPadron(p); });
    return () => { vivo = false; };
  }, [duprAbierto]);
  const ratingDe = useCallback((nombre: string): number | null => {
    const n = normalizar(nombre);
    const j = padron.find(x => normalizar(x.nombre) === n || x.alias.some(a => normalizar(a) === n));
    return j?.rating ?? null;
  }, [padron]);
  // Topes del EVENTO (editables); si todavía no definió ninguno, los de APU.
  const topes: TopesEvento = evt?.topes ?? TOPES_APU;
  const [topesAbierto, setTopesAbierto] = useState(false);

  // La marca de visita ANTERIOR (congelada por carga de página, ver utils)
  // pinta el chip «nueva»; al montar se pisa la guardada con ahora y el badge
  // del panel se apaga vía alVerla.
  useEffect(() => {
    marcaVisitaPrevia(); // congela la previa antes de pisarla
    almacenLocal.guardar(MARCA_INSC_VISTAS, new Date().toISOString());
    alVerla();
    // Solo al montar: alVerla es estable a efectos prácticos (setState del padre).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cada recarga lleva número: si dos se cruzan (dos filas cambiadas seguido, o cambio de
  // evento), solo aplica la última pedida, que ya ve todos los cambios anteriores.
  const pedido = useRef(0);
  const cargar = useCallback(async () => {
    const n = ++pedido.current;
    if (!eventoId) { setFilas([]); return; }
    const data = await SupabaseService.getInscripciones(eventoId);
    if (n !== pedido.current) return;
    if (data === null) { setFallo(true); return; }
    setFallo(false);
    setFilas(data);
  }, [eventoId]);

  useEffect(() => {
    setFilas(null);
    setFallo(false);
    setFiltroPago('todos');
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
    if (cambiando.has(id)) return;
    setCambiando(prev => new Set(prev).add(id));
    try {
      const ok = await SupabaseService.setEstadoInscripcion(id, estado);
      if (!ok) { toast.error('No se pudo actualizar. Verificá tu sesión de admin.'); return; }
      await cargar();
    } finally {
      setCambiando(prev => { const s = new Set(prev); s.delete(id); return s; });
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
  // Estado de cobro de una fila: sin registrar, con deuda o al día (free pass
  // cuenta como cobrado: pagó $0 sin deuda).
  const estadoPagoDe = (i: Inscripcion): 'cobrados' | 'deudores' | 'sin' =>
    !i.pagoAt ? 'sin' : (i.pagoDeuda ?? 0) > 0 ? 'deudores' : 'cobrados';
  const matchPago = (i: Inscripcion) => filtroPago === 'todos' || estadoPagoDe(i) === filtroPago;
  const recientesFiltradas = recientes.filter(i => matchBusqueda(i) && matchPago(i));
  const bajasFiltradas = bajas.filter(i => matchBusqueda(i) && matchPago(i));
  const toggleFiltroPago = (f: typeof filtroPago) => {
    setFiltroPago(prev => (prev === f ? 'todos' : f));
    setVista('recientes');
  };

  // Cobros (solo eventos con tarifa): resumen arriba + chip por fila.
  const tarifa: TarifaEvento | null = evt?.tarifa ?? null;
  const cobrado = activos.reduce((s, i) => s + (i.pagoAt ? (i.pagoMonto ?? 0) : 0), 0);
  const enDeuda = activos.reduce((s, i) => s + (i.pagoAt ? (i.pagoDeuda ?? 0) : 0), 0);
  const sinRegistrar = tarifa ? activos.filter(i => !i.pagoAt) : [];
  const sinRegistrarTotal = tarifa
    ? sinRegistrar.reduce((s, i) => s + costoInscripcion(categoriasDe(i).length, tarifa), 0)
    : 0;
  const nCobrados = activos.filter(i => estadoPagoDe(i) === 'cobrados').length;
  const nDeudores = activos.filter(i => estadoPagoDe(i) === 'deudores').length;
  const esNueva = (i: Inscripcion) => i.createdAt > marcaVisitaPrevia();
  const linkPublico = evt ? `volea.vercel.app/inscripcion/${evt.id}` : '';

  const parejasDeFila = (i: Inscripcion): { categoria: string; pareja: string }[] =>
    categoriasDe(i)
      .filter(c => c.toLowerCase().includes('doble'))
      .map(c => ({ categoria: c, pareja: parejaDe(i, c) }));

  // Acciones de una fila: lo de todos los días a la vista (pago, confirmar) y lo demás
  // detrás del "⋯" (editar si no entra, volver a pendiente, dar de baja con confirmación).
  // En el celular así entran en un renglón; antes eran 5 botones chicos en dos.
  const filaAcciones = (i: Inscripcion) => {
    const ocupada = cambiando.has(i.id);
    const debeRegistrar = !!tarifa && !i.pagoAt && i.estado !== 'baja';
    const debeConfirmar = i.estado !== 'confirmada';
    const editarALaVista = !(debeRegistrar && debeConfirmar);
    const extra: ItemMenu[] = [];
    if (!editarALaVista) extra.push({ texto: 'Editar datos', icono: <Pencil size={17} />, onClick: () => setEditando(i), disabled: ocupada });
    if (i.estado !== 'pendiente') extra.push({ texto: 'Pasar a pendiente', icono: <Undo2 size={17} />, onClick: () => void cambiarEstado(i.id, 'pendiente'), disabled: ocupada });
    if (i.estado !== 'baja') extra.push({ texto: 'Dar de baja…', icono: <UserMinus size={17} />, onClick: () => setBajaDe(i), disabled: ocupada, peligro: true });
    return (
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:justify-end">
        {debeRegistrar && (
          <Boton icono={<CircleDollarSign size={17} />} onClick={() => setPagando(i)} disabled={ocupada} className="px-3.5" title="Registrar el pago de la inscripción">
            Cobrar
          </Boton>
        )}
        {debeConfirmar && (
          <Boton
            variante={debeRegistrar || i.estado === 'baja' ? 'secundario' : 'primario'}
            icono={<UserCheck size={17} />}
            onClick={() => void cambiarEstado(i.id, 'confirmada')}
            cargando={ocupada}
            className="px-3.5"
          >
            Confirmar
          </Boton>
        )}
        {editarALaVista && (
          <Boton variante="secundario" icono={<Pencil size={16} />} onClick={() => setEditando(i)} disabled={ocupada} className="px-3.5">
            Editar
          </Boton>
        )}
        {extra.length > 0 && <MenuAcciones etiqueta={`Más acciones para ${i.nombre}`} items={extra} className="ml-auto lg:ml-0" />}
      </div>
    );
  };

  const insigniaPago = (i: Inscripcion) => {
    if (!tarifa || i.estado === 'baja') return null;
    if (!i.pagoAt) return <Insignia>a cobrar {money(costoInscripcion(categoriasDe(i).length, tarifa))}</Insignia>;
    if (i.pagoMetodo === 'freepass') return <Insignia tono="info">Free pass</Insignia>;
    if ((i.pagoDeuda ?? 0) > 0) return <Insignia tono="atencion">pagó {money(i.pagoMonto ?? 0)} · debe {money(i.pagoDeuda ?? 0)}</Insignia>;
    return <Insignia tono="bien">pagó {money(i.pagoMonto ?? 0)} · {METODO_LBL[i.pagoMetodo ?? ''] ?? i.pagoMetodo}</Insignia>;
  };

  const filaPersona = (i: Inscripcion) => (
    <div key={i.id} className={cn('flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 lg:flex-row lg:items-start lg:gap-6', i.estado === 'baja' && 'bg-gray-50')}>
      <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className={cn('font-display text-base font-bold', i.estado === 'baja' ? 'text-gray-500 line-through' : 'text-navy-700')}>{i.nombre}</span>
        {esNueva(i) && i.estado !== 'baja' && <Insignia tono="vivo">nueva</Insignia>}
        <Insignia tono={ESTADO_TONO[i.estado]}>{i.estado}</Insignia>
        {insigniaPago(i)}
        {i.duprId && <Insignia tono="navy">DUPR {i.duprId}</Insignia>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {categoriasDe(i).map(c => (
          <span key={c} className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">{c}</span>
        ))}
      </div>
      {parejasDeFila(i).length > 0 && (
        <div className="mt-2 space-y-0.5 text-[13px] text-gray-600">
          {parejasDeFila(i).map(({ categoria, pareja }) => (
            <p key={categoria}>
              <span className="font-semibold text-gray-700">{categoria}:</span>{' '}
              {pareja || <span className="font-semibold text-amber-700">pareja a confirmar</span>}
            </p>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-gray-500">
        {waUruguay(i.celular) ? (
          <a href={`https://wa.me/${waUruguay(i.celular)}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-navy-700 underline decoration-navy-200 underline-offset-2 hover:decoration-navy-700">
            {i.celular}
          </a>
        ) : (i.celular && <span>{i.celular}</span>)}
        {i.email && <span className="break-all">{i.email}</span>}
        <span>{fechaHumana(i.createdAt, ahoraMs)}</span>
      </div>
      {i.notas && <p className="mt-1.5 text-[13px] italic text-gray-600">"{i.notas}"</p>}
      </div>
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
    { titulo: 'Se juegan', nota: `${MIN_UNIDADES_VIABLE}+ duplas/jugadores`, clase: 'text-emerald-700', items: armado.filter(a => a.nivel === 'verde') },
    { titulo: 'En armado', nota: '2-3, les falta poco', clase: 'text-amber-700', items: armado.filter(a => a.nivel === 'ambar') },
    { titulo: 'Flojas o vacías', nota: '0-1', clase: 'text-gray-600', items: [...armado.filter(a => a.nivel === 'gris')].sort(porGente) },
  ].filter(g => g.items.length > 0);
  const buscan = buscanPareja(secciones, filas ?? []);
  const faltan = faltaInscribirse(filas ?? []);
  const stats = estadisticasTorneo(filas ?? [], armado);

  // Alertas de DUPR: quién está en una categoría donde no puede estar.
  const alertas = useMemo(() => alertasDeTopes(
    secciones.map(sec => ({
      categoria: sec.categoria,
      jugadores: [...sec.duplas.flat(), ...sec.sueltos]
        .map(id => porId.get(id))
        .filter((i): i is Inscripcion => !!i)
        .map(i => ({ nombre: i.nombre, rating: ratingDe(i.nombre) })),
      duplas: sec.duplas.map(([aId, bId]) => {
        const a = porId.get(aId);
        const b = porId.get(bId);
        return {
          nombres: [a?.nombre ?? '', b?.nombre ?? ''] as [string, string],
          ratings: [a ? ratingDe(a.nombre) : null, b ? ratingDe(b.nombre) : null] as [number | null, number | null],
        };
      }),
    })),
    topes,
    // porId se rearma en cada render; las deps reales son las filas y el padrón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [secciones, topes, ratingDe, filas]);
  const PUNTO_NIVEL = { verde: 'bg-emerald-500', ambar: 'bg-amber-400', gris: 'bg-gray-300' } as const;

  const hayFilas = !!evt && filas !== null && filas.length > 0;
  const hayCobranza = !!evt && !!tarifa && filas !== null && (nDeudores > 0 || sinRegistrar.length > 0);
  const buscanTotal = buscan.reduce((n, b) => n + b.buscan.length, 0);

  return (
    <div>
      <EncabezadoPagina
        rotulo="Torneos"
        titulo="Inscripciones"
        descripcion={evt ? <>Link público: <span className="font-semibold text-navy-700">{linkPublico}</span></> : undefined}
        acciones={(
          <>
            <BotonIcono
              etiqueta="Actualizar la lista"
              icono={<RefreshCw size={19} className={refrescando ? 'animate-spin' : ''} />}
              onClick={() => void refrescar()}
              disabled={refrescando}
              className="border border-gray-300 bg-white text-navy-700"
            />
            <MenuAcciones
              etiqueta="Más acciones de inscripciones"
              items={[
                { texto: 'Cargar DUPR en lote', icono: <BadgeCheck size={17} />, onClick: () => setDuprAbierto(true) },
                { texto: 'Límites DUPR del evento', icono: <SlidersHorizontal size={17} />, onClick: () => setTopesAbierto(true), disabled: !evt },
                {
                  texto: exportando ? 'Exportando…' : 'Exportar planilla (Excel)',
                  icono: <FileDown size={17} />,
                  onClick: () => void exportar(),
                  disabled: exportando || !evt || !filas || filas.length === 0,
                },
              ]}
            />
            <Boton icono={<Plus size={18} />} onClick={() => setEditando('nueva')} disabled={!evt}>
              Nueva inscripción
            </Boton>
          </>
        )}
      />

      <div className="space-y-4">
        {elegibles.length > 1 && (
          <Campo etiqueta="Evento" className="max-w-md">
            <Selector value={eventoId ?? ''} onChange={e => setEventoId(e.target.value)}>
              {elegibles.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.inscripcionesAbiertas ? ' · inscripción abierta' : ''}
                </option>
              ))}
            </Selector>
          </Campo>
        )}

        {/* Números del torneo (pedido de Brian: jugadores, géneros, más jugada, partidos ≈), en una línea. */}
        {hayFilas && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-gray-600">
            <span className="inline-flex items-center gap-1.5"><Users size={15} aria-hidden /> <b className="text-navy-700">{activos.length}</b> {activos.length === 1 ? 'inscripción' : 'inscripciones'}</span>
            <span><b className="text-navy-700">{stats.jugadores}</b> jugadores únicos</span>
            <span>
              <b className="text-navy-700">{stats.mujeres}</b> mujeres · <b className="text-navy-700">{stats.hombres}</b> hombres
              {stats.sinGenero > 0 && <span> · {stats.sinGenero} sin definir</span>}
            </span>
            {stats.masJugada && (
              <span>más jugada: <b className="text-navy-700">{stats.masJugada.categoria}</b> ({stats.masJugada.personas})</span>
            )}
            <span title="Estimado grueso: ~2 partidos por dupla/jugador entre grupos y llave, en las categorías con 2+">
              ≈ <b className="text-navy-700">{stats.partidosAprox}</b> partidos estimados
            </span>
          </p>
        )}

        {/* Paneles plegables (antes eran bloques abiertos que empujaban la lista media pantalla
            abajo). Cada uno muestra su resumen en la cabecera. */}
        {hayFilas && (hayCobranza || alertas.length > 0 || buscan.length > 0 || faltan.length > 0 || gruposArmado.length > 0) && (
          <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {/* Panel de cobranza (pedido de Brian): quién debe y cuánto, con el alta de pago a un toque. */}
            {hayCobranza && tarifa && (
              <Panel
                icono={<CircleDollarSign size={18} />}
                titulo="Por cobrar"
                resumen={<Insignia tono="atencion">{money(enDeuda + sinRegistrarTotal)}</Insignia>}
                abierto={panelesAbiertos.has('cobranza')}
                alAlternar={() => alternarPanel('cobranza')}
              >
                <div className="divide-y divide-gray-100">
                  {activos.filter(i => estadoPagoDe(i) === 'deudores')
                    .sort((a, b) => (b.pagoDeuda ?? 0) - (a.pagoDeuda ?? 0))
                    .map(i => (
                      <div key={i.id} className="flex min-h-[48px] items-center gap-2 py-1.5 text-sm">
                        <span className="min-w-0 flex-1 truncate font-semibold text-navy-700">{i.nombre}</span>
                        <span className="whitespace-nowrap text-[13px] text-gray-500">pagó {money(i.pagoMonto ?? 0)}</span>
                        <span className="whitespace-nowrap font-bold tabular-nums text-amber-700">debe {money(i.pagoDeuda ?? 0)}</span>
                      </div>
                    ))}
                  {[...sinRegistrar]
                    .sort((a, b) => costoInscripcion(categoriasDe(b).length, tarifa) - costoInscripcion(categoriasDe(a).length, tarifa))
                    .map(i => (
                      <div key={i.id} className="flex min-h-[52px] items-center gap-2 py-1.5 text-sm">
                        <span className="min-w-0 flex-1 truncate font-semibold text-navy-700">{i.nombre}</span>
                        <span className="whitespace-nowrap font-bold tabular-nums text-gray-600">
                          {money(costoInscripcion(categoriasDe(i).length, tarifa))}
                        </span>
                        <Boton variante="secundario" icono={<CircleDollarSign size={16} />} onClick={() => setPagando(i)} disabled={cambiando.has(i.id)} className="px-3">
                          Cobrar
                        </Boton>
                      </div>
                    ))}
                </div>
                <p className="mt-2 text-[13px] text-gray-500">
                  Los «debe» de pago parcial se cobran desde la Caja, sección «Por cobrar».
                </p>
              </Panel>
            )}

            {/* Alertas de DUPR: jugadores/duplas fuera del tope de su categoría. */}
            {alertas.length > 0 && (
              <Panel
                icono={<AlertTriangle size={18} className="text-red-700" />}
                titulo="Fuera de categoría por DUPR"
                resumen={<Insignia tono="alerta">{alertas.length}</Insignia>}
                abierto={panelesAbiertos.has('dupr')}
                alAlternar={() => alternarPanel('dupr')}
              >
                <div className="space-y-1.5">
                  {alertas.map((a, i) => (
                    <p key={`${a.categoria}-${i}`} className="text-sm text-gray-700">
                      <span className="font-display font-bold text-navy-700">{a.categoria}:</span>{' '}
                      {a.detalle}
                      <span className="ml-1 text-xs font-semibold uppercase text-red-700">
                        {a.tipo === 'suma' ? '(suma de dupla)' : '(individual)'}
                      </span>
                    </p>
                  ))}
                </div>
                <Boton variante="secundario" icono={<SlidersHorizontal size={16} />} onClick={() => setTopesAbierto(true)} className="mt-3">
                  Revisar límites
                </Boton>
              </Panel>
            )}

            {/* Semáforo de armado, separado por estado (umbral: 4 duplas/jugadores). */}
            {gruposArmado.length > 0 && (
              <Panel
                icono={<ClipboardList size={18} />}
                titulo="Armado por categoría"
                resumen={<span className="hidden text-[13px] text-gray-500 sm:inline">{gruposArmado.map(g => `${g.items.length} ${g.titulo.toLowerCase()}`).join(' · ')}</span>}
                abierto={panelesAbiertos.has('armado')}
                alAlternar={() => alternarPanel('armado')}
              >
                <div className="space-y-4">
                  {gruposArmado.map(g => (
                    <div key={g.titulo}>
                      <p className={`mb-2 text-xs font-bold uppercase tracking-wide ${g.clase}`}>
                        {g.titulo} ({g.items.length}) <span className="font-normal normal-case text-gray-500">· {g.nota}</span>
                      </p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        {g.items.map(a => (
                          <button key={a.categoria} type="button"
                            onClick={() => a.totalPersonas > 0 && abrirCategoria(a.categoria)}
                            disabled={a.totalPersonas === 0}
                            title={a.totalPersonas > 0 ? `Ver ${a.categoria}` : undefined}
                            className={cn(
                              'min-h-[52px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-left transition-colors',
                              a.totalPersonas === 0 ? 'cursor-default opacity-60' : 'hover:border-navy-700',
                            )}>
                            <span className="flex items-center gap-1.5">
                              <span className={`h-2 w-2 shrink-0 rounded-full ${PUNTO_NIVEL[a.nivel]}`} aria-hidden />
                              <span className="truncate font-display text-[13px] font-bold text-navy-700">{a.categoria}</span>
                            </span>
                            <span className="mt-0.5 block text-xs text-gray-600">
                              {a.totalPersonas === 0
                                ? 'sin anotados'
                                : a.esDoble
                                  ? `${a.unidades} ${a.unidades === 1 ? 'dupla' : 'duplas'}${a.buscanPareja > 0 ? ` + ${a.buscanPareja} busca${a.buscanPareja > 1 ? 'n' : ''}` : ''}`
                                  : `${a.unidades} ${a.unidades === 1 ? 'jugador' : 'jugadores'}`}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {/* Buscan pareja (con cruces sugeridos). */}
            {buscan.length > 0 && (
              <Panel
                icono={<UserPlus size={18} />}
                titulo="Buscan pareja"
                resumen={<Insignia tono="atencion">{buscanTotal}</Insignia>}
                abierto={panelesAbiertos.has('buscan')}
                alAlternar={() => alternarPanel('buscan')}
              >
                <div className="space-y-2.5">
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
                          <p key={aId + bId} className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-amber-800">
                            <Lightbulb size={14} aria-hidden /> {pa.nombre} + {pb.nombre} podrían jugar juntos
                          </p>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {/* Declarados como pareja que no se anotaron. */}
            {faltan.length > 0 && (
              <Panel
                icono={<Users size={18} />}
                titulo="Falta que se anoten"
                resumen={<Insignia>{faltan.length}</Insignia>}
                abierto={panelesAbiertos.has('faltan')}
                alAlternar={() => alternarPanel('faltan')}
              >
                <div className="space-y-1">
                  {faltan.map(f => (
                    <p key={f.nombre} className="text-sm text-gray-700">
                      <span className="font-semibold text-navy-700">{f.nombre}</span>
                      <span className="text-gray-600">
                        {' — '}la declaró {f.declaradaPor.map(d => `${d.nombre} (${d.categoria})`).join(', ')}
                      </span>
                    </p>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        )}

        {evt && (
          <Segmentado
            etiqueta="Vista de inscripciones"
            valor={vista}
            alCambiar={setVista}
            opciones={[{ valor: 'recientes', texto: 'Recientes' }, { valor: 'categorias', texto: 'Por categoría' }]}
          />
        )}

        {/* Buscador + chips de cobro: filtran Recientes (tocar el chip activo lo apaga). */}
        {hayFilas && (
          <BarraFiltros
            className="mb-0"
            busqueda={busqueda}
            alBuscar={t => { setBusqueda(t); if (t.trim() !== '') setVista('recientes'); }}
            placeholder="Buscar jugador o pareja…"
            chips={tarifa ? (
              <>
                {(nCobrados > 0 || filtroPago === 'cobrados') && (
                  <Chip activo={filtroPago === 'cobrados'} onClick={() => toggleFiltroPago('cobrados')} cantidad={nCobrados}>Cobrados · {money(cobrado)}</Chip>
                )}
                {(nDeudores > 0 || filtroPago === 'deudores') && (
                  <Chip activo={filtroPago === 'deudores'} onClick={() => toggleFiltroPago('deudores')} cantidad={nDeudores}>Deben · {money(enDeuda)}</Chip>
                )}
                {(sinRegistrar.length > 0 || filtroPago === 'sin') && (
                  <Chip activo={filtroPago === 'sin'} onClick={() => toggleFiltroPago('sin')} cantidad={sinRegistrar.length}>Sin registrar · {money(sinRegistrarTotal)}</Chip>
                )}
              </>
            ) : undefined}
          />
        )}
        {hayFilas && tarifa && (
          <p className="text-[13px] text-gray-500">
            Inscripción <b className="text-navy-700">{money(tarifa.base)}</b> (hasta {tarifa.incluye} categorías)
            + <b className="text-navy-700">{money(tarifa.extra)}</b> c/adicional
          </p>
        )}

        {!evt && <Vacio titulo="No hay eventos todavía" descripcion="Creá un evento con inscripción para empezar a recibir anotados." />}
        {evt && fallo && (
          <ErrorEstado mensaje="No se pudieron cargar. Verificá tu sesión de admin." alReintentar={() => void refrescar()} />
        )}
        {evt && !fallo && filas === null && <CargandoFilas filas={4} />}

        {evt && filas !== null && filas.length === 0 && (
          <Vacio
            icono={<ClipboardList size={22} />}
            titulo={`Todavía no hay inscriptos en ${evt.name}`}
            descripcion={<>Compartí el link: <span className="font-semibold text-navy-700">{linkPublico}</span></>}
            accion={<Boton icono={<Plus size={18} />} onClick={() => setEditando('nueva')}>Cargar una a mano</Boton>}
          />
        )}

        {hayFilas && vista === 'recientes' && (
          <div className="space-y-2">
            {(q !== '' || filtroPago !== 'todos') && (
              <p className="text-[13px] text-gray-600">
                Mostrando {recientesFiltradas.length} de {recientes.length} inscripciones
                {q !== '' && <> que coinciden con «{busqueda.trim()}»</>}
                {filtroPago === 'cobrados' && ' · solo cobrados'}
                {filtroPago === 'deudores' && ' · solo con deuda'}
                {filtroPago === 'sin' && ' · solo sin pago registrado'}
                {filtroPago !== 'todos' && (
                  <button type="button" onClick={() => setFiltroPago('todos')} className="ml-2 inline-flex min-h-[32px] items-center font-bold text-navy-700 underline underline-offset-2">
                    ver todos
                  </button>
                )}
              </p>
            )}
            {recientesFiltradas.map(filaPersona)}
            {bajasFiltradas.length > 0 && (
              <>
                <p className="pt-3 font-display text-xs font-bold uppercase tracking-wide text-gray-500">Bajas ({bajasFiltradas.length})</p>
                {bajasFiltradas.map(filaPersona)}
              </>
            )}
          </div>
        )}

        {hayFilas && vista === 'categorias' && (
          <div className="space-y-3">
            {secciones.map(sec => (
              <div key={sec.categoria}
                id={'sec-' + sec.categoria.replace(/\s+/g, '-')}
                className={cn(
                  'scroll-mt-20 rounded-xl border bg-white p-4 transition-shadow',
                  catDestacada === sec.categoria ? 'border-navy-700 ring-2 ring-navy-700/30' : 'border-gray-200',
                  sec.total === 0 && 'opacity-70',
                )}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display font-bold text-navy-700">{sec.categoria}</h3>
                  {topes[sec.categoria] && (
                    <Insignia tono="navy">
                      tope {topes[sec.categoria].individual.toFixed(3)}
                      {topes[sec.categoria].suma !== null && ` · dupla ${topes[sec.categoria].suma!.toFixed(3)}`}
                    </Insignia>
                  )}
                  <Insignia>
                    {sec.categoria.toLowerCase().includes('doble')
                      ? `${sec.duplas.length} ${sec.duplas.length === 1 ? 'dupla' : 'duplas'}${sec.sueltos.length ? ` + ${sec.sueltos.length} sin armar` : ''}`
                      : `${sec.total} ${sec.total === 1 ? 'jugador' : 'jugadores'}`}
                  </Insignia>
                </div>
                {sec.total > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {sec.duplas.map(([aId, bId]) => {
                      const a = porId.get(aId);
                      const b = porId.get(bId);
                      if (!a || !b) return null;
                      // Tope APU de la categoría (si la categoría lo tiene y hay ratings).
                      const chequeo = chequearTope(sec.categoria, [
                        { nombre: a.nombre, rating: ratingDe(a.nombre) },
                        { nombre: b.nombre, rating: ratingDe(b.nombre) },
                      ], topes);
                      const excede = chequeo.estado === 'excede-individual' || chequeo.estado === 'excede-suma';
                      return (
                        <p key={aId + bId} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-gray-700">
                          <span><span className="font-semibold text-navy-700">{a.nombre}</span>{' + '}<span className="font-semibold text-navy-700">{b.nombre}</span></span>
                          {chequeo.estado === 'ok' && <Insignia tono="bien">{chequeo.suma?.toFixed(3)}</Insignia>}
                          {excede && <Insignia tono="alerta">{chequeo.detalle}</Insignia>}
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
                              ? <span className="text-gray-600"> — con {pareja} <span className="text-gray-500">(declarada)</span></span>
                              : <span className="font-semibold text-amber-700"> — pareja a confirmar</span>
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
      </div>

      <Confirmar
        abierto={bajaDe !== null}
        titulo={bajaDe ? `¿Dar de baja a ${bajaDe.nombre}?` : ''}
        mensaje="Sale de las categorías y del armado. Se puede volver a pendiente desde «Bajas»."
        textoConfirmar="Dar de baja"
        alCerrar={() => setBajaDe(null)}
        alConfirmar={() => {
          const i = bajaDe;
          setBajaDe(null);
          if (i) void cambiarEstado(i.id, 'baja');
        }}
      />

      {duprAbierto && <DuprMasivoModal onClose={() => setDuprAbierto(false)} />}

      {topesAbierto && evt && (
        <TopesModal
          evento={evt}
          topes={topes}
          onClose={() => setTopesAbierto(false)}
          onGuardado={() => { setTopesAbierto(false); void cargar(); }}
        />
      )}

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

// ─── Límites de DUPR por categoría ───────────────────────────────────────────

/**
 * Topes DUPR del campeonato, editables: máximo individual y máximo de la suma
 * de la dupla, por categoría. Vacío = sin tope. Se guardan en el evento, así
 * cada campeonato puede tener su reglamento sin tocar código.
 */
function TopesModal({ evento, topes, onClose, onGuardado }: {
  evento: Event;
  topes: TopesEvento;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const categorias = (evento.categorias || '').split(',').map(c => c.trim()).filter(Boolean);
  const [borrador, setBorrador] = useState<Record<string, { individual: string; suma: string }>>(() =>
    Object.fromEntries(categorias.map(c => [c, {
      individual: topes[c]?.individual != null ? String(topes[c].individual) : '',
      suma: topes[c]?.suma != null ? String(topes[c].suma) : '',
    }])),
  );
  const [guardando, setGuardando] = useState(false);

  const invalido = Object.values(borrador).some(v =>
    (v.individual.trim() !== '' && parsearRating(v.individual) === null)
    || (v.suma.trim() !== '' && (Number.isNaN(Number(v.suma.replace(',', '.'))) || Number(v.suma.replace(',', '.')) <= 0)));

  const guardar = async () => {
    if (guardando || invalido) return;
    setGuardando(true);
    try {
      const nuevos: Record<string, { individual: number; suma: number | null }> = {};
      for (const [cat, v] of Object.entries(borrador)) {
        const ind = v.individual.trim() === '' ? null : parsearRating(v.individual);
        if (ind === null) continue; // sin máximo individual, la categoría no tiene tope
        const sumaTxt = v.suma.trim().replace(',', '.');
        nuevos[cat] = { individual: ind, suma: sumaTxt === '' ? null : Number(sumaTxt) };
      }
      const ok = await SupabaseService.setTopesEvento(evento.id, nuevos);
      if (!ok) { toast.error('No se pudieron guardar los límites'); return; }
      toast.success('Límites guardados');
      onGuardado();
    } finally {
      setGuardando(false);
    }
  };

  const inputCls = 'w-20 px-2 text-center font-mono sm:w-24';

  return (
    <Dialogo
      abierto
      titulo={`Límites DUPR — ${evento.name}`}
      descripcion="Máximo por jugador y máximo de la suma de la dupla. Dejá vacío lo que no tenga tope (una categoría sin máximo individual queda libre)."
      alCerrar={onClose}
      ocupado={guardando}
      ancho="lg"
      pie={(
        <>
          <Boton variante="secundario" onClick={onClose} disabled={guardando}>Cancelar</Boton>
          <Boton onClick={() => void guardar()} cargando={guardando} disabled={invalido}>Guardar límites</Boton>
        </>
      )}
    >
      <div className="mb-1 flex items-center gap-2 px-3 font-display text-[11px] font-bold uppercase tracking-wide text-gray-500">
        <span className="flex-1">Categoría</span>
        <span className="w-20 text-center sm:w-24">Individual</span>
        <span className="w-20 text-center sm:w-24">Dupla</span>
      </div>
      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {categorias.map(c => {
          const esDoble = c.toLowerCase().includes('doble');
          return (
            <div key={c} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-navy-700">{c}</span>
              <Entrada type="text" inputMode="decimal" value={borrador[c]?.individual ?? ''}
                onChange={e => setBorrador(b => ({ ...b, [c]: { ...b[c], individual: e.target.value } }))}
                placeholder="—" className={inputCls} aria-label={`Máximo individual ${c}`} />
              <Entrada type="text" inputMode="decimal" value={borrador[c]?.suma ?? ''}
                onChange={e => setBorrador(b => ({ ...b, [c]: { ...b[c], suma: e.target.value } }))}
                placeholder={esDoble ? '—' : ''} disabled={!esDoble}
                className={inputCls} aria-label={`Máximo de dupla ${c}`} />
            </div>
          );
        })}
      </div>
      {invalido && <p className="mt-2 text-[13px] font-medium text-red-700">Revisá los números: el individual va de 1 a 8 (ej: 3.2) y la suma tiene que ser positiva.</p>}
    </Dialogo>
  );
}

// ─── Carga masiva de DUPR ID ─────────────────────────────────────────────────

const ESTADO_DUPR: Record<EstadoMatch, { tono: TonoInsignia; texto: string }> = {
  nuevo: { tono: 'bien', texto: 'se carga' },
  actualiza: { tono: 'atencion', texto: 'reemplaza el que tenía' },
  igual: { tono: 'neutro', texto: 'ya lo tenía igual' },
  dudoso: { tono: 'info', texto: '¿es esta persona?' },
  'sin-match': { tono: 'alerta', texto: 'no está en el padrón' },
  duplicado: { tono: 'neutro', texto: 'repetido en la lista' },
  invalido: { tono: 'alerta', texto: 'no se entiende la línea' },
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
          .map(m => ({ id: resueltos[m.linea].id, duprId: m.duprId, rating: m.rating })),
      ]
    : [];

  const guardar = async () => {
    if (aGuardar.length === 0 || guardando) return;
    setGuardando(true);
    try {
      const r = await SupabaseService.setDuprIds(aGuardar);
      if (!r.ok) { toast.error(r.error || 'No se pudo guardar'); return; }
      toast.success(`${r.tocados ?? aGuardar.length} DUPR ID guardados en el padrón`);
      onClose();
    } finally {
      setGuardando(false);
    }
  };

  const conDupr = padron?.filter(j => j.duprId).length ?? 0;

  return (
    <Dialogo
      abierto
      titulo="Cargar DUPR IDs"
      alCerrar={onClose}
      ocupado={guardando}
      sucio={texto.trim() !== '' && aGuardar.length > 0}
      ancho="lg"
      pie={(
        <>
          <Boton variante="secundario" onClick={onClose} disabled={guardando}>Cancelar</Boton>
          <Boton onClick={() => void guardar()} cargando={guardando} disabled={aGuardar.length === 0}>
            {aGuardar.length > 0 ? `Guardar ${aGuardar.length} DUPR ID` : 'Nada para guardar'}
          </Boton>
        </>
      )}
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Pegá una lista de <b className="text-navy-700">Nombre, DUPR ID</b> (uno por línea; sirve copiado de un Excel o de WhatsApp).
          {padron && <> El padrón tiene <b className="text-navy-700">{padron.length}</b> jugadores, {conDupr} con DUPR cargado.</>}
        </p>
        <AreaTexto
          rows={6}
          value={texto}
          onChange={e => setTexto(e.target.value)}
          placeholder={'Gastón Moirano, 7XZ4V2\nPaula Segura, K92MB1\nMia Batista\tQ4LP08'}
          aria-label="Lista de nombres y DUPR ID"
          className="font-mono"
        />
        <Boton variante="secundario" onClick={analizar} disabled={!padron || texto.trim() === ''}>
          {padron ? 'Analizar lista' : 'Cargando padrón…'}
        </Boton>

        {matches && (
          <div className="space-y-2">
            <p className="font-display text-xs font-bold uppercase tracking-wide text-gray-500">
              {matches.length} líneas · {aGuardar.length} se van a guardar
            </p>
            {matches.map(m => (
              <div key={m.linea} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <span className="font-semibold text-navy-700">{m.nombrePegado}</span>
                {m.duprId && <Insignia tono="navy" className="font-mono">{m.duprId}</Insignia>}
                {m.rating !== null && <Insignia className="font-mono">{m.rating.toFixed(3)}</Insignia>}
                <Insignia tono={resueltos[m.linea] ? 'bien' : ESTADO_DUPR[m.estado].tono}>
                  {resueltos[m.linea] ? 'se carga' : ESTADO_DUPR[m.estado].texto}
                </Insignia>
                {m.estado === 'actualiza' && m.jugador?.duprId && (
                  <span className="text-[13px] text-gray-500">tenía {m.jugador.duprId}</span>
                )}
                {m.estado === 'dudoso' && !resueltos[m.linea] && (
                  <div className="flex w-full flex-wrap gap-2">
                    {m.candidatos?.map(c => (
                      <Boton key={c.id} variante="secundario" onClick={() => setResueltos(r => ({ ...r, [m.linea]: c }))} className="px-3">
                        es {c.nombre}
                      </Boton>
                    ))}
                  </div>
                )}
                {resueltos[m.linea] && (
                  <span className="inline-flex items-center gap-2 text-[13px] text-gray-600">
                    → {resueltos[m.linea].nombre}
                    {/* Se había elegido mal: se deshace y vuelven las opciones. */}
                    <button
                      type="button"
                      onClick={() => setResueltos(r => { const { [m.linea]: _, ...resto } = r; return resto; })}
                      className="inline-flex min-h-[32px] items-center font-semibold text-navy-700 underline underline-offset-2"
                    >
                      cambiar
                    </button>
                  </span>
                )}
                {m.error && <span className="text-[13px] text-red-700">{m.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialogo>
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
  // Plata con EntradaPlata: "1.200" son mil doscientos (el type=number lo leía como 1,2).
  const [monto, setMonto] = useState<number | null>(costo);
  const [guardando, setGuardando] = useState(false);

  const montoNum = metodo === 'freepass' ? 0 : (monto ?? Number.NaN);
  const montoOk = Number.isFinite(montoNum) && montoNum >= 0 && montoNum <= costo;
  const deuda = montoOk ? Math.round((costo - montoNum) * 100) / 100 : 0;
  const listo = !!metodo && montoOk && !guardando;

  const confirmar = async () => {
    if (!listo || !metodo) return;
    setGuardando(true);
    try {
      const r = await SupabaseService.pagoInscripcion(inscripcion.id, montoNum, metodo, '');
      if (!r.ok) { toast.error(r.error || 'No se pudo registrar el pago'); return; }
      if (metodo === 'freepass') toast.success(`${inscripcion.nombre}: free pass (confirmada)`);
      else if ((r.deuda ?? 0) > 0) toast.success(`Pago registrado — quedan ${money(r.deuda ?? 0)} como deuda de ${inscripcion.nombre} en la Caja`);
      else toast.success(`${inscripcion.nombre} pagó ${money(montoNum)}`);
      onDone();
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialogo
      abierto
      titulo={`Pago — ${inscripcion.nombre}`}
      alCerrar={onClose}
      ocupado={guardando}
      ancho="sm"
      pie={(
        <>
          <Boton variante="secundario" onClick={onClose} disabled={guardando}>Cancelar</Boton>
          <Boton onClick={() => void confirmar()} cargando={guardando} disabled={!metodo || !montoOk}>Confirmar pago</Boton>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
          <p className="text-gray-600">
            {nCats} {nCats === 1 ? 'categoría' : 'categorías'}: {money(tarifa.base)}
            {extras > 0 && <> + {extras} × {money(tarifa.extra)}</>}
          </p>
          <p className="mt-0.5 font-display text-2xl font-black tabular-nums text-navy-700">{money(costo)}</p>
        </div>

        <div>
          <p id="pago-metodo" className="mb-1.5 text-[13px] font-semibold text-navy-700">¿Cómo paga?</p>
          <div role="radiogroup" aria-labelledby="pago-metodo" className="grid grid-cols-2 gap-2">
            {(['efectivo', 'mp', 'transferencia', 'freepass'] as const).map(m => (
              <button key={m} type="button" role="radio" aria-checked={metodo === m} onClick={() => setMetodo(m)}
                className={cn(
                  'h-11 rounded-lg border font-display text-[13px] font-bold transition-colors',
                  metodo === m ? 'border-navy-700 bg-navy-700 text-white' : 'border-gray-300 bg-white text-navy-700 hover:border-navy-700',
                )}>
                {METODO_LBL[m]}
              </button>
            ))}
          </div>
        </div>

        {metodo === 'freepass' ? (
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] font-semibold text-sky-800">
            Sin cargo (socios / invitados). No pasa por la Caja y queda confirmada.
          </p>
        ) : (
          <Campo
            etiqueta="¿Cuánto paga ahora?"
            error={!montoOk ? `Entre $ 0 y ${money(costo)}.` : null}
            ayuda={montoOk && deuda > 0 ? `Quedan ${money(deuda)} como deuda de ${inscripcion.nombre} en «Por cobrar» de la Caja.` : undefined}
          >
            <EntradaPlata valor={monto} alCambiar={setMonto} />
          </Campo>
        )}
      </div>
    </Dialogo>
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

  // Hubo cambios respecto de lo que abrió (para preguntar antes de descartarlos).
  const sucio = form.nombre !== (inicial?.nombre ?? '') || form.celular !== (inicial?.celular ?? '')
    || form.email !== (inicial?.email ?? '') || form.duprId !== (inicial?.duprId ?? '') || form.notas !== (inicial?.notas ?? '')
    || cats.join('|') !== (inicial ? categoriasDe(inicial) : []).join('|');

  return (
    <Dialogo
      abierto
      titulo={inicial ? `Editar — ${inicial.nombre}` : 'Nueva inscripción'}
      alCerrar={onClose}
      ocupado={guardando}
      sucio={sucio}
      ancho="lg"
      pie={(
        <>
          <Boton variante="secundario" onClick={onClose} disabled={guardando}>Cancelar</Boton>
          <Boton onClick={() => void guardar()} cargando={guardando} disabled={form.nombre.trim() === '' || cats.length === 0}>
            {inicial ? 'Guardar cambios' : 'Cargar inscripción'}
          </Boton>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Nombre y apellido" requerido>
            <Entrada type="text" list="padron-nombres-admin" autoComplete="off" value={form.nombre}
              onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
          </Campo>
          <Campo etiqueta="Celular">
            <Entrada type="tel" inputMode="tel" placeholder="099 123 456" value={form.celular}
              onChange={e => setForm(f => ({ ...f, celular: e.target.value }))} />
          </Campo>
        </div>

        {duplicada && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-bold text-amber-900">{duplicada.nombre} ya está anotado en este torneo</p>
            <div className="mt-1 space-y-0.5 text-[13px] text-amber-900">
              {resumenDe(duplicada).map(linea => <p key={linea}>· {linea}</p>)}
            </div>
            <Boton variante="secundario" onClick={() => onEditarExistente(duplicada)} className="mt-2">
              Editar esa inscripción (no crear otra)
            </Boton>
          </div>
        )}
        {parecida && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-sm font-semibold text-gray-700">
              ¿Es la misma persona que <span className="font-bold text-navy-700">{parecida.nombre}</span>? Ya está anotado:
            </p>
            <div className="mt-1 space-y-0.5 text-[13px] text-gray-600">
              {resumenDe(parecida).map(linea => <p key={linea}>· {linea}</p>)}
            </div>
            <Boton variante="secundario" onClick={() => onEditarExistente(parecida)} className="mt-2">
              Sí, editar esa inscripción
            </Boton>
          </div>
        )}
        <div>
          <p id="insc-categorias" className="mb-1.5 text-[13px] font-semibold text-navy-700">
            Categorías<span className="ml-0.5 text-red-600" aria-hidden>*</span>
          </p>
          <div role="group" aria-labelledby="insc-categorias" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {opciones.map(c => (
              <button key={c} type="button" onClick={() => toggleCat(c)} aria-pressed={cats.includes(c)}
                className={cn(
                  'min-h-[44px] rounded-lg border px-2 py-1.5 font-display text-xs font-bold leading-tight transition-colors',
                  cats.includes(c) ? 'border-navy-700 bg-navy-700 text-white' : 'border-gray-300 bg-white text-navy-700 hover:border-navy-700',
                )}>
                {c}
              </button>
            ))}
          </div>
        </div>
        {catsDobles.length > 0 && (
          <div className="space-y-3">
            {catsDobles.map(c => (
              <Campo key={c} etiqueta={`Pareja para ${c}`}>
                <Entrada type="text" list="padron-nombres-admin" autoComplete="off" placeholder="A confirmar si queda vacío"
                  value={parejas[c] ?? ''}
                  onChange={e => setParejas(p => ({ ...p, [c]: e.target.value }))} />
              </Campo>
            ))}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Email">
            <Entrada type="email" inputMode="email" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </Campo>
          <Campo etiqueta="DUPR ID">
            <Entrada type="text" autoComplete="off" value={form.duprId}
              onChange={e => setForm(f => ({ ...f, duprId: e.target.value }))} />
          </Campo>
        </div>
        <Campo etiqueta="Notas">
          <Entrada type="text" value={form.notas}
            onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
        </Campo>
        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-navy-700">Estado</p>
          <Segmentado
            etiqueta="Estado de la inscripción"
            valor={estado}
            alCambiar={setEstado}
            opciones={[{ valor: 'pendiente', texto: 'Pendiente' }, { valor: 'confirmada', texto: 'Confirmada' }]}
          />
        </div>
        {nombresPadron.length > 0 && (
          <datalist id="padron-nombres-admin">
            {[...new Set(nombresPadron)].map(n => <option key={n} value={n} />)}
          </datalist>
        )}
      </div>
    </Dialogo>
  );
}
