import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { errorFoto } from '../lib/fotos';
import { srcsetImagen, urlImagen } from '../utils/imagenes';
import { almacenSesion } from '../utils/almacen';
import {
  ESCALA_DOBLE_TOQUE, ESCALA_HOVER, ajusteFoto, anchoMiniatura, decidirSwipe, distancia, esDobleToque,
  escalaConRueda, indiceCircular, indiceDesdeScroll, limitarPaneo, origenZoom, pellizco, puntoMedio,
  colorDeFondo, scrollParaVer, tamanoContenido, vecinos, zoomEnPunto,
  type Ajuste, type Punto, type Rgba, type Toque,
} from './galeria';

// Galería de la ficha de producto, siguiendo lo que mide Baymard en fichas de ropa:
// - Compu: foto grande 4:5 con riel de miniaturas a la izquierda y zoom al pasar el mouse
//   (sigue al cursor y cambia a la foto de 1280 para que se vea nítida).
// - Celular: carrusel nativo con scroll-snap (inercia y rebote del sistema) y miniaturas
//   abajo, no puntitos: con puntitos la gente no descubre que hay más fotos.
// - Tocar/clic en la foto abre el visor a pantalla completa (fondo blanco como el de las
//   fotos): clic o doble toque, pellizco y rueda para ampliar, arrastre para recorrerla y
//   swipe para cambiar. El botón "atrás" del celular lo cierra sin sacarte de la ficha.

type Props = { imagenes: string[]; nombre: string };
type Zoom = { escala: number; x: number; y: number };

const SIN_ZOOM: Zoom = { escala: 1, x: 0, y: 0 };
const CURVA = 'cubic-bezier(0.16, 1, 0.3, 1)';
// Ancho con que se muestra la foto grande: 520px en compu ancha (columna de 600 menos el
// riel), media pantalla en tablet, todo el ancho en celular.
const SIZES_FOTO = '(min-width: 1280px) 520px, (min-width: 768px) 42vw, 100vw';
const DURACION_TIRA = 320;
const DURACION_VISOR = 220;
const CLAVE_PISTA = 'volea_pista_zoom';
// El zoom sigue al cursor con estas variables (se escriben sin re-render en cada movimiento).
const ORIGEN_HOVER: React.CSSProperties = { transformOrigin: 'var(--zoom-x, 50%) var(--zoom-y, 50%)' };

const precargadas = new Set<string>();
function precargar(url: string, srcset?: string, sizes?: string): void {
  if (!url || url.startsWith('data:') || typeof Image === 'undefined') return;
  const clave = srcset ? `${sizes}|${srcset}` : url;
  if (precargadas.has(clave)) return;
  precargadas.add(clave);
  const img = new Image();
  img.decoding = 'async';
  // Mismo srcset/sizes que la <img> real: así el navegador elige el mismo archivo y la
  // precarga le sirve (si no, bajaría otro ancho y la foto se pediría dos veces).
  if (srcset) {
    if (sizes) img.sizes = sizes;
    img.srcset = srcset;
  }
  img.src = url;
}

function scrollSuave(el: HTMLElement, opciones: { left?: number; top?: number }, suave: boolean): void {
  // Element.scrollTo con opciones no existe en los Chromium viejos de los Smart TV.
  if (typeof el.scrollTo === 'function') el.scrollTo({ ...opciones, behavior: suave ? 'smooth' : 'auto' });
  else {
    if (opciones.left !== undefined) el.scrollLeft = opciones.left;
    if (opciones.top !== undefined) el.scrollTop = opciones.top;
  }
}

const esTactil = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

// ─── Foto ────────────────────────────────────────────────────────────────────

/**
 * Píxeles del borde de la foto ya cargada: las 4 esquinas y el medio de cada lado, 2px
 * hacia adentro y de a uno (achicar toda la foto mezclaba la prenda con el fondo y el
 * relleno quedaba más oscuro que la foto). Solo se pueden leer si la foto es del mismo
 * origen: en el sitio publicado lo es (/_vercel/image); en localhost o si el optimizador
 * falla y se cae a Supabase, el canvas queda "manchado" y devuelve null.
 */
function bordeDe(img: HTMLImageElement): Rgba[] | null {
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const xs = [2, w / 2, w - 3].map((x) => Math.min(Math.max(0, x), w - 1));
    const ys = [2, h / 2, h - 3].map((y) => Math.min(Math.max(0, y), h - 1));
    const puntos = xs.flatMap((x) => ys.map((y) => [x, y])).filter(([x, y]) => x !== w / 2 || y !== h / 2);
    const c = document.createElement('canvas');
    c.width = puntos.length;
    c.height = 1;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    puntos.forEach(([x, y], k) => ctx.drawImage(img, Math.floor(x), Math.floor(y), 1, 1, k, 0, 1, 1));
    const d = ctx.getImageData(0, 0, puntos.length, 1).data;
    return puntos.map((_, k): Rgba => [d[k * 4], d[k * 4 + 1], d[k * 4 + 2], d[k * 4 + 3]]);
  } catch {
    return null;
  }
}

type FotoProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  original: string;
  /** Oculta al instante (sin fundido): la capa de 1280 la reemplaza. */
  oculta?: boolean;
  /** Va sobre la caja gris: blanco/transparente se funde (multiply); fondo parejo de otro color rellena las franjas. */
  sobreGris?: boolean;
  alCargar?: () => void;
};

/** <img> que aparece con un fundido al cargar y elige cover/contain según su forma. */
function Foto({ original, oculta = false, sobreGris = false, alCargar, className, style, onError, ...resto }: FotoProps) {
  const [medida, setMedida] = useState<{ ajuste: Ajuste; fondo: string | null } | null>(null);
  const medir = (img: HTMLImageElement | null) => {
    if (!img || medida !== null || !img.complete || !(img.naturalWidth > 0)) return;
    setMedida({
      ajuste: ajusteFoto(img.naturalWidth, img.naturalHeight),
      fondo: sobreGris ? colorDeFondo(bordeDe(img) ?? []) : null,
    });
    alCargar?.();
  };
  return (
    <img
      {...resto}
      ref={medir}
      onLoad={(e) => medir(e.currentTarget)}
      onError={onError ?? errorFoto(original)}
      // El fondo de la <img> pinta las franjas de object-contain (y escala con el zoom).
      style={medida?.fondo ? { ...style, backgroundColor: medida.fondo } : style}
      className={clsx(
        className,
        medida?.ajuste === 'cover' ? 'object-cover' : 'object-contain',
        medida ? 'opacity-100' : 'opacity-0',
        // mix-blend-multiply: las fotos vienen sobre blanco puro; así el blanco toma el gris
        // de la caja y la prenda parece fotografiada en estudio, sin recuadro.
        sobreGris && !medida?.fondo && 'mix-blend-multiply',
        oculta && 'invisible',
      )}
    />
  );
}

// ─── Miniatura ───────────────────────────────────────────────────────────────

function Miniatura({ url, i, total, activa, onClick, className, style }: {
  url: string; i: number; total: number; activa: boolean; onClick: () => void; className?: string; style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      data-miniatura=""
      onClick={onClick}
      aria-label={`Ver foto ${i + 1} de ${total}`}
      aria-current={activa ? 'true' : undefined}
      style={style}
      // Sin atenuar las inactivas (el clásico opacity-70): sobre prendas oscuras el negro
      // se ve gris y el azul marino pizarra, y acá el color ES la variante que se elige.
      className={clsx('group/mini relative isolate shrink-0 overflow-hidden rounded-lg bg-gray-100 outline-none', className)}
    >
      <Foto
        original={url}
        src={urlImagen(url, 160)}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        sobreGris
        className="h-full w-full transition-opacity duration-300"
      />
      {/* El anillo va encima de la foto y hacia adentro: un ring común (box-shadow) quedaba
          tapado por la imagen o recortado por el scroll de la fila. Navy y no lima: el lima
          sobre blanco casi no se ve. */}
      <span
        aria-hidden="true"
        className={clsx(
          'pointer-events-none absolute inset-0 rounded-lg ring-inset transition-shadow duration-200',
          activa ? 'ring-2 ring-navy-700' : 'ring-1 ring-black/5 group-hover/mini:ring-2 group-hover/mini:ring-navy-700/30',
          'group-focus-visible/mini:ring-[3px] group-focus-visible/mini:ring-navy-400',
        )}
      />
    </button>
  );
}

// ─── Galería ─────────────────────────────────────────────────────────────────

export default function GaleriaProducto({ imagenes, nombre }: Props) {
  const total = imagenes.length;
  const varias = total > 1;
  // La placa VOLEA (producto sin fotos) no tiene nada que ampliar.
  const ampliable = total > 0 && !(total === 1 && imagenes[0].startsWith('data:'));
  const reducir = useReducedMotion() ?? false;

  const [indiceCrudo, setIndice] = useState(0);
  const indice = Math.min(indiceCrudo, Math.max(0, total - 1));
  const [visor, setVisor] = useState<number | null>(null);
  const [zoomHover, setZoomHover] = useState(false);
  const [hiRes, setHiRes] = useState<Record<string, 'cargando' | 'lista' | 'error'>>({});
  const [anchoMini, setAnchoMini] = useState(56);

  const raizRef = useRef<HTMLElement>(null);
  const carruselRef = useRef<HTMLDivElement>(null);
  const filaRef = useRef<HTMLDivElement>(null);
  const rielRef = useRef<HTMLDivElement>(null);
  const botonesRef = useRef<(HTMLButtonElement | null)[]>([]);
  const destinoRef = useRef<number | null>(null);
  const destinoTimer = useRef(0);
  const rafScroll = useRef(0);
  const disparadorRef = useRef<HTMLElement | null>(null);
  const indiceRef = useRef(indice);
  indiceRef.current = indice;

  const irA = useCallback((i: number, suave = true) => {
    const destino = indiceCircular(i, total);
    setIndice(destino);
    const el = carruselRef.current;
    if (!el) return;
    // Mientras el scroll suave pasa por las fotos del medio, el contador y las miniaturas
    // no las marcan: van directo a la elegida.
    destinoRef.current = destino;
    window.clearTimeout(destinoTimer.current);
    destinoTimer.current = window.setTimeout(() => { destinoRef.current = null; }, 800);
    scrollSuave(el, { left: destino * el.clientWidth }, suave && !reducir);
  }, [total, reducir]);

  const alScrollear = () => {
    if (rafScroll.current) return;
    rafScroll.current = requestAnimationFrame(() => {
      rafScroll.current = 0;
      const el = carruselRef.current;
      if (!el) return;
      const i = indiceDesdeScroll(el.scrollLeft, el.clientWidth, total);
      if (destinoRef.current !== null) {
        if (i !== destinoRef.current) return;
        destinoRef.current = null;
      }
      setIndice(i);
    });
  };

  useEffect(() => () => {
    cancelAnimationFrame(rafScroll.current);
    window.clearTimeout(destinoTimer.current);
  }, []);

  // Anterior y siguiente listas antes de que se deslice hacia ellas.
  useEffect(() => {
    for (const v of vecinos(indice, total)) precargar(urlImagen(imagenes[v], 960), srcsetImagen(imagenes[v], 1280), SIZES_FOTO);
  }, [indice, total, imagenes]);

  // La miniatura activa siempre a la vista (fila del celular y riel de la compu).
  useEffect(() => {
    const fila = filaRef.current;
    const mini = fila?.children[indice] as HTMLElement | undefined;
    if (fila && mini && fila.clientWidth > 0) {
      const x = scrollParaVer(fila.scrollLeft, fila.clientWidth, mini.offsetLeft, mini.offsetWidth);
      if (x !== fila.scrollLeft) scrollSuave(fila, { left: x }, !reducir);
    }
    const riel = rielRef.current;
    const miniRiel = riel?.children[indice] as HTMLElement | undefined;
    if (riel && miniRiel && riel.clientHeight > 0) {
      const y = scrollParaVer(riel.scrollTop, riel.clientHeight, miniRiel.offsetTop, miniRiel.offsetHeight);
      if (y !== riel.scrollTop) scrollSuave(riel, { top: y }, !reducir);
    }
  }, [indice, reducir]);

  // Miniaturas del celular: si no entran todas, la última visible queda cortada al medio.
  useEffect(() => {
    const fila = filaRef.current;
    if (!fila || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => setAnchoMini(anchoMiniatura(fila.clientWidth, total)));
    obs.observe(fila);
    return () => obs.disconnect();
  }, [total]);

  // Zoom con el mouse: la foto de 1280 se pide al primer hover y reemplaza a la chica
  // apenas llega (la chica ampliada 2,2× se ve borrosa).
  useEffect(() => {
    if (!zoomHover) return;
    const url = imagenes[indice];
    if (url && !hiRes[url]) setHiRes((h) => ({ ...h, [url]: 'cargando' }));
  }, [zoomHover, indice, imagenes, hiRes]);

  const moverOrigen = (e: React.PointerEvent<HTMLElement>) => {
    const el = carruselRef.current;
    if (!el) return;
    const o = origenZoom(e.clientX, e.clientY, el.getBoundingClientRect());
    el.style.setProperty('--zoom-x', `${o.x}%`);
    el.style.setProperty('--zoom-y', `${o.y}%`);
  };
  const alMoverMouse = (e: React.PointerEvent<HTMLDivElement>) => {
    // Solo mouse: en pantallas táctiles el zoom es del visor (pellizco / doble toque).
    if (e.pointerType !== 'mouse' || !ampliable || visor !== null) return;
    moverOrigen(e);
    if (!zoomHover) setZoomHover(true);
  };

  const abrir = (i: number, disparador: HTMLElement) => {
    if (!ampliable) return;
    disparadorRef.current = disparador;
    setZoomHover(false);
    // Una entrada propia en el historial: el "atrás" del celular cierra el visor en vez de
    // salir de la ficha. Se conserva el state del router (key/idx) para no confundirlo.
    try {
      const previo = window.history.state;
      window.history.pushState({ ...(previo && typeof previo === 'object' ? previo : {}), galeriaVolea: true }, '');
    } catch { /* sin history: se cierra igual con la X o Escape */ }
    setVisor(i);
  };

  const alCerrarVisor = () => {
    setVisor(null);
    const disparador = disparadorRef.current;
    disparadorRef.current = null;
    // Si se abrió desde la foto grande y adentro se cambió de foto, el foco vuelve a la
    // foto que quedó en pantalla (la original ya no se ve).
    const destino = disparador?.dataset.fotoGaleria !== undefined ? botonesRef.current[indiceRef.current] : disparador;
    destino?.focus({ preventScroll: true });
  };
  const alTeclado = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!varias || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    // Los eventos del visor (portal) también suben por el árbol de React: esos no.
    if (!raizRef.current?.contains(e.target as Node)) return;
    e.preventDefault(); // si no, la flecha además scrollea el carrusel a mano
    const nuevo = indiceCircular(indice + (e.key === 'ArrowRight' ? 1 : -1), total);
    irA(nuevo);
    const origen = e.target as HTMLElement;
    if (origen.dataset.fotoGaleria !== undefined) botonesRef.current[nuevo]?.focus({ preventScroll: true });
    else if (origen.dataset.miniatura !== undefined) {
      (origen.parentElement?.children[nuevo] as HTMLElement | undefined)?.focus({ preventScroll: true });
    }
  };

  const flecha = 'absolute top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-navy-700 shadow-lg ring-1 ring-black/5 backdrop-blur transition-[opacity,background-color] duration-200 hover:bg-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-700 group-hover:opacity-100 opacity-0 [@media(min-width:768px)_and_(pointer:fine)]:flex';

  return (
    <section ref={raizRef} aria-label={`Fotos de ${nombre}`} onKeyDown={alTeclado} className="min-w-0 md:flex md:gap-3 md:self-start lg:gap-4">
      {varias && (
        // El riel no aporta alto: se estira al de la foto grande y scrollea si hay muchas.
        // (Por eso la sección va con self-start: estirada al alto de la columna de info,
        // el riel se alargaba hasta el final de la ficha.)
        <div className="relative hidden w-16 shrink-0 md:block lg:w-[72px]">
          <div
            ref={rielRef}
            className="absolute inset-0 flex flex-col gap-3 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {imagenes.map((url, i) => (
              <Miniatura key={i} url={url} i={i} total={total} activa={i === indice} onClick={() => irA(i)} className="aspect-[4/5] w-full" />
            ))}
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="group relative">
          <div
            ref={carruselRef}
            onScroll={alScrollear}
            onPointerEnter={alMoverMouse}
            onPointerMove={alMoverMouse}
            onPointerLeave={() => setZoomHover(false)}
            className="relative isolate flex aspect-[4/5] snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-2xl bg-gray-100 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {imagenes.map((url, i) => {
              const actual = i === indice;
              const hi = hiRes[url];
              const transform = actual && zoomHover ? `scale(${ESCALA_HOVER})` : 'scale(1)';
              const clases = 'absolute inset-0 h-full w-full select-none motion-reduce:transition-none';
              const fotos = (
                <>
                  <Foto
                    original={url}
                    src={urlImagen(url, 960)}
                    srcSet={srcsetImagen(url, 1280)}
                    sizes={SIZES_FOTO}
                    alt={`${nombre} — foto ${i + 1}`}
                    loading={i === 0 || Math.abs(i - indice) <= 1 ? 'eager' : 'lazy'}
                    fetchPriority={i === 0 ? 'high' : undefined}
                    decoding="async"
                    draggable={false}
                    sobreGris
                    oculta={hi === 'lista'}
                    className={clsx(clases, 'transition-[transform,opacity] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]')}
                    style={{ ...ORIGEN_HOVER, transform }}
                  />
                  {(hi === 'cargando' || hi === 'lista') && (
                    <Foto
                      original={url}
                      src={urlImagen(url, 1280)}
                      alt=""
                      aria-hidden="true"
                      decoding="async"
                      draggable={false}
                      sobreGris
                      alCargar={() => setHiRes((h) => ({ ...h, [url]: 'lista' }))}
                      onError={() => setHiRes((h) => ({ ...h, [url]: 'error' }))}
                      // Sin fundido de opacidad: las dos capas con multiply superpuestas
                      // oscurecen la prenda; el cambio tiene que ser en el mismo cuadro.
                      className={clsx(clases, 'pointer-events-none transition-transform duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]')}
                      style={{ ...ORIGEN_HOVER, transform }}
                    />
                  )}
                </>
              );
              return (
                <div
                  key={i}
                  aria-hidden={actual ? undefined : true}
                  className="relative h-full w-full shrink-0 snap-center snap-always overflow-hidden"
                >
                  {ampliable ? (
                    <button
                      type="button"
                      ref={(el) => { botonesRef.current[i] = el; }}
                      data-foto-galeria=""
                      tabIndex={actual ? 0 : -1}
                      aria-label="Ampliar foto"
                      onClick={(e) => abrir(i, e.currentTarget)}
                      className="relative block h-full w-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-700"
                    >
                      {fotos}
                    </button>
                  ) : fotos}
                </div>
              );
            })}
          </div>

          {varias && (
            <>
              <button type="button" onClick={() => irA(indice - 1)} aria-label="Foto anterior" className={clsx(flecha, 'left-3')}>
                <ChevronLeft size={22} strokeWidth={2.25} />
              </button>
              <button type="button" onClick={() => irA(indice + 1)} aria-label="Foto siguiente" className={clsx(flecha, 'right-3')}>
                <ChevronRight size={22} strokeWidth={2.25} />
              </button>
              <p
                aria-hidden="true"
                className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-white/90 px-2.5 py-1 font-display text-xs font-semibold tabular-nums text-navy-700 shadow-sm ring-1 ring-black/5 backdrop-blur md:hidden"
              >
                {indice + 1} / {total}
              </p>
            </>
          )}
        </div>

        {varias && (
          <div
            ref={filaRef}
            className="relative mt-3 flex gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
          >
            {imagenes.map((url, i) => (
              <Miniatura
                key={i}
                url={url}
                i={i}
                total={total}
                activa={i === indice}
                onClick={() => irA(i)}
                style={{ width: anchoMini, height: anchoMini * 1.25 }}
              />
            ))}
          </div>
        )}
      </div>

      {visor !== null && (
        <VisorFotos
          imagenes={imagenes}
          nombre={nombre}
          inicial={visor}
          onCerrando={(final) => irA(final, false)}
          onCerrado={alCerrarVisor}
        />
      )}
    </section>
  );
}

// ─── Visor a pantalla completa ───────────────────────────────────────────────

type Modo = 'nada' | 'decidiendo' | 'swipe' | 'paneo' | 'pellizco';
type Gesto = {
  punteros: Map<number, Punto>;
  modo: Modo;
  inicio: Punto;
  t0: number;
  zoomInicio: Zoom;
  movio: boolean;
  pellizcoInicio: { escala: number; t: Punto; medio: Punto; distancia: number } | null;
};

const nuevoGesto = (): Gesto => ({
  punteros: new Map(), modo: 'nada', inicio: { x: 0, y: 0 }, t0: 0, zoomInicio: SIN_ZOOM, movio: false, pellizcoInicio: null,
});

function atraparFoco(e: KeyboardEvent, dialogo: HTMLElement | null): void {
  if (!dialogo) return;
  const focos = Array.from(
    dialogo.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => el.getClientRects().length > 0); // los ocultos por CSS (flechas en celular) no cuentan
  if (focos.length === 0) { e.preventDefault(); return; }
  const primero = focos[0];
  const ultimo = focos[focos.length - 1];
  const activo = document.activeElement;
  const afuera = !activo || activo === dialogo || !dialogo.contains(activo);
  if (e.shiftKey ? afuera || activo === primero : afuera || activo === ultimo) {
    e.preventDefault();
    (e.shiftKey ? ultimo : primero).focus();
  }
}

function VisorFotos({ imagenes, nombre, inicial, onCerrando, onCerrado }: {
  imagenes: string[];
  nombre: string;
  inicial: number;
  onCerrando: (indice: number) => void;
  onCerrado: () => void;
}) {
  const total = imagenes.length;
  const varias = total > 1;
  const reducir = useReducedMotion() ?? false;
  // Posición "virtual" (no da la vuelta): las keys de los paneles se reusan al avanzar y
  // la foto que entra ya está cargada en el panel de al lado (sin parpadeo).
  const [pos, setPos] = useState(inicial);
  const indice = indiceCircular(pos, total);
  const [visible, setVisible] = useState(false);
  const [ampliada, setAmpliada] = useState(false);
  // Decidido al montar (no en un efecto): con StrictMode el efecto corre dos veces y la
  // segunda ya encontraría la marca de "vista".
  const [pista, setPista] = useState(() => esTactil() && almacenSesion.leer(CLAVE_PISTA) !== '1');
  const [pistaSaliendo, setPistaSaliendo] = useState(false);

  const dialogoRef = useRef<HTMLDivElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const superficieRef = useRef<HTMLDivElement>(null);
  const tiraRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const zoomRef = useRef<Zoom>(SIN_ZOOM);
  const animandoRef = useRef(false);
  const cerrandoRef = useRef(false);
  const gesto = useRef<Gesto>(nuevoGesto());
  const ultimoToque = useRef<Toque | null>(null);
  const timers = useRef<number[]>([]);

  const programar = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);

  // Transforms escritos directo en el DOM: a 60 cuadros por segundo un setState por
  // movimiento del dedo re-renderizaría todo el visor.
  const aplicarZoom = (z: Zoom, animado: boolean) => {
    zoomRef.current = z;
    const img = imgRef.current;
    if (img) {
      img.style.transition = animado && !reducir ? `transform 250ms ${CURVA}` : 'none';
      img.style.transform = z.escala === 1 && z.x === 0 && z.y === 0 ? '' : `translate3d(${z.x}px, ${z.y}px, 0) scale(${z.escala})`;
    }
    setAmpliada(z.escala > 1.01);
  };

  const moverTira = (px: number, animado: boolean) => {
    const tira = tiraRef.current;
    if (!tira) return;
    tira.style.transition = animado && !reducir ? `transform ${DURACION_TIRA}ms ${CURVA}` : 'none';
    tira.style.transform = px ? `translate3d(${px}px, 0, 0)` : '';
  };

  const medidas = () => {
    const sup = superficieRef.current;
    const img = imgRef.current;
    const caja = { ancho: sup?.clientWidth ?? 0, alto: sup?.clientHeight ?? 0 };
    const marco = img ? { ancho: img.offsetWidth, alto: img.offsetHeight } : caja;
    const natural = img && img.naturalWidth > 0 ? { ancho: img.naturalWidth, alto: img.naturalHeight } : { ancho: 0, alto: 0 };
    return { caja, base: tamanoContenido(natural, marco) };
  };

  /** Punto de pantalla → relativo al centro del área de la foto (donde está su centro). */
  const relativo = (p: Punto): Punto => {
    const r = superficieRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: p.x - r.left - r.width / 2, y: p.y - r.top - r.height / 2 };
  };

  const ocultarPista = () => { if (pista) setPistaSaliendo(true); };

  // Al cambiar de foto: la tira vuelve al centro en el MISMO cuadro en que React reacomoda
  // los paneles (por eso layout effect), y la foto nueva arranca sin zoom.
  useLayoutEffect(() => {
    moverTira(0, false);
    zoomRef.current = SIN_ZOOM;
    setAmpliada(false);
  }, [pos]);

  const navegar = (dir: -1 | 1) => {
    if (!varias || animandoRef.current || cerrandoRef.current) return;
    if (zoomRef.current !== SIN_ZOOM) aplicarZoom(SIN_ZOOM, false);
    if (reducir) { setPos((p) => p + dir); return; }
    animandoRef.current = true;
    moverTira(-dir * (superficieRef.current?.clientWidth ?? 0), true);
    programar(() => { animandoRef.current = false; setPos((p) => p + dir); }, DURACION_TIRA);
  };

  const saltarA = (i: number) => {
    if (i === indice || animandoRef.current) return;
    aplicarZoom(SIN_ZOOM, false);
    setPos((p) => p - indiceCircular(p, total) + i);
  };

  const alternarZoom = (p: Punto) => {
    ocultarPista();
    if (zoomRef.current.escala > 1.01) { aplicarZoom(SIN_ZOOM, true); return; }
    const { base, caja } = medidas();
    const t = zoomEnPunto({ x: 0, y: 0 }, 1, ESCALA_DOBLE_TOQUE, p);
    aplicarZoom({ escala: ESCALA_DOBLE_TOQUE, ...limitarPaneo(t, ESCALA_DOBLE_TOQUE, base, caja) }, true);
  };

  const cerrar = (porAtras = false) => {
    if (cerrandoRef.current) return;
    cerrandoRef.current = true;
    // Cerrado con X/Escape: se saca la entrada que puso abrir(), solo si sigue arriba
    // (si se cerró con "atrás", el navegador ya la sacó y otro back saldría de la ficha).
    if (!porAtras) {
      try { if (window.history.state?.galeriaVolea) window.history.back(); } catch { /* nada */ }
    }
    onCerrando(indice);
    setVisible(false);
    programar(onCerrado, reducir ? 0 : DURACION_VISOR);
  };

  const rueda = (e: WheelEvent) => {
    e.preventDefault();
    const z = zoomRef.current;
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    const escala = escalaConRueda(z.escala, delta);
    if (escala === z.escala) return;
    ocultarPista();
    if (escala <= 1.01) { aplicarZoom(SIN_ZOOM, false); return; }
    const { base, caja } = medidas();
    const t = zoomEnPunto(z, z.escala, escala, relativo({ x: e.clientX, y: e.clientY }));
    aplicarZoom({ escala, ...limitarPaneo(t, escala, base, caja) }, false);
  };

  const teclado = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && varias) {
      e.preventDefault();
      navegar(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === 'Tab') atraparFoco(e, dialogoRef.current);
  };

  // Los listeners de documento se registran una vez y llaman a la versión más nueva.
  const acciones = useRef({ cerrar, teclado, rueda });
  acciones.current = { cerrar, teclado, rueda };

  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    void dialogoRef.current?.offsetHeight; // fija el estilo inicial para que el fundido arranque
    const raf = requestAnimationFrame(() => setVisible(true));
    cerrarRef.current?.focus({ preventScroll: true });
    const alTeclado = (e: KeyboardEvent) => acciones.current.teclado(e);
    const alVolver = () => acciones.current.cerrar(true);
    const alRueda = (e: WheelEvent) => acciones.current.rueda(e);
    const sup = superficieRef.current;
    document.addEventListener('keydown', alTeclado);
    window.addEventListener('popstate', alVolver);
    // No pasivo: hay que frenar el scroll/zoom del navegador con la rueda sobre la foto.
    sup?.addEventListener('wheel', alRueda, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = previo;
      document.removeEventListener('keydown', alTeclado);
      window.removeEventListener('popstate', alVolver);
      sup?.removeEventListener('wheel', alRueda);
    };
  }, []);

  useEffect(() => {
    if (!pista) return;
    almacenSesion.guardar(CLAVE_PISTA, '1');
    const t1 = window.setTimeout(() => setPistaSaliendo(true), 3000);
    return () => window.clearTimeout(t1);
  }, [pista]);
  useEffect(() => {
    if (!pistaSaliendo) return;
    const t = window.setTimeout(() => setPista(false), 500);
    return () => window.clearTimeout(t);
  }, [pistaSaliendo]);

  // ── Gestos: un dedo arrastra (cambia de foto, o mueve la foto si está ampliada), dos
  // dedos pellizcan, doble toque alterna el zoom. Todo con Pointer Events (mouse incluido).
  const alBajar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Las flechas están adentro: con la captura del puntero su clic no llegaría.
    if ((e.target as Element).closest('button') || animandoRef.current) return;
    const g = gesto.current;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
    g.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.punteros.size === 2) {
      if (g.modo === 'swipe') moverTira(0, true);
      const [a, b] = Array.from(g.punteros.values());
      const z = zoomRef.current;
      g.modo = 'pellizco';
      g.movio = true;
      g.pellizcoInicio = { escala: z.escala, t: { x: z.x, y: z.y }, medio: relativo(puntoMedio(a, b)), distancia: distancia(a, b) };
      ocultarPista();
    } else if (g.punteros.size === 1) {
      g.modo = zoomRef.current.escala > 1.01 ? 'paneo' : 'decidiendo';
      g.inicio = { x: e.clientX, y: e.clientY };
      g.t0 = e.timeStamp;
      g.zoomInicio = zoomRef.current;
      g.movio = false;
    }
  };

  const alMover = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesto.current;
    if (!g.punteros.has(e.pointerId)) return;
    g.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.modo === 'pellizco') {
      if (g.punteros.size < 2 || !g.pellizcoInicio) return;
      const [a, b] = Array.from(g.punteros.values());
      const r = pellizco(g.pellizcoInicio, relativo(puntoMedio(a, b)), distancia(a, b));
      const { base, caja } = medidas();
      aplicarZoom({ escala: r.escala, ...limitarPaneo(r.t, r.escala, base, caja) }, false);
      return;
    }
    const dx = e.clientX - g.inicio.x;
    const dy = e.clientY - g.inicio.y;
    if (!g.movio && Math.hypot(dx, dy) > 6) g.movio = true;
    if (!g.movio) return;
    if (g.modo === 'paneo') {
      const z0 = g.zoomInicio;
      const { base, caja } = medidas();
      aplicarZoom({ escala: z0.escala, ...limitarPaneo({ x: z0.x + dx, y: z0.y + dy }, z0.escala, base, caja) }, false);
      return;
    }
    if (g.modo === 'decidiendo') g.modo = varias && Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'nada';
    if (g.modo === 'swipe') moverTira(dx, false);
  };

  const alSoltar = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesto.current;
    if (!g.punteros.has(e.pointerId)) return;
    g.punteros.delete(e.pointerId);
    if (g.modo === 'pellizco') {
      if (g.punteros.size === 1) {
        // Queda un dedo: sigue moviendo la foto desde donde está, sin salto.
        const [resto] = Array.from(g.punteros.values());
        g.modo = zoomRef.current.escala > 1.01 ? 'paneo' : 'nada';
        g.inicio = resto;
        g.zoomInicio = zoomRef.current;
      } else if (g.punteros.size === 0) {
        g.modo = 'nada';
        if (zoomRef.current.escala < 1.05) aplicarZoom(SIN_ZOOM, true);
      }
      return;
    }
    if (g.punteros.size > 0) return;
    const modo = g.modo;
    g.modo = 'nada';
    if (modo === 'swipe') {
      const dx = e.clientX - g.inicio.x;
      const dy = e.clientY - g.inicio.y;
      const dir = e.type === 'pointercancel' ? 0 : decidirSwipe(dx, dy, e.timeStamp - g.t0, superficieRef.current?.clientWidth ?? 0);
      if (dir) navegar(dir);
      else moverTira(0, true);
      return;
    }
    if (!g.movio && e.type === 'pointerup') {
      const toque = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      const doble = esDobleToque(ultimoToque.current, toque);
      ultimoToque.current = doble ? null : toque;
      if (e.pointerType === 'mouse') {
        // Con mouse el cursor ya dice "ampliar": alcanza un clic. El segundo clic de un
        // doble clic se ignora, así el doble clic también amplía (no amplía y desamplía).
        if (!doble) alternarZoom(relativo(toque));
      } else if (doble) {
        alternarZoom(relativo(toque));
      }
    }
  };

  const panel = (k: number, actual: boolean) => {
    const i = indiceCircular(k, total);
    const url = imagenes[i];
    return (
      <div
        key={k}
        aria-hidden={actual ? undefined : true}
        className={clsx('flex h-full shrink-0 items-center justify-center px-2 py-2 md:px-24 md:py-4', varias ? 'w-1/3' : 'w-full')}
      >
        <img
          ref={actual ? imgRef : undefined}
          src={urlImagen(url, 1280)}
          alt={`${nombre} — foto ${i + 1}`}
          draggable={false}
          decoding="async"
          onError={errorFoto(url)}
          className="h-full w-full select-none object-contain"
        />
      </div>
    );
  };

  const flecha = 'absolute top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white text-navy-700 shadow-md ring-1 ring-gray-200 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-700 [@media(pointer:fine)]:flex';

  return createPortal(
    // PORTAL a <body>: la página tiene ancestros con transform (PageTransition, .fade-in)
    // y ahí adentro `position: fixed` queda relativo a ellos (ver FlyerTorneo en App.tsx).
    <div
      ref={dialogoRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Fotos de ${nombre}`}
      tabIndex={-1}
      className={clsx(
        'fixed inset-0 z-[70] flex flex-col bg-white outline-none transition-[opacity,transform] duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transform-none',
        visible ? 'scale-100 opacity-100' : 'scale-[0.98] opacity-0',
      )}
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-3 md:h-16 md:px-5">
        <p aria-live="polite" className="pl-2 font-display text-sm font-semibold tabular-nums text-navy-700">
          {varias ? `${indice + 1} / ${total}` : ''}
        </p>
        <button
          ref={cerrarRef}
          type="button"
          onClick={() => cerrar()}
          aria-label="Cerrar"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-navy-700 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-700"
        >
          <X size={22} strokeWidth={2.25} />
        </button>
      </div>

      <div
        ref={superficieRef}
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
        className={clsx(
          'relative min-h-0 flex-1 touch-none select-none overflow-hidden',
          ampliada ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
        )}
      >
        {varias ? (
          <div ref={tiraRef} className="absolute inset-y-0 -left-full flex w-[300%]">
            {panel(pos - 1, false)}
            {panel(pos, true)}
            {panel(pos + 1, false)}
          </div>
        ) : (
          <div ref={tiraRef} className="absolute inset-0 flex">{panel(pos, true)}</div>
        )}

        {varias && (
          <>
            <button type="button" onClick={() => navegar(-1)} aria-label="Foto anterior" className={clsx(flecha, 'left-4 md:left-6')}>
              <ChevronLeft size={24} strokeWidth={2.25} />
            </button>
            <button type="button" onClick={() => navegar(1)} aria-label="Foto siguiente" className={clsx(flecha, 'right-4 md:right-6')}>
              <ChevronRight size={24} strokeWidth={2.25} />
            </button>
          </>
        )}

        {pista && (
          <p
            role="status"
            className={clsx(
              'pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-navy-700/90 px-4 py-2 font-display text-[13px] font-semibold text-white shadow-lg backdrop-blur transition-opacity duration-500',
              pistaSaliendo ? 'opacity-0' : 'opacity-100',
            )}
          >
            Pellizcá o tocá dos veces para ampliar
          </p>
        )}
      </div>

      {varias && (
        // También en celular: sobra alto (las fotos son apaisadas) y saltar directo a una
        // foto es más rápido que deslizar. En pantallas bajas (celular acostado) no entra.
        <div className="shrink-0 overflow-x-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 [scrollbar-width:none] md:pb-5 md:pt-3 [&::-webkit-scrollbar]:hidden [@media(max-height:500px)]:hidden">
          <div className="mx-auto flex w-max gap-2">
            {imagenes.map((url, i) => (
              <Miniatura key={i} url={url} i={i} total={total} activa={i === indice} onClick={() => saltarA(i)} className="h-[60px] w-12 md:h-[70px] md:w-14" />
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
