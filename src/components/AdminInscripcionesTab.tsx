import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Lightbulb, Pencil, Plus, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { Event, Inscripcion } from '../types';
import { SupabaseService } from '../services/supabaseService';
import {
  armarSeccionesCategoria, buscanPareja, categoriasDe, faltaInscribirse, parejaDe, resumenArmado,
  MARCA_INSC_VISTAS, MIN_UNIDADES_VIABLE, marcaVisitaPrevia,
} from '../utils/inscripciones';
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
  const armadoOrdenado = [...armado.filter(a => a.unidades > 0), ...armado.filter(a => a.unidades === 0)];
  const buscan = buscanPareja(secciones, filas ?? []);
  const faltan = faltaInscribirse(filas ?? []);
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

      {/* Semáforo de armado: qué categorías se juegan (umbral: 4 duplas/jugadores) */}
      {evt && filas !== null && filas.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
            Armado del torneo <span className="font-normal normal-case">(verde = se juega con {MIN_UNIDADES_VIABLE}+)</span>
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {armadoOrdenado.map(a => (
              <div key={a.categoria}
                className={`rounded-xl border border-gray-100 bg-white px-3 py-2 ${a.unidades === 0 ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${PUNTO_NIVEL[a.nivel]}`} />
                  <p className="truncate font-display text-xs font-bold text-navy-700">{a.categoria}</p>
                </div>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  {a.unidades === 0
                    ? 'sin anotados'
                    : a.esDoble
                      ? `${a.unidades} ${a.unidades === 1 ? 'dupla' : 'duplas'}${a.buscanPareja > 0 ? ` + ${a.buscanPareja} busca${a.buscanPareja > 1 ? 'n' : ''}` : ''}`
                      : `${a.unidades} ${a.unidades === 1 ? 'jugador' : 'jugadores'}`}
                </p>
              </div>
            ))}
          </div>
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
          {recientes.map(filaPersona)}
          {bajas.length > 0 && (
            <>
              <p className="pt-2 text-xs font-bold uppercase tracking-wide text-gray-400">Bajas ({bajas.length})</p>
              {bajas.map(filaPersona)}
            </>
          )}
        </div>
      )}

      {evt && filas !== null && filas.length > 0 && vista === 'categorias' && (
        <div className="space-y-3">
          {secciones.map(sec => (
            <div key={sec.categoria} className={`rounded-2xl border border-gray-100 bg-white p-4 ${sec.total === 0 ? 'opacity-60' : ''}`}>
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

      {editando !== null && evt && (
        <InscripcionModal
          evento={evt}
          inicial={editando === 'nueva' ? null : editando}
          nombresPadron={nombresPadron ?? []}
          onClose={() => setEditando(null)}
          onDone={() => { setEditando(null); void cargar(); }}
        />
      )}
    </div>
  );
}

// ─── Modal de alta/edición manual ────────────────────────────────────────────

/**
 * Carga o corrige una inscripción desde el admin (las que llegan por WhatsApp).
 * Sin las restricciones del form público: celular opcional y sirve aunque las
 * inscripciones online estén cerradas.
 */
function InscripcionModal({ evento, inicial, nombresPadron, onClose, onDone }: {
  evento: Event;
  inicial: Inscripcion | null;
  nombresPadron: string[];
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
