import { useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, Check, ChevronRight, Map as MapIcon, Megaphone, Pencil, Plus, Tag, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { Announcement, Club, Event } from '../../types';
import { useStore } from '../../tienda/store';
import { rangoLargo, TZ_UY } from '../../lib/formato';
import { SupabaseService } from '../../services/supabaseService';
import { Boton, BotonIcono, Confirmar, EncabezadoPagina, Entrada, Insignia, Tarjeta, Vacio, type TonoInsignia } from '../ui';
import { EventModal } from '../EventModal';
import { ClubModal } from '../ClubModal';
import { AnnouncementModal } from '../AnnouncementModal';

// Pestañas chicas del panel que editan filas sueltas: categorías, eventos, clubes y
// anuncios. Mismo patrón en las cuatro: encabezado con la acción principal, lista que en
// el celular es de filas tocables (nada de columnas escondidas), editar y borrar de 44px,
// borrar siempre confirmado y "guardado" recién cuando la base lo confirmó.

/** Fila de lista: título + detalle + insignias, toda tocable, con acciones a la derecha. */
function Fila({ titulo, detalle, insignias, alTocar, acciones }: {
  titulo: string;
  detalle?: ReactNode;
  insignias?: ReactNode;
  alTocar: () => void;
  acciones: ReactNode;
}) {
  return (
    <li className="flex items-center gap-1 pr-1">
      <button type="button" onClick={alTocar} className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left transition-colors hover:bg-gray-50">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-navy-700">{titulo}</p>
          {detalle && <p className="mt-0.5 truncate text-[13px] text-gray-500">{detalle}</p>}
          {insignias && <div className="mt-1.5 flex flex-wrap gap-1">{insignias}</div>}
        </div>
        <ChevronRight size={18} className="shrink-0 text-gray-300 md:hidden" />
      </button>
      <div className="flex shrink-0">{acciones}</div>
    </li>
  );
}

const lista = 'divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white';

// ─── Categorías ──────────────────────────────────────────────────────────────

export function CategoriasTab() {
  const { categories, products, saveCategory, removeCategory } = useStore();
  const [nueva, setNueva] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [aBorrar, setABorrar] = useState<string | null>(null);

  const agregar = async () => {
    const nombre = nueva.trim();
    if (!nombre) return;
    const id = nombre.toLowerCase().replace(/\s+/g, '-');
    if (categories.some((c) => c.id === id || c.name.toLowerCase() === nombre.toLowerCase())) {
      toast.error(`Ya existe la categoría "${nombre}".`);
      return;
    }
    setGuardando(true);
    // max+1 (no largo+1): después de borrar una, largo+1 repetía un orden existente.
    const orden = categories.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1;
    const ok = await saveCategory({ id, name: nombre, sortOrder: orden });
    setGuardando(false);
    if (ok) { toast.success(`Categoría "${nombre}" creada`); setNueva(''); }
  };

  const enUso = (id: string) => products.filter((p) => p.category === id).length;
  const categoriaABorrar = categories.find((c) => c.id === aBorrar);

  return (
    <div className="max-w-2xl">
      <EncabezadoPagina rotulo="Tienda" titulo="Categorías" descripcion="El orden de esta lista es el de la tienda." />
      <Tarjeta className="mb-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void agregar(); }}>
          <Entrada value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Nueva categoría (ej. Camperas)" aria-label="Nombre de la nueva categoría" />
          <Boton type="submit" icono={<Plus size={18} />} cargando={guardando} disabled={!nueva.trim()}>Agregar</Boton>
        </form>
      </Tarjeta>
      {categories.length === 0 ? (
        <Vacio icono={<Tag size={22} />} titulo="Todavía no hay categorías" />
      ) : (
        <ul className={lista}>
          {[...categories].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => {
            const n = enUso(c.id);
            return (
              <li key={c.id} className="flex items-center gap-3 py-1 pl-4 pr-1">
                <span className="flex-1 text-sm font-semibold text-navy-700">{c.name}</span>
                <span className="text-[13px] text-gray-500">{n} {n === 1 ? 'producto' : 'productos'}</span>
                <BotonIcono etiqueta={`Eliminar la categoría ${c.name}`} icono={<Trash2 size={17} />} tono="peligro" onClick={() => setABorrar(c.id)} />
              </li>
            );
          })}
        </ul>
      )}
      <Confirmar
        abierto={aBorrar !== null}
        titulo={`¿Eliminar "${categoriaABorrar?.name ?? ''}"?`}
        mensaje={aBorrar && enUso(aBorrar) > 0
          ? `Hay ${enUso(aBorrar)} productos en esta categoría: van a quedar sin categoría en la tienda hasta que les asignes otra.`
          : 'No tiene productos. Se puede volver a crear cuando quieras.'}
        textoConfirmar="Eliminar categoría"
        alConfirmar={() => { if (aBorrar) { removeCategory(aBorrar); toast.success('Categoría eliminada'); } setABorrar(null); }}
        alCerrar={() => setABorrar(null)}
      />
    </div>
  );
}

// ─── Eventos ─────────────────────────────────────────────────────────────────

const CATEGORIA_EVENTO: Record<Event['category'], string> = { tournament: 'Torneo', clinic: 'Clínica', social: 'Social' };

export function EventosTab({ verInscriptos }: { verInscriptos: (eventoId: string) => void }) {
  const { events, saveEvent, removeEvent } = useStore();
  const [editando, setEditando] = useState<Event | null | 'nuevo'>(null);
  const [aBorrar, setABorrar] = useState<Event | null>(null);
  // Inscriptos del evento a borrar: 'cargando' mientras se pregunta (no se deja confirmar a
  // ciegas); null = no se pudo saber (se deja borrar igual, avisando).
  const [inscriptos, setInscriptos] = useState<number | null | 'cargando'>('cargando');
  const [borrando, setBorrando] = useState(false);

  useEffect(() => {
    setInscriptos('cargando');
    if (!aBorrar) return;
    let vivo = true;
    void SupabaseService.contarInscriptos(aBorrar.id).then((n) => { if (vivo) setInscriptos(n); });
    return () => { vivo = false; };
  }, [aBorrar]);

  const ordenados = [...events].sort((a, b) => b.date.localeCompare(a.date));
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: TZ_UY });

  return (
    <div>
      <EncabezadoPagina
        rotulo="Torneos"
        titulo="Eventos"
        descripcion="Lo que se anuncia en la web (flyer, fecha, lugar) y la inscripción online."
        acciones={<Boton icono={<Plus size={18} />} onClick={() => setEditando('nuevo')}>Nuevo evento</Boton>}
      />
      {ordenados.length === 0 ? (
        <Vacio icono={<CalendarDays size={22} />} titulo="Todavía no hay eventos" />
      ) : (
        <ul className={lista}>
          {ordenados.map((evt) => {
            // "Pasado" real por fecha: el estado manual quedaba en "Próximo" semanas después.
            const pasado = (evt.endDate || evt.date) < hoy;
            return (
              <Fila
                key={evt.id}
                titulo={evt.name}
                detalle={`${rangoLargo(evt.date, evt.endDate)} · ${[evt.location, evt.city].filter(Boolean).join(', ')}`}
                insignias={(
                  <>
                    <Insignia tono="navy">{CATEGORIA_EVENTO[evt.category] ?? evt.category}</Insignia>
                    {pasado ? <Insignia>Pasado</Insignia> : <Insignia tono="bien" punto>Próximo</Insignia>}
                    {evt.inscripcionesAbiertas && !pasado && <Insignia tono="info">Inscripción abierta</Insignia>}
                    {evt.status === 'upcoming' && pasado && <Insignia tono="atencion">Figura como próximo</Insignia>}
                  </>
                )}
                alTocar={() => setEditando(evt)}
                acciones={(
                  <>
                    {evt.inscripcionesAbiertas && (
                      <BotonIcono etiqueta={`Ver inscriptos de ${evt.name}`} icono={<Users size={17} />} onClick={() => verInscriptos(evt.id)} />
                    )}
                    <BotonIcono etiqueta={`Editar ${evt.name}`} icono={<Pencil size={17} />} className="hidden md:inline-flex" onClick={() => setEditando(evt)} />
                    <BotonIcono etiqueta={`Eliminar ${evt.name}`} icono={<Trash2 size={17} />} tono="peligro" onClick={() => setABorrar(evt)} />
                  </>
                )}
              />
            );
          })}
        </ul>
      )}

      {editando !== null && (
        <EventModal
          event={editando === 'nuevo' ? null : editando}
          uploadImage={(f) => SupabaseService.uploadImage(f, 'events')}
          onClose={() => setEditando(null)}
          onSave={(evt) => {
            setEditando(null);
            // Solo el evento editado: re-subir la lista entera pisaba cambios de otro dispositivo.
            void saveEvent(evt).then((ok) => { if (ok) toast.success('Evento guardado'); });
          }}
        />
      )}

      <Confirmar
        abierto={aBorrar !== null}
        titulo={`¿Eliminar "${aBorrar?.name ?? ''}"?`}
        mensaje={inscriptos === 'cargando'
          ? 'Revisando si tiene inscriptos…'
          : inscriptos === null
            ? 'No pude confirmar si tiene inscriptos. Si los tiene, mejor cerrá las inscripciones en vez de borrarlo. Esta acción no se puede deshacer.'
            : inscriptos > 0
            ? `Tiene ${inscriptos} ${inscriptos === 1 ? 'inscripción' : 'inscripciones'}: mejor cerrá las inscripciones en vez de borrarlo. Esta acción no se puede deshacer.`
            : 'No tiene inscriptos. Esta acción no se puede deshacer.'}
        textoConfirmar="Eliminar evento"
        deshabilitado={inscriptos === 'cargando'}
        cargando={borrando}
        alConfirmar={async () => {
          if (!aBorrar) return;
          setBorrando(true);
          // removeEvent ya avisa si no se pudo (y el evento queda en la lista).
          const r = await removeEvent(aBorrar.id);
          setBorrando(false);
          setABorrar(null);
          if (r === 'ok') toast.success('Evento eliminado');
        }}
        alCerrar={() => setABorrar(null)}
      />
    </div>
  );
}

// ─── Clubes ──────────────────────────────────────────────────────────────────

export function ClubesTab() {
  const { clubs, saveClub, removeClub } = useStore();
  const [editando, setEditando] = useState<Club | null | 'nuevo'>(null);
  const [aBorrar, setABorrar] = useState<Club | null>(null);

  return (
    <div>
      <EncabezadoPagina
        rotulo="Web"
        titulo="Clubes"
        descripcion="Los clubes y canchas del mapa de la web."
        acciones={<Boton icono={<Plus size={18} />} onClick={() => setEditando('nuevo')}>Nuevo club</Boton>}
      />
      {clubs.length === 0 ? (
        <Vacio icono={<MapIcon size={22} />} titulo="Todavía no hay clubes" />
      ) : (
        <ul className={lista}>
          {[...clubs].sort((a, b) => a.name.localeCompare(b.name)).map((club) => (
            <Fila
              key={club.id}
              titulo={club.name}
              detalle={[club.city, club.country].filter(Boolean).join(', ')}
              insignias={club.hasPickleball ? <Insignia tono="bien"><Check size={11} aria-hidden /> Pickleball</Insignia> : undefined}
              alTocar={() => setEditando(club)}
              acciones={(
                <>
                  <BotonIcono etiqueta={`Editar ${club.name}`} icono={<Pencil size={17} />} className="hidden md:inline-flex" onClick={() => setEditando(club)} />
                  <BotonIcono etiqueta={`Eliminar ${club.name}`} icono={<Trash2 size={17} />} tono="peligro" onClick={() => setABorrar(club)} />
                </>
              )}
            />
          ))}
        </ul>
      )}
      {editando !== null && (
        <ClubModal
          club={editando === 'nuevo' ? null : editando}
          onClose={() => setEditando(null)}
          onSave={(c) => {
            setEditando(null);
            void saveClub(c).then((ok) => { if (ok) toast.success('Club guardado'); });
          }}
        />
      )}
      <Confirmar
        abierto={aBorrar !== null}
        titulo={`¿Eliminar "${aBorrar?.name ?? ''}"?`}
        mensaje="Deja de verse en el mapa. Esta acción no se puede deshacer."
        textoConfirmar="Eliminar club"
        alConfirmar={() => { if (aBorrar) { removeClub(aBorrar.id); toast.success('Club eliminado'); } setABorrar(null); }}
        alCerrar={() => setABorrar(null)}
      />
    </div>
  );
}

// ─── Anuncios ────────────────────────────────────────────────────────────────

const TIPO_ANUNCIO: Record<Announcement['type'], { texto: string; tono: TonoInsignia }> = {
  info: { texto: 'Información', tono: 'info' },
  promo: { texto: 'Promoción', tono: 'bien' },
  event: { texto: 'Evento', tono: 'navy' },
  important: { texto: 'Importante', tono: 'alerta' },
};

export function AnunciosTab() {
  const { announcements, saveAnnouncement, removeAnnouncement } = useStore();
  const [editando, setEditando] = useState<Announcement | null | 'nuevo'>(null);
  const [aBorrar, setABorrar] = useState<Announcement | null>(null);

  return (
    <div>
      <EncabezadoPagina
        rotulo="Web"
        titulo="Anuncios"
        descripcion="Los activos pasan en la cinta de abajo de la home."
        acciones={<Boton icono={<Plus size={18} />} onClick={() => setEditando('nuevo')}>Nuevo anuncio</Boton>}
      />
      {announcements.length === 0 ? (
        <Vacio icono={<Megaphone size={22} />} titulo="Todavía no hay anuncios" />
      ) : (
        <ul className={lista}>
          {[...announcements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((ann) => {
            const tipo = TIPO_ANUNCIO[ann.type] ?? TIPO_ANUNCIO.info;
            return (
              <Fila
                key={ann.id}
                titulo={ann.title}
                detalle={ann.content}
                insignias={(
                  <>
                    <Insignia tono={tipo.tono}>{tipo.texto}</Insignia>
                    {ann.active ? <Insignia tono="bien" punto>Activo</Insignia> : <Insignia>Inactivo</Insignia>}
                  </>
                )}
                alTocar={() => setEditando(ann)}
                acciones={(
                  <>
                    <BotonIcono etiqueta={`Editar ${ann.title}`} icono={<Pencil size={17} />} className="hidden md:inline-flex" onClick={() => setEditando(ann)} />
                    <BotonIcono etiqueta={`Eliminar ${ann.title}`} icono={<Trash2 size={17} />} tono="peligro" onClick={() => setABorrar(ann)} />
                  </>
                )}
              />
            );
          })}
        </ul>
      )}
      {editando !== null && (
        <AnnouncementModal
          announcement={editando === 'nuevo' ? null : editando}
          onClose={() => setEditando(null)}
          onSave={(a) => {
            setEditando(null);
            void saveAnnouncement(a).then((ok) => { if (ok) toast.success('Anuncio guardado'); });
          }}
        />
      )}
      <Confirmar
        abierto={aBorrar !== null}
        titulo={`¿Eliminar "${aBorrar?.title ?? ''}"?`}
        mensaje="Esta acción no se puede deshacer. Si solo querés sacarlo de la cinta, desactivalo."
        textoConfirmar="Eliminar anuncio"
        alConfirmar={() => { if (aBorrar) { removeAnnouncement(aBorrar.id); toast.success('Anuncio eliminado'); } setABorrar(null); }}
        alCerrar={() => setABorrar(null)}
      />
    </div>
  );
}
