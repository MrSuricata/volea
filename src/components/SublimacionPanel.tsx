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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
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

/**
 * `chip` va sobre blanco (tarjetas de la lista); `chipOscuro` sobre la barra azul
 * del detalle. Lima solo sobre oscuro: en blanco casi no se lee, por eso "Para
 * hacer" es azul marino en la lista y lima recién en la barra.
 */
interface PintaEstado { texto: string; chip: string; chipOscuro: string; icono: LucideIcon }

const ESTADO: Record<CompraEstado, PintaEstado> = {
  borrador:   { texto: 'Sin enviar',  chip: 'bg-gray-100 text-gray-600 border-gray-200',    chipOscuro: 'bg-gray-100 text-gray-600 border-gray-200',    icono: FileText },
  pedido:     { texto: 'Para hacer',  chip: 'bg-navy-700 text-white border-navy-700',       chipOscuro: 'bg-lime-400 text-navy-900 border-lime-400',    icono: ClipboardList },
  en_proceso: { texto: 'En proceso',  chip: 'bg-amber-100 text-amber-800 border-amber-300', chipOscuro: 'bg-amber-100 text-amber-800 border-amber-300', icono: Hammer },
  en_camino:  { texto: 'Ya lo mandé', chip: 'bg-sky-100 text-sky-800 border-sky-300',       chipOscuro: 'bg-sky-100 text-sky-800 border-sky-300',       icono: Truck },
  recibido:   { texto: 'Entregado',   chip: 'bg-emerald-50 text-emerald-800 border-emerald-200', chipOscuro: 'bg-emerald-50 text-emerald-800 border-emerald-200', icono: PackageCheck },
  cancelado:  { texto: 'Cancelado',   chip: 'bg-red-50 text-red-700 border-red-200',        chipOscuro: 'bg-red-50 text-red-700 border-red-200',        icono: X },
};

/** Los que hay que hacer arriba; lo entregado y lo cancelado al fondo. */
const ORDEN: Record<CompraEstado, number> = {
  pedido: 0, en_proceso: 1, en_camino: 2, recibido: 3, borrador: 4, cancelado: 5,
};

const PENDIENTES: CompraEstado[] = ['pedido', 'en_proceso'];

/** Volver a la app (cambiar de pestaña, desbloquear el celu) relee si pasó al menos esto. */
const RELEER_AL_VOLVER_MS = 30_000;

/**
 * La cuenta regresiva ("atrasado 3 días") solo sirve mientras el trabajo está en el
 * taller. Uno ya mandado, entregado o cancelado mostraba "atrasado" en rojo para
 * siempre; ahí va la fecha sola, en gris.
 */
function entregaDelTrabajo(c: Compra): Entrega {
  if (PENDIENTES.includes(c.estado)) return entregaDe(c.fechaEstimada);
  return {
    texto: c.fechaEstimada ? `Era para el ${fechaCorta(c.fechaEstimada)}` : 'Sin fecha de entrega',
    apura: false,
    vencida: false,
  };
}

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
  const entrega = entregaDelTrabajo(trabajo);
  const unidades = totalUnidades(trabajo);
  const tapa: Foto | undefined = fotosDe(trabajo)[0];

  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex w-full items-stretch gap-3 overflow-hidden rounded-2xl border border-gray-200 bg-white text-left transition-colors hover:border-navy-300 active:border-navy-700"
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
  // "Está pronto, lo mando" no tiene vuelta atrás desde el taller (la base solo deja
  // avanzar el estado): un toque de más con las manos ocupadas avisaba a VOLEA de
  // algo que no salió. Por eso pide un segundo toque, en el mismo lugar del pulgar.
  const [confirmarEnvio, setConfirmarEnvio] = useState(false);

  const pinta = ESTADO[trabajo.estado];
  const Icono = pinta.icono;
  const entrega = entregaDelTrabajo(trabajo);
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
    // Y con la confirmación del envío abierta, Escape la cancela (no cierra el trabajo).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || verFoto !== null) return;
      if (confirmarEnvio) { setConfirmarEnvio(false); return; }
      onCerrar();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCerrar, verFoto, confirmarEnvio]);

  const marcar = async (estado: 'en_proceso' | 'en_camino') => {
    if (guardando !== null) return;
    setGuardando(estado);
    try {
      await onEstado(estado);
    } finally {
      setGuardando(null);
      setConfirmarEnvio(false);
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
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${pinta.chipOscuro}`}>
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
            <section className="rounded-2xl bg-navy-700 p-4 text-white">
              <h2 className="font-display text-base font-bold uppercase tracking-wide text-lime-400">
                Instrucciones
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-lg leading-relaxed text-white">
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
      <div className="shrink-0 border-t border-gray-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {confirmarEnvio && puedeMandar ? (
          <div role="alertdialog" aria-labelledby="confirmar-envio-titulo" className="mx-auto max-w-3xl">
            <p id="confirmar-envio-titulo" className="font-display text-lg font-bold leading-snug text-navy-700">
              ¿Ya está pronto y lo mandás?
            </p>
            <p className="mt-0.5 text-base text-gray-600">
              Le avisamos a VOLEA que va en camino. Después no se puede volver atrás desde acá.
            </p>
            {/* "Todavía no" queda donde estaba "lo mando" (abajo en el celu, a la derecha
                en la compu): un doble toque sin querer cae en el que NO manda. */}
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={() => setConfirmarEnvio(false)}
                disabled={guardando !== null}
                className="inline-flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-xl border-2 border-gray-300 bg-white px-4 font-display text-lg font-bold text-navy-700 transition-colors hover:border-navy-700 disabled:text-gray-400"
              >
                Todavía no
              </button>
              <button
                type="button"
                onClick={() => void marcar('en_camino')}
                disabled={guardando !== null}
                autoFocus
                className="inline-flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-xl bg-navy-700 px-4 font-display text-lg font-bold text-white transition-colors hover:bg-navy-800 disabled:bg-gray-200 disabled:text-gray-400"
              >
                {guardando === 'en_camino' ? (
                  <><RefreshCw size={22} className="animate-spin" /> Anotando…</>
                ) : (
                  <><Send size={22} /> Sí, lo mando</>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row">
            {/* El paso que toca va lleno (azul); el otro, con borde. */}
            <button
              type="button"
              onClick={() => void marcar('en_proceso')}
              disabled={!puedeEmpezar || guardando !== null}
              className={`inline-flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-xl px-4 font-display text-lg font-bold transition-colors disabled:border-transparent disabled:bg-gray-100 disabled:text-gray-400 ${
                puedeEmpezar
                  ? 'bg-navy-700 text-white hover:bg-navy-800'
                  : 'border-2 border-gray-300 bg-white text-navy-700'
              }`}
            >
              {guardando === 'en_proceso' ? (
                <><RefreshCw size={22} className="animate-spin" /> Anotando…</>
              ) : (
                <><Hammer size={22} /> Lo empecé</>
              )}
            </button>
            <button
              type="button"
              onClick={() => setConfirmarEnvio(true)}
              disabled={!puedeMandar || guardando !== null}
              className={`inline-flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-xl px-4 font-display text-lg font-bold transition-colors disabled:border-transparent disabled:bg-gray-100 disabled:text-gray-400 ${
                puedeEmpezar
                  ? 'border-2 border-navy-700 bg-white text-navy-700 hover:bg-navy-50'
                  : 'bg-navy-700 text-white hover:bg-navy-800'
              }`}
            >
              <Send size={22} /> Está pronto, lo mando
            </button>
          </div>
        )}
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
  const [verTerminados, setVerTerminados] = useState(false);
  // Cuándo fue la última lectura y el último estado marcado desde acá (ver abajo).
  const ultimaCarga = useRef(0);
  const cambioLocal = useRef(0);

  const cargar = useCallback(async (avisar = false) => {
    const inicio = Date.now();
    setCargando(true);
    const data = await SupabaseService.getCompras();
    ultimaCarga.current = Date.now();
    if (data === null) {
      setFalloLectura(true);
      if (avisar) toast.error('No se pudieron actualizar los trabajos');
    } else if (cambioLocal.current > inicio) {
      // Mientras viajaba la lectura se marcó un estado desde acá: esa foto ya es
      // vieja y pisaría el "Lo empecé" recién anotado. Se descarta; la próxima
      // lectura trae todo al día.
    } else {
      setFalloLectura(false);
      // La base ya filtra por RLS; el filtro por tipo es por las dudas.
      setTrabajos(data.filter(c => c.tipo === 'sublimacion'));
      if (avisar) toast.success('Lista actualizada');
    }
    setCargando(false);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  // Volver a la app (otra pestaña, el celu bloqueado un rato) relee la lista sin
  // tocar nada: VOLEA pudo haber mandado un trabajo nuevo mientras tanto. Con un
  // mínimo entre lecturas para no gastar datos en cada ida y vuelta.
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - ultimaCarga.current < RELEER_AL_VOLVER_MS) return;
      void cargar();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, [cargar]);

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

  // Tres grupos: lo que hay que hacer, lo que ya salió del taller y el historial
  // (entregado / cancelado), que va plegado para que no se mezcle con lo pendiente.
  const paraHacer = ordenados.filter(t => PENDIENTES.includes(t.estado));
  const enCamino = ordenados.filter(t => t.estado === 'en_camino');
  const terminados = ordenados.filter(t => !PENDIENTES.includes(t.estado) && t.estado !== 'en_camino');
  const pendientes = paraHacer.length;
  const tituloTerminados = terminados.some(t => t.estado === 'cancelado') ? 'Entregados y cancelados' : 'Entregados';
  const abierto = abiertoId === null ? null : ordenados.find(t => t.id === abiertoId) ?? null;

  const cambiarEstado = async (compraId: string, estado: 'en_proceso' | 'en_camino') => {
    const ok = await SupabaseService.sublimacionEstado(compraId, estado);
    if (!ok) {
      toast.error('No se pudo guardar. Fijate que tengas señal y probá de nuevo.');
      return;
    }
    // Se actualiza en pantalla sin volver a leer todo: en el taller la conexión
    // suele estar justa y la respuesta tiene que ser inmediata.
    cambioLocal.current = Date.now();
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
            className="h-7 w-auto shrink-0 sm:h-9"
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
            <RefreshCw size={34} className="animate-spin text-navy-400" />
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
                  <CheckCircle2 size={22} className="shrink-0 text-emerald-600" />
                  <p className="font-display text-lg font-bold text-navy-700">
                    Estás al día, no hay nada pendiente
                  </p>
                </>
              )}
            </div>

            {paraHacer.length > 0 && (
              <ul className="space-y-3">
                {paraHacer.map(trabajo => (
                  <li key={trabajo.id}>
                    <TarjetaTrabajo trabajo={trabajo} onAbrir={() => setAbiertoId(trabajo.id)} />
                  </li>
                ))}
              </ul>
            )}

            {enCamino.length > 0 && (
              <section className={paraHacer.length > 0 ? 'mt-8' : undefined} aria-labelledby="sub-en-camino">
                <h2 id="sub-en-camino" className="flex items-center gap-2 font-display text-base font-bold uppercase tracking-wide text-navy-700">
                  <Truck size={19} className="shrink-0" /> Ya los mandaste
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-sm tabular-nums ring-1 ring-inset ring-navy-100">{enCamino.length}</span>
                </h2>
                <p className="mb-3 mt-0.5 text-base text-gray-500">Cuando lleguen a VOLEA pasan a entregados.</p>
                <ul className="space-y-3">
                  {enCamino.map(trabajo => (
                    <li key={trabajo.id}>
                      <TarjetaTrabajo trabajo={trabajo} onAbrir={() => setAbiertoId(trabajo.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {terminados.length > 0 && (
              <section className={paraHacer.length + enCamino.length > 0 ? 'mt-8' : undefined}>
                <button
                  type="button"
                  onClick={() => setVerTerminados(v => !v)}
                  aria-expanded={verTerminados}
                  aria-controls="sub-terminados"
                  className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 text-left transition-colors hover:border-navy-300"
                >
                  <span className="flex items-center gap-2 font-display text-base font-bold uppercase tracking-wide text-navy-700">
                    <PackageCheck size={19} className="shrink-0" /> {tituloTerminados}
                    <span className="rounded-full bg-navy-50 px-2.5 py-0.5 text-sm tabular-nums">{terminados.length}</span>
                  </span>
                  <ChevronDown size={22} className={`shrink-0 text-gray-500 transition-transform ${verTerminados ? 'rotate-180' : ''}`} />
                </button>
                {verTerminados && (
                  <ul id="sub-terminados" className="mt-3 space-y-3">
                    {terminados.map(trabajo => (
                      <li key={trabajo.id}>
                        <TarjetaTrabajo trabajo={trabajo} onAbrir={() => setAbiertoId(trabajo.id)} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
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
