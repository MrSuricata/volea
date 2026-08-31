/**
 * Pantalla del taller de sublimación.
 *
 * La usa una sola persona: la del taller externo que estampa las prendas. Entra
 * con su usuario (rol `sublimacion`) y esto es TODO lo que ve de VOLEA — no hay
 * barra lateral del admin, ni caja, ni precios, ni catálogo. Es su app.
 *
 * Decisiones de diseño, todas por el mismo motivo (se mira desde el celular, en
 * el taller, con las manos ocupadas):
 *  - Tipografía y botones más grandes que en el resto del admin (mínimo 48px de
 *    alto; 56px los dos botones de estado).
 *  - El mockup manda: va grande y se abre a pantalla completa de un toque.
 *  - Nada de jerga de sistema. Acá son "trabajos", no "órdenes de compra".
 *  - Los trabajos por hacer van primero, con el vencimiento en criollo
 *    ("es HOY", "atrasado 2 días"), que es lo único que se mira de apuro.
 *
 * Seguridad: la base ya filtra por RLS (solo ve trabajos de sublimación ya
 * enviados). El filtro por `tipo` de acá es cinturón + tiradores, no la defensa.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight,
  ClipboardList, FileText, Hammer, ImageOff, Inbox, LogOut, Maximize2, PackageCheck,
  RefreshCw, Send, Shirt, Truck, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Compra, CompraArchivo, CompraEstado } from '../types';
import { SupabaseService } from '../services/supabaseService';

// ─── Fechas ──────────────────────────────────────────────────────────────────
// `fechaEstimada` es un día calendario (YYYY-MM-DD), no un instante: se parsea a
// mano y se compara en UTC para que no se corra un día según el huso del celular.

const TZ = 'America/Montevideo';
const MS_DIA = 24 * 60 * 60 * 1000;
const DIA_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function ymdAMs(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(ms) ? null : ms;
}

/** Hoy según el reloj de Montevideo, igual que el resto del admin. */
const hoyYmd = (): string => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

function fechaCorta(ymd: string): string {
  const ms = ymdAMs(ymd);
  if (ms === null) return ymd;
  const d = new Date(ms);
  return `${DIA_CORTO[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

interface Entrega { texto: string; apura: boolean; vencida: boolean }

/** "vie 5/9 · faltan 3 días" — lo único que en el taller se mira de apuro. */
function entregaDe(ymd: string | null): Entrega {
  if (!ymd) return { texto: 'Sin fecha de entrega', apura: false, vencida: false };
  const ms = ymdAMs(ymd);
  if (ms === null) return { texto: ymd, apura: false, vencida: false };
  const hoyMs = ymdAMs(hoyYmd());
  const fecha = fechaCorta(ymd);
  if (hoyMs === null) return { texto: fecha, apura: false, vencida: false };

  const dias = Math.round((ms - hoyMs) / MS_DIA);
  if (dias < 0) {
    const n = Math.abs(dias);
    return { texto: `${fecha} · atrasado ${n} ${n === 1 ? 'día' : 'días'}`, apura: true, vencida: true };
  }
  if (dias === 0) return { texto: `${fecha} · es HOY`, apura: true, vencida: false };
  if (dias === 1) return { texto: `${fecha} · es mañana`, apura: true, vencida: false };
  return { texto: `${fecha} · faltan ${dias} días`, apura: dias <= 3, vencida: false };
}

// ─── Estados, en idioma de taller ────────────────────────────────────────────

interface PintaEstado { texto: string; chip: string; icono: LucideIcon }

const ESTADO: Record<CompraEstado, PintaEstado> = {
  borrador:   { texto: 'Sin enviar',  chip: 'bg-gray-100 text-gray-500 border-gray-200',    icono: FileText },
  pedido:     { texto: 'Para hacer',  chip: 'bg-lime-400 text-navy-700 border-lime-500',    icono: ClipboardList },
  en_proceso: { texto: 'En proceso',  chip: 'bg-amber-100 text-amber-800 border-amber-300', icono: Hammer },
  en_camino:  { texto: 'Ya lo mandé', chip: 'bg-sky-100 text-sky-800 border-sky-300',       icono: Truck },
  recibido:   { texto: 'Entregado',   chip: 'bg-navy-100 text-navy-700 border-navy-200',    icono: PackageCheck },
  cancelado:  { texto: 'Cancelado',   chip: 'bg-red-100 text-red-600 border-red-200',       icono: X },
};

/** Los que hay que hacer arriba; lo entregado y lo cancelado al fondo. */
const ORDEN: Record<CompraEstado, number> = {
  pedido: 0, en_proceso: 1, en_camino: 2, recibido: 3, borrador: 4, cancelado: 5,
};

const PENDIENTES: CompraEstado[] = ['pedido', 'en_proceso'];

const totalUnidades = (c: Compra): number =>
  c.items.reduce((suma, it) => suma + (Number.isFinite(it.cantidad) ? it.cantidad : 0), 0);

// ─── Fotos ───────────────────────────────────────────────────────────────────

const RE_IMAGEN = /\.(jpe?g|png|webp|gif|avif|bmp|heic|heif)(\?|#|$)/i;
const esImagen = (a: CompraArchivo): boolean => RE_IMAGEN.test(a.url) || RE_IMAGEN.test(a.nombre);

interface Foto { nombre: string; url: string }

/** Mockup primero y después las fotos sueltas: es el orden en que se miran. */
function fotosDe(c: Compra): Foto[] {
  const fotos: Foto[] = [];
  if (c.mockupUrl) fotos.push({ nombre: 'Mockup final', url: c.mockupUrl });
  for (const a of c.archivos) {
    if (esImagen(a)) fotos.push({ nombre: a.nombre || 'Foto', url: a.url });
  }
  return fotos;
}

// ─── Imágenes que pueden faltar ──────────────────────────────────────────────

function FotoConRespaldo({ url, alt, className, respaldo }: {
  url: string;
  alt: string;
  className: string;
  respaldo: ReactNode;
}) {
  const [rota, setRota] = useState(false);
  useEffect(() => { setRota(false); }, [url]);
  if (rota) return <>{respaldo}</>;
  return <img src={url} alt={alt} loading="lazy" onError={() => setRota(true)} className={className} />;
}

// ─── Visor a pantalla completa ───────────────────────────────────────────────
// REGLA DEL PROYECTO: todo lo que va a pantalla completa se monta con createPortal
// sobre <body>. Los contenedores de la app arrastran `transform` (la animación
// .fade-in y las transiciones de framer), y un ancestro con transform vuelve
// relativo a un `position: fixed` — el visor terminaría dibujado en cualquier
// lado del scroll.

function VisorFotos({ fotos, indice, onCerrar, onIr }: {
  fotos: Foto[];
  indice: number;
  onCerrar: () => void;
  onIr: (i: number) => void;
}) {
  const total = fotos.length;
  const foto: Foto | undefined = fotos[indice];

  // El candado del scroll va SOLO al montar/desmontar: si compartiera efecto con
  // el listener (que depende del índice) se recapturaría el overflow ya en
  // 'hidden' y al cerrar dejaría la página trabada.
  useEffect(() => {
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflowPrevio; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
      if (e.key === 'ArrowLeft' && total > 1) onIr((indice - 1 + total) % total);
      if (e.key === 'ArrowRight' && total > 1) onIr((indice + 1) % total);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [indice, total, onCerrar, onIr]);

  if (!foto) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={foto.nombre}
      className="fixed inset-0 z-[90] flex flex-col bg-black/95"
    >
      <div className="flex items-center justify-between gap-3 p-3">
        <p className="min-w-0 flex-1 truncate font-display text-base font-semibold text-white">
          {foto.nombre}
          {total > 1 && (
            <span className="ml-2 text-sm font-normal text-gray-400">{indice + 1} de {total}</span>
          )}
        </p>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar la foto"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <X size={26} />
        </button>
      </div>

      <button
        type="button"
        onClick={onCerrar}
        aria-label="Cerrar la foto"
        className="flex flex-1 items-center justify-center overflow-hidden p-2"
      >
        <img src={foto.url} alt={foto.nombre} className="max-h-full max-w-full object-contain" />
      </button>

      {total > 1 && (
        <div className="flex items-center justify-center gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => onIr((indice - 1 + total) % total)}
            aria-label="Foto anterior"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <ChevronLeft size={30} />
          </button>
          <button
            type="button"
            onClick={() => onIr((indice + 1) % total)}
            aria-label="Foto siguiente"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <ChevronRight size={30} />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ─── Tarjeta de la lista ─────────────────────────────────────────────────────

function TarjetaTrabajo({ trabajo, onAbrir }: { trabajo: Compra; onAbrir: () => void }) {
  const pinta = ESTADO[trabajo.estado];
  const Icono = pinta.icono;
  const entrega = entregaDe(trabajo.fechaEstimada);
  const unidades = totalUnidades(trabajo);
  const tapa: Foto | undefined = fotosDe(trabajo)[0];

  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex w-full items-stretch gap-3 overflow-hidden rounded-2xl border border-gray-200 bg-white text-left shadow-sm transition-shadow hover:shadow-md active:shadow-none"
    >
      <div className="flex w-24 shrink-0 items-center justify-center bg-navy-50 sm:w-28">
        {tapa ? (
          <FotoConRespaldo
            url={tapa.url}
            alt={`Mockup de ${trabajo.referencia || trabajo.prendaBase}`}
            className="h-full w-full object-cover"
            respaldo={<ImageOff size={26} className="text-navy-200" />}
          />
        ) : (
          <Shirt size={26} className="text-navy-200" />
        )}
      </div>

      <div className="min-w-0 flex-1 py-3 pr-3">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 font-display text-lg font-bold leading-tight text-navy-700">
            {trabajo.referencia || 'Trabajo sin número'}
          </p>
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${pinta.chip}`}>
            <Icono size={13} /> {pinta.texto}
          </span>
        </div>

        <p className="mt-1 truncate text-base text-gray-600">
          {trabajo.prendaBase || 'Prenda a confirmar'}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5 font-semibold text-navy-700">
            <Shirt size={15} /> {unidades} {unidades === 1 ? 'prenda' : 'prendas'}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 font-semibold ${
              entrega.vencida ? 'text-red-600' : entrega.apura ? 'text-amber-600' : 'text-gray-500'
            }`}
          >
            {entrega.vencida ? <AlertTriangle size={15} /> : <CalendarDays size={15} />} {entrega.texto}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Detalle del trabajo (pantalla completa) ─────────────────────────────────

function DetalleTrabajo({ trabajo, onCerrar, onEstado }: {
  trabajo: Compra;
  onCerrar: () => void;
  onEstado: (estado: 'en_proceso' | 'en_camino') => Promise<void>;
}) {
  const [guardando, setGuardando] = useState<'en_proceso' | 'en_camino' | null>(null);
  const [verFoto, setVerFoto] = useState<number | null>(null);

  const pinta = ESTADO[trabajo.estado];
  const Icono = pinta.icono;
  const entrega = entregaDe(trabajo.fechaEstimada);
  const unidades = totalUnidades(trabajo);
  const fotos = useMemo(() => fotosDe(trabajo), [trabajo]);
  const adjuntos = useMemo(() => trabajo.archivos.filter(a => !esImagen(a)), [trabajo.archivos]);
  const lineas = useMemo(() => [...trabajo.items].sort((a, b) => a.orden - b.orden), [trabajo.items]);
  // El mockup ya se muestra grande arriba: en la galería van solo las otras fotos.
  const sueltas = fotos.slice(trabajo.mockupUrl ? 1 : 0);

  // Solo se puede empezar algo que todavía no se empezó; y no se manda dos veces.
  const puedeEmpezar = trabajo.estado === 'pedido';
  const puedeMandar = trabajo.estado === 'pedido' || trabajo.estado === 'en_proceso';

  // Mismo criterio que en el visor: el candado del scroll, aparte y solo al
  // montar/desmontar. Si viajara con el listener (que cambia con `verFoto` y con
  // el `onCerrar` inline del padre) al cerrar el detalle la lista quedaría trabada.
  useEffect(() => {
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflowPrevio; };
  }, []);

  useEffect(() => {
    // Con el visor abierto manda el visor: ahí Escape cierra la foto, no el trabajo.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && verFoto === null) onCerrar(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCerrar, verFoto]);

  const marcar = async (estado: 'en_proceso' | 'en_camino') => {
    if (guardando !== null) return;
    setGuardando(estado);
    try {
      await onEstado(estado);
    } finally {
      setGuardando(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-navy-50 font-body">
      <header className="flex shrink-0 items-center gap-3 bg-navy-700 px-3 py-3 text-white shadow-lg">
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Volver a la lista de trabajos"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 transition-colors hover:bg-white/20"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-xl font-bold leading-tight">
            {trabajo.referencia || 'Trabajo sin número'}
          </p>
          <p className="truncate text-sm text-gray-300">{trabajo.prendaBase || 'Prenda a confirmar'}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${pinta.chip}`}>
          <Icono size={14} /> {pinta.texto}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-3xl space-y-4 p-4 pb-6">

          {/* Los dos datos que se miran de una: para cuándo y cuántas. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div
              className={`rounded-2xl border p-4 ${
                entrega.vencida
                  ? 'border-red-200 bg-red-50'
                  : entrega.apura
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-gray-200 bg-white'
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Para cuándo</p>
              <p
                className={`mt-1 font-display text-xl font-bold leading-tight ${
                  entrega.vencida ? 'text-red-600' : entrega.apura ? 'text-amber-700' : 'text-navy-700'
                }`}
              >
                {entrega.texto}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Cuántas prendas</p>
              <p className="mt-1 font-display text-xl font-bold leading-tight text-navy-700">
                {unidades} {unidades === 1 ? 'prenda' : 'prendas'}
              </p>
            </div>
          </div>

          {/* El mockup: es lo que más se mira, va grande y se abre entero. */}
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <h2 className="border-b border-gray-100 px-4 py-3 font-display text-base font-bold uppercase tracking-wide text-navy-700">
              Cómo va estampada
            </h2>
            {trabajo.mockupUrl ? (
              <button
                type="button"
                onClick={() => setVerFoto(0)}
                aria-label="Ver el mockup a pantalla completa"
                className="relative block w-full bg-navy-50"
              >
                <FotoConRespaldo
                  url={trabajo.mockupUrl}
                  alt="Mockup final del trabajo"
                  className="max-h-[70vh] w-full object-contain"
                  respaldo={(
                    <div className="flex h-56 flex-col items-center justify-center gap-2 text-gray-400">
                      <ImageOff size={34} />
                      <span className="text-sm">No se pudo cargar el mockup</span>
                    </div>
                  )}
                />
                <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-navy-700/90 px-3 py-2 text-sm font-semibold text-white">
                  <Maximize2 size={16} /> Ver grande
                </span>
              </button>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-gray-400">
                <ImageOff size={34} />
                <p className="text-base">Todavía no cargaron el mockup de este trabajo.</p>
              </div>
            )}
          </section>

          {/* Instrucciones del taller: grandes y legibles, son la orden real. */}
          {trabajo.comentarioTaller.trim() !== '' && (
            <section className="rounded-2xl border-2 border-lime-400 bg-lime-50 p-4">
              <h2 className="font-display text-base font-bold uppercase tracking-wide text-navy-700">
                Instrucciones
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-lg leading-relaxed text-navy-700">
                {trabajo.comentarioTaller}
              </p>
            </section>
          )}

          {/* Qué hay que hacer: tabla, pero armada para que se lea a 375px. */}
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <h2 className="border-b border-gray-100 px-4 py-3 font-display text-base font-bold uppercase tracking-wide text-navy-700">
              Qué hay que hacer
            </h2>
            {lineas.length === 0 ? (
              <p className="px-4 py-6 text-center text-base text-gray-400">
                Este trabajo todavía no tiene el detalle cargado.
              </p>
            ) : (
              <>
                <ul className="divide-y divide-gray-100">
                  {lineas.map(item => (
                    <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-lg font-semibold leading-snug text-navy-700">
                          {item.descripcion || 'Sin descripción'}
                        </p>
                        {item.variante && (
                          <p className="mt-0.5 text-base text-gray-500">{item.variante.replace('|', ' · ')}</p>
                        )}
                      </div>
                      <span className="shrink-0 rounded-xl bg-navy-50 px-3 py-2 font-display text-xl font-bold text-navy-700">
                        {item.cantidad}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between border-t-2 border-navy-100 bg-navy-50 px-4 py-3">
                  <span className="font-display text-base font-bold uppercase tracking-wide text-navy-700">Total</span>
                  <span className="font-display text-xl font-bold text-navy-700">{unidades}</span>
                </div>
              </>
            )}
          </section>

          {/* Fotos de referencia. */}
          {sueltas.length > 0 && (
            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <h2 className="font-display text-base font-bold uppercase tracking-wide text-navy-700">
                Otras fotos
              </h2>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {sueltas.map((foto, i) => (
                  <button
                    key={`${foto.url}-${i}`}
                    type="button"
                    onClick={() => setVerFoto(trabajo.mockupUrl ? i + 1 : i)}
                    aria-label={`Ver ${foto.nombre} a pantalla completa`}
                    className="aspect-square overflow-hidden rounded-xl border border-gray-200 bg-navy-50"
                  >
                    <FotoConRespaldo
                      url={foto.url}
                      alt={foto.nombre}
                      className="h-full w-full object-cover"
                      respaldo={(
                        <div className="flex h-full w-full items-center justify-center">
                          <ImageOff size={22} className="text-navy-200" />
                        </div>
                      )}
                    />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Adjuntos que no son fotos (PDF, vectores): se abren aparte. */}
          {adjuntos.length > 0 && (
            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <h2 className="font-display text-base font-bold uppercase tracking-wide text-navy-700">
                Archivos
              </h2>
              <ul className="mt-3 space-y-2">
                {adjuntos.map((a, i) => (
                  <li key={`${a.url}-${i}`}>
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-[48px] items-center gap-3 rounded-xl border border-gray-200 px-3 py-2 text-base text-navy-700 transition-colors hover:bg-navy-50"
                    >
                      <FileText size={20} className="shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1 truncate">{a.nombre || 'Archivo'}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {trabajo.notas.trim() !== '' && (
            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <h2 className="font-display text-base font-bold uppercase tracking-wide text-navy-700">Notas</h2>
              <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-gray-600">{trabajo.notas}</p>
            </section>
          )}
        </div>
      </div>

      {/* Barra de acciones: abajo y fija, que es donde llega el pulgar. */}
      <div className="shrink-0 border-t border-gray-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,31,63,0.08)]">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => void marcar('en_proceso')}
            disabled={!puedeEmpezar || guardando !== null}
            className="inline-flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-xl bg-navy-700 px-4 font-display text-lg font-bold text-white transition-colors hover:bg-navy-800 disabled:bg-gray-200 disabled:text-gray-400"
          >
            {guardando === 'en_proceso' ? (
              <><RefreshCw size={22} className="animate-spin" /> Anotando…</>
            ) : (
              <><Hammer size={22} /> Lo empecé</>
            )}
          </button>
          <button
            type="button"
            onClick={() => void marcar('en_camino')}
            disabled={!puedeMandar || guardando !== null}
            className="inline-flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-xl bg-lime-400 px-4 font-display text-lg font-bold text-navy-700 transition-colors hover:bg-lime-500 disabled:bg-gray-200 disabled:text-gray-400"
          >
            {guardando === 'en_camino' ? (
              <><RefreshCw size={22} className="animate-spin" /> Anotando…</>
            ) : (
              <><Send size={22} /> Está pronto, lo mando</>
            )}
          </button>
        </div>
        {!puedeMandar && (
          <p className="mx-auto mt-2 max-w-3xl text-center text-sm text-gray-500">
            {trabajo.estado === 'en_camino'
              ? 'Ya avisaste que lo mandaste. Cuando llegue a VOLEA se marca solo.'
              : trabajo.estado === 'recibido'
                ? 'Este trabajo ya lo recibieron en VOLEA. No hay nada más para hacer.'
                : 'Este trabajo está cancelado.'}
          </p>
        )}
      </div>

      {verFoto !== null && fotos.length > 0 && (
        <VisorFotos fotos={fotos} indice={verFoto} onCerrar={() => setVerFoto(null)} onIr={setVerFoto} />
      )}
    </div>,
    document.body,
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export default function SublimacionPanel({ nombre, onSalir }: {
  nombre: string;
  onSalir: () => void;
}) {
  const [trabajos, setTrabajos] = useState<Compra[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [falloLectura, setFalloLectura] = useState(false);
  const [abiertoId, setAbiertoId] = useState<string | null>(null);

  const cargar = useCallback(async (avisar = false) => {
    setCargando(true);
    const data = await SupabaseService.getCompras();
    if (data === null) {
      setFalloLectura(true);
      if (avisar) toast.error('No se pudieron actualizar los trabajos');
    } else {
      setFalloLectura(false);
      // La base ya filtra por RLS; el filtro por tipo es por las dudas.
      setTrabajos(data.filter(c => c.tipo === 'sublimacion'));
      if (avisar) toast.success('Lista actualizada');
    }
    setCargando(false);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const ordenados = useMemo(() => {
    if (!trabajos) return [];
    return [...trabajos].sort((a, b) => {
      const porEstado = ORDEN[a.estado] - ORDEN[b.estado];
      if (porEstado !== 0) return porEstado;
      // Dentro del mismo estado: lo que vence antes va primero; sin fecha, al fondo.
      const fa = a.fechaEstimada ? ymdAMs(a.fechaEstimada) : null;
      const fb = b.fechaEstimada ? ymdAMs(b.fechaEstimada) : null;
      if (fa !== fb) {
        if (fa === null) return 1;
        if (fb === null) return -1;
        return fa - fb;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [trabajos]);

  const pendientes = ordenados.filter(t => PENDIENTES.includes(t.estado)).length;
  const abierto = abiertoId === null ? null : ordenados.find(t => t.id === abiertoId) ?? null;

  const cambiarEstado = async (compraId: string, estado: 'en_proceso' | 'en_camino') => {
    const ok = await SupabaseService.sublimacionEstado(compraId, estado);
    if (!ok) {
      toast.error('No se pudo guardar. Fijate que tengas señal y probá de nuevo.');
      return;
    }
    // Se actualiza en pantalla sin volver a leer todo: en el taller la conexión
    // suele estar justa y la respuesta tiene que ser inmediata.
    setTrabajos(prev => (prev ? prev.map(t => (t.id === compraId ? { ...t, estado } : t)) : prev));
    if (estado === 'en_proceso') {
      toast.success('Listo, quedó anotado que lo empezaste');
    } else {
      toast.success('Listo, en VOLEA ya saben que va en camino');
      setAbiertoId(null);
    }
  };

  return (
    <div className="fade-in flex min-h-screen flex-col bg-navy-50 font-body">
      <header className="sticky top-0 z-30 bg-navy-700 text-white shadow-lg">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <FotoConRespaldo
            url="/logo-white.png"
            alt="VOLEA"
            className="h-9 w-auto shrink-0"
            respaldo={<span className="shrink-0 font-display text-xl font-black tracking-tight">VOLEA</span>}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg font-bold leading-tight">Sublimación</p>
            <p className="truncate text-sm text-lime-400">
              Hola{nombre.trim() ? `, ${nombre.trim()}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void cargar(true)}
            disabled={cargando}
            aria-label="Actualizar la lista de trabajos"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 transition-colors hover:bg-white/20 disabled:opacity-50"
          >
            <RefreshCw size={22} className={cargando ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={onSalir}
            className="flex h-12 min-w-[48px] shrink-0 items-center justify-center gap-2 rounded-xl bg-white/10 px-3 font-display font-semibold transition-colors hover:bg-white/20"
          >
            <LogOut size={20} /> <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        {cargando && trabajos === null && !falloLectura ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-navy-700">
            <RefreshCw size={34} className="animate-spin text-lime-500" />
            <p className="font-display text-lg font-semibold">Buscando tus trabajos…</p>
          </div>
        ) : falloLectura && trabajos === null ? (
          <div className="rounded-2xl border border-red-200 bg-white p-6 text-center">
            <AlertTriangle size={38} className="mx-auto text-red-500" />
            <p className="mt-3 font-display text-xl font-bold text-navy-700">No pudimos traer los trabajos</p>
            <p className="mt-1 text-base text-gray-500">
              Puede ser la conexión, o que se te haya vencido la sesión. Probá de nuevo.
            </p>
            <button
              type="button"
              onClick={() => void cargar()}
              disabled={cargando}
              className="mt-5 inline-flex min-h-[56px] items-center justify-center gap-2 rounded-xl bg-navy-700 px-6 font-display text-lg font-bold text-white transition-colors hover:bg-navy-800 disabled:bg-gray-200 disabled:text-gray-400"
            >
              <RefreshCw size={22} className={cargando ? 'animate-spin' : ''} /> Probar de nuevo
            </button>
          </div>
        ) : ordenados.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <Inbox size={44} className="mx-auto text-navy-200" />
            <p className="mt-3 font-display text-xl font-bold text-navy-700">
              No hay trabajos pendientes por ahora.
            </p>
            <p className="mt-1 text-base text-gray-500">
              Cuando VOLEA te mande uno nuevo te va a aparecer acá.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2">
              {pendientes > 0 ? (
                <>
                  <ClipboardList size={22} className="shrink-0 text-navy-700" />
                  <p className="font-display text-lg font-bold text-navy-700">
                    {pendientes === 1 ? 'Tenés 1 trabajo para hacer' : `Tenés ${pendientes} trabajos para hacer`}
                  </p>
                </>
              ) : (
                <>
                  <CheckCircle2 size={22} className="shrink-0 text-lime-600" />
                  <p className="font-display text-lg font-bold text-navy-700">
                    Estás al día, no hay nada pendiente
                  </p>
                </>
              )}
            </div>

            <ul className="space-y-3">
              {ordenados.map(trabajo => (
                <li key={trabajo.id}>
                  <TarjetaTrabajo trabajo={trabajo} onAbrir={() => setAbiertoId(trabajo.id)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      {abierto && (
        <DetalleTrabajo
          trabajo={abierto}
          onCerrar={() => setAbiertoId(null)}
          onEstado={estado => cambiarEstado(abierto.id, estado)}
        />
      )}
    </div>
  );
}
