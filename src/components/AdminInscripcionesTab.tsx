import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { Event, Inscripcion } from '../types';
import { SupabaseService } from '../services/supabaseService';
import { armarSeccionesCategoria, categoriasDe, parejaDe } from '../utils/inscripciones';
import { fechaHumana } from '../utils/fechas';
import { waUruguay } from '../utils/telefono';

/** localStorage: ISO de la última vez que este navegador miró la pestaña. */
export const MARCA_INSC_VISTAS = 'volea_insc_vistas';

/** Default de la marca cuando nunca se visitó: una semana atrás. */
export const marcaVisitaInscripciones = (): string => {
  const guardada = localStorage.getItem(MARCA_INSC_VISTAS);
  if (guardada && !isNaN(Date.parse(guardada))) return guardada;
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
};

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

  // La marca de visita ANTERIOR pinta el chip «nueva»; al montar se pisa con
  // ahora (el badge del panel se apaga vía alVerla).
  const marcaPreviaRef = useRef<string>('');
  useEffect(() => {
    marcaPreviaRef.current = marcaVisitaInscripciones();
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
  const esNueva = (i: Inscripcion) => i.createdAt > marcaPreviaRef.current;
  const linkPublico = evt ? `volea.vercel.app/#/inscripcion/${evt.id}` : '';

  const parejasDeFila = (i: Inscripcion): { categoria: string; pareja: string }[] =>
    categoriasDe(i)
      .filter(c => c.toLowerCase().includes('doble'))
      .map(c => ({ categoria: c, pareja: parejaDe(i, c) }));

  const filaAcciones = (i: Inscripcion) => (
    <div className="mt-2 flex flex-wrap gap-2">
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold text-navy-700">
          <ClipboardList size={22} /> Inscripciones
        </h2>
        <button onClick={() => void refrescar()} disabled={refrescando}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-navy-700 hover:border-navy-700 disabled:opacity-50">
          <RefreshCw size={14} className={refrescando ? 'animate-spin' : ''} /> Actualizar
        </button>
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
    </div>
  );
}
