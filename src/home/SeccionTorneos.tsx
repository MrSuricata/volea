import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Trophy } from 'lucide-react';
import { listarJugadoresPublicos, listarTorneosPublicos, obtenerConfigPublico } from '../torneos/publico/datos';
import { EncabezadoSeccion } from '../ui/EncabezadoSeccion';
import { LineasCancha } from '../ui/LineasCancha';
import { Contador } from '../ui/Contador';
import { Reveal, StaggerGrid, StaggerItem } from '../ui/movimiento';
import { hayContenido, resumenTorneosHome } from './torneosHome';
import type { CategoriaHome, EnVivoHome, FilaTopHome, ResumenTorneosHome, StatsHome, UltimaFechaHome } from './torneosHome';

// Sección "Torneos" de la home: últimos campeones, top del ranking del año y números
// de la liga. Solo lectura (los mismos helpers públicos que /torneos y /ranking). Si
// algo falla o no hay nada para mostrar, no se dibuja: la home nunca muestra un bloque roto.

// Filas de campeones: en celular 5 (la sección entera tiene que entrar en ~1.300px de
// scroll a 390px de ancho: la home no puede ser eterna), en escritorio 8.
const FILAS_CEL = 5;
const FILAS_ESCRITORIO = 8;

type Estado = { tipo: 'cargando' } | { tipo: 'listo'; resumen: ResumenTorneosHome } | { tipo: 'vacio' };

export default function SeccionTorneos() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });

  useEffect(() => {
    let vigente = true;
    void (async () => {
      try {
        const [rt, rj, rc] = await Promise.all([listarTorneosPublicos(), listarJugadoresPublicos(), obtenerConfigPublico()]);
        if (!vigente) return;
        if (rt.error || rj.error) { setEstado({ tipo: 'vacio' }); return; }
        const resumen = resumenTorneosHome(rt.torneos, rj.jugadores, rc.config, Date.now());
        // Escalera de puntos sin confirmar con el server: /ranking lo avisa con un cartel;
        // acá no hay lugar para el aviso, así que mejor no mostrar puntos con cara de oficiales.
        const final = rc.confiable ? resumen : { ...resumen, top: [] };
        setEstado(hayContenido(final) ? { tipo: 'listo', resumen: final } : { tipo: 'vacio' });
      } catch (err) {
        console.error('[home torneos] no se pudo armar la sección', err);
        if (vigente) setEstado({ tipo: 'vacio' });
      }
    })();
    return () => { vigente = false; };
  }, []);

  if (estado.tipo === 'vacio') return null;
  const r = estado.tipo === 'listo' ? estado.resumen : null;

  return (
    <section className="relative overflow-hidden bg-navy-900 py-16 md:py-24">
      <Fondo />
      <div className="relative mx-auto max-w-7xl px-4">
        {r?.enVivo && <PildoraEnVivo enVivo={r.enVivo} />}
        <EncabezadoSeccion
          tono="oscuro"
          eyebrow="Torneos VOLEA"
          titulo="La cancha habla"
          bajada="Cada fecha suma al Ranking VOLEA. Estos son los últimos campeones y quién manda este año."
          link={{ to: '/torneos', texto: 'Todos los torneos' }}
        />
        {r ? <Contenido r={r} /> : <Esqueleto />}
      </div>
    </section>
  );
}

// ─── Fondo ───────────────────────────────────────────────────────────────────

// Cancha en perspectiva arriba a la derecha, "iluminada" por un halo lime muy suave, y
// que se desvanece antes de llegar a las tarjetas (líneas cruzando por detrás de la lista
// se leían como rayas sucias). Todo decorativo (aria-hidden) y sin blur: el filtro blur en
// celulares flojos se nota al scrollear, el radial-gradient no.
const MASCARA_CANCHA = 'radial-gradient(ellipse 60% 55% at 65% 35%, #000 35%, transparent 100%)';

function Fondo() {
  return (
    <div aria-hidden className="pointer-events-none absolute left-0 top-0 h-full w-full">
      <div
        className="absolute -right-40 -top-40 h-[34rem] w-[34rem] md:-right-24 md:-top-48 md:h-[48rem] md:w-[48rem]"
        style={{ background: 'radial-gradient(closest-side, rgba(204,255,0,0.11), rgba(204,255,0,0))' }}
      />
      <div
        className="absolute -right-[30%] -top-10 h-[34rem] w-[130%] md:-right-[8%] md:-top-24 md:h-[46rem] md:w-[72%]"
        style={{ maskImage: MASCARA_CANCHA, WebkitMaskImage: MASCARA_CANCHA }}
      >
        <LineasCancha className="h-full w-full text-lime-400 opacity-[0.07] [transform:perspective(1100px)_rotateX(55deg)_rotateZ(-28deg)]" />
      </div>
    </div>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function PildoraEnVivo({ enVivo }: { enVivo: EnVivoHome }) {
  return (
    <Reveal className="mb-6" y={16}>
      <Link
        to={enVivo.to}
        className="group inline-flex max-w-full items-center gap-2.5 rounded-full border border-red-500/50 bg-red-500/10 py-1.5 pl-3 pr-4 font-display text-xs font-bold uppercase tracking-wider text-white transition-colors duration-200 hover:border-red-400 hover:bg-red-500/20"
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
        </span>
        <span className="truncate">En vivo · {enVivo.nombre}</span>
        <ArrowRight aria-hidden size={14} className="shrink-0 transition-transform duration-300 group-hover:translate-x-0.5" />
      </Link>
    </Reveal>
  );
}

function Contenido({ r }: { r: ResumenTorneosHome }) {
  const dos = r.ultimaFecha !== null && r.top.length > 0;
  return (
    <>
      <FranjaStats stats={r.stats} />
      {(r.ultimaFecha || r.top.length > 0) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {r.ultimaFecha && (
            <Reveal className={dos ? 'lg:col-span-7' : 'lg:col-span-12'}>
              <TarjetaUltimaFecha fecha={r.ultimaFecha} />
            </Reveal>
          )}
          {r.top.length > 0 && (
            <Reveal className={dos ? 'lg:col-span-5' : 'lg:col-span-12'} delay={120}>
              <TarjetaRanking anio={r.anio} top={r.top} />
            </Reveal>
          )}
        </div>
      )}
    </>
  );
}

const ETIQUETA_STAT = 'font-display text-[10px] font-bold uppercase leading-snug tracking-[0.14em] text-white/50 sm:text-xs sm:tracking-[0.2em]';

function FranjaStats({ stats }: { stats: StatsHome }) {
  const items: { valor: number; etiqueta: string }[] = [
    { valor: stats.jugadores, etiqueta: 'Jugadores con puntos' },
    { valor: stats.categoriasJugadas, etiqueta: 'Categorías jugadas' },
    { valor: stats.fechas, etiqueta: 'Fechas' },
  ];
  return (
    <Reveal className="mb-8 md:mb-12" delay={80}>
      <dl className="grid grid-cols-3 border-y border-white/10">
        {items.map((it, i) => (
          // dt antes que dd (lo pide el HTML); flex-col-reverse lo muestra número arriba.
          <div key={it.etiqueta} className={`flex flex-col-reverse justify-end gap-2 py-4 md:py-8 ${i === 0 ? 'pr-3' : 'border-l border-white/10 px-3 sm:px-6 md:px-10'}`}>
            <dt className={ETIQUETA_STAT}>{it.etiqueta}</dt>
            <dd className="font-display text-4xl font-black leading-none tracking-tight text-white md:text-6xl">
              <Contador valor={it.valor} />
            </dd>
          </div>
        ))}
      </dl>
    </Reveal>
  );
}

const TARJETA = 'overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]';
const EYEBROW_TARJETA = 'font-display text-[11px] font-bold uppercase tracking-[0.2em] text-lime-400';
const TITULO_TARJETA = 'mt-1.5 font-display text-xl font-bold uppercase leading-tight text-white md:text-2xl';
// Las filas ocupan todo el ancho de una tarjeta con overflow-hidden: el anillo de foco
// global (sombra lime HACIA AFUERA) quedaba cortado a los costados. Acá va hacia adentro.
const FOCO_ADENTRO = 'focus-visible:shadow-[inset_0_0_0_2px_#ccff00]';

function TarjetaUltimaFecha({ fecha }: { fecha: UltimaFechaHome }) {
  const visibles = fecha.categorias.slice(0, FILAS_ESCRITORIO);
  // Lo que no entra se cuenta contra el TOTAL de categorías del evento (incluye las que
  // no tienen campeón para mostrar): "y 8 más" tiene que coincidir con lo que hay en /torneos.
  const restoCel = fecha.totalCategorias - Math.min(fecha.categorias.length, FILAS_CEL);
  const restoEscritorio = fecha.totalCategorias - visibles.length;
  return (
    // Sin h-full a propósito: con pocas categorías (una fecha de 3) estirarla hasta la
    // altura del ranking dejaba un hueco vacío adentro. La del ranking sí se estira.
    <article className={TARJETA}>
      <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-5 md:px-6 md:pt-6">
        <div className="min-w-0">
          <p className={EYEBROW_TARJETA}>Última fecha{fecha.fecha ? ` · ${fecha.fecha}` : ''}</p>
          <h3 className={TITULO_TARJETA}>{fecha.nombre}</h3>
        </div>
        {/* En celular no: le comía el ancho al título y el "y N más" de abajo ya lleva a /torneos. */}
        <Link
          to="/torneos"
          className="group mt-0.5 hidden shrink-0 items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider text-white/70 transition-colors duration-200 hover:text-lime-400 sm:inline-flex"
        >
          Ver resultados
          <ArrowRight aria-hidden size={14} className="transition-transform duration-300 group-hover:translate-x-0.5" />
        </Link>
      </header>
      <StaggerGrid>
        <ul>
          {visibles.map((c, i) => (
            <li key={c.id} className={i >= FILAS_CEL ? 'hidden lg:block' : undefined}>
              <StaggerItem className="border-t border-white/10">
                <FilaCampeon c={c} />
              </StaggerItem>
            </li>
          ))}
        </ul>
      </StaggerGrid>
      {restoCel > 0 && <MasCategorias cantidad={restoCel} className="flex lg:hidden" />}
      {restoEscritorio > 0 && <MasCategorias cantidad={restoEscritorio} className="hidden lg:flex" />}
    </article>
  );
}

function FilaCampeon({ c }: { c: CategoriaHome }) {
  return (
    <Link
      to={`/torneos/${c.id}`}
      className={`group flex items-center gap-3 px-5 py-3 transition-colors duration-200 hover:bg-white/[0.04] sm:gap-4 sm:py-3.5 md:px-6 ${FOCO_ADENTRO}`}
    >
      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
        <p className="font-display text-[11px] font-bold uppercase leading-none tracking-wider text-white/60 sm:w-44 sm:shrink-0 sm:text-xs sm:leading-normal">
          {c.nombreCorto}
        </p>
        <p className="mt-1.5 flex min-w-0 items-start gap-2 text-[15px] font-semibold leading-snug text-white sm:mt-0">
          <Trophy aria-hidden size={16} strokeWidth={2.25} className="mt-0.5 shrink-0 text-lime-400" />
          <span className="min-w-0">
            <span className="sr-only">Campeón: </span>
            {c.campeon}
          </span>
        </p>
      </div>
      {/* Con las tarjetas lado a lado (lg) no entra sin partir los nombres: vuelve en xl. */}
      <span className="hidden shrink-0 text-xs tabular-nums text-white/50 md:block lg:hidden xl:block">
        {c.cantidadParejas} {c.individual ? 'jugadores' : 'parejas'}
      </span>
      <ArrowRight
        aria-hidden
        size={16}
        className="shrink-0 text-white/30 transition duration-300 group-hover:text-lime-400 lg:-translate-x-1 lg:opacity-0 lg:group-hover:translate-x-0 lg:group-hover:opacity-100 lg:group-focus-visible:translate-x-0 lg:group-focus-visible:opacity-100"
      />
    </Link>
  );
}

function MasCategorias({ cantidad, className }: { cantidad: number; className: string }) {
  return (
    <Link
      to="/torneos"
      className={`group items-center justify-between border-t border-white/10 px-5 py-3.5 text-sm text-white/60 transition-colors duration-200 hover:bg-white/[0.04] hover:text-lime-400 md:px-6 ${FOCO_ADENTRO} ${className}`}
    >
      <span>
        y {cantidad} {cantidad === 1 ? 'categoría más' : 'categorías más'}
      </span>
      <ArrowRight aria-hidden size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
    </Link>
  );
}

function TarjetaRanking({ anio, top }: { anio: number; top: FilaTopHome[] }) {
  return (
    <article className={`flex h-full flex-col ${TARJETA}`}>
      <header className="px-5 pb-4 pt-5 md:px-6 md:pt-6">
        {/* A principio de año puede haber menos de 5 con puntos: no prometer un "Top 5". */}
        <p className={EYEBROW_TARJETA}>{top.length >= 5 ? 'Top 5 · Ranking VOLEA' : 'Ranking VOLEA'}</p>
        <h3 className={TITULO_TARJETA}>Ranking {anio}</h3>
      </header>
      {/* En escritorio las filas se estiran parejo hasta el botón (la tarjeta de al lado
          es más alta): sin esto quedaba un hueco suelto entre el 5º y el botón. */}
      <StaggerGrid className="flex-1 lg:flex lg:flex-col">
        <ol className="lg:flex lg:flex-1 lg:flex-col">
          {top.map((f) => {
            const lider = f.posicion === 1;
            return (
              <li key={f.jugadorId} className="lg:flex lg:flex-1">
                <StaggerItem
                  className={`flex items-center gap-4 border-t border-white/10 py-2.5 pr-5 sm:py-3 md:pr-6 lg:flex-1 ${
                    lider ? 'border-l-2 border-l-lime-400 bg-lime-400/10 pl-[18px] md:pl-[22px]' : 'pl-5 md:pl-6'
                  }`}
                >
                  <span
                    className={`w-7 shrink-0 font-display text-2xl font-black leading-none tabular-nums ${lider ? 'text-lime-400' : 'text-white/40'}`}
                  >
                    <span className="sr-only">Puesto </span>
                    {f.posicion}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-white">{f.nombre}</p>
                    <p className="hidden text-xs text-white/50 sm:block">
                      {f.torneosJugados} {f.torneosJugados === 1 ? 'torneo' : 'torneos'}
                    </p>
                  </div>
                  <p className="shrink-0 text-right">
                    <span className="font-display text-lg font-bold tabular-nums text-white">{f.puntos}</span>{' '}
                    <span className="text-xs text-white/50">pts</span>
                  </p>
                </StaggerItem>
              </li>
            );
          })}
        </ol>
      </StaggerGrid>
      <div className="px-5 pb-4 pt-3 sm:pb-5 sm:pt-4 md:px-6 md:pb-6">
        <Link
          to="/ranking"
          className="group flex w-full items-center justify-center gap-2 rounded-lg bg-lime-400 py-3 font-display text-sm font-bold uppercase tracking-wider text-navy-900 transition duration-200 hover:bg-lime-300 active:scale-[0.98]"
        >
          Ver ranking completo
          <ArrowRight aria-hidden size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
        </Link>
      </div>
    </article>
  );
}

// ─── Esqueleto ───────────────────────────────────────────────────────────────

// Misma grilla que el contenido real, para que al llegar los datos no salte nada.
const BLOQUE = 'rounded bg-white/[0.07] motion-safe:animate-pulse';

function Esqueleto() {
  return (
    <div role="status">
      <span className="sr-only">Cargando torneos…</span>
      <div aria-hidden className="mb-8 grid grid-cols-3 border-y border-white/10 md:mb-12">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`flex flex-col gap-2 py-4 md:py-8 ${i === 0 ? 'pr-3' : 'border-l border-white/10 px-3 sm:px-6 md:px-10'}`}>
            <div className={`h-9 w-14 md:h-[60px] md:w-24 ${BLOQUE}`} />
            {/* Hasta lg alguna etiqueta parte en dos renglones (y la fila toma esa altura) */}
            <div className="flex flex-col gap-1 py-0.5">
              <div className={`h-2.5 w-16 md:h-3 md:w-32 ${BLOQUE}`} />
              <div className={`h-2.5 w-12 md:h-3 md:w-20 lg:hidden ${BLOQUE}`} />
            </div>
          </div>
        ))}
      </div>
      <div aria-hidden className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className={`lg:col-span-7 ${TARJETA}`}>
          <div className="px-5 pb-4 pt-5 md:px-6 md:pt-6">
            <div className={`h-3 w-32 ${BLOQUE}`} />
            <div className={`mt-3 h-6 w-48 md:h-7 ${BLOQUE}`} />
          </div>
          {Array.from({ length: FILAS_ESCRITORIO }, (_, i) => (
            <div
              key={i}
              className={`items-center gap-4 border-t border-white/10 px-5 py-3 sm:py-3.5 md:px-6 ${i >= FILAS_CEL ? 'hidden lg:flex' : 'block sm:flex'}`}
            >
              <div className={`h-2.5 w-24 sm:h-3 sm:w-40 ${BLOQUE}`} />
              <div className={`mt-2.5 h-[18px] w-56 max-w-full sm:mt-0 sm:h-5 ${BLOQUE}`} />
            </div>
          ))}
          <div className="flex h-[49px] items-center border-t border-white/10 px-5 md:px-6">
            <div className={`h-3.5 w-36 ${BLOQUE}`} />
          </div>
        </div>
        <div className={`lg:col-span-5 ${TARJETA}`}>
          <div className="px-5 pb-4 pt-5 md:px-6 md:pt-6">
            <div className={`h-3 w-36 ${BLOQUE}`} />
            <div className={`mt-3 h-6 w-40 md:h-7 ${BLOQUE}`} />
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 border-t border-white/10 px-5 py-2.5 sm:py-3 md:px-6">
              <div className={`h-7 w-6 ${BLOQUE}`} />
              <div className="flex-1">
                <div className={`my-1 h-4 w-40 max-w-full ${BLOQUE}`} />
                <div className={`mt-1 hidden h-3 w-16 sm:block ${BLOQUE}`} />
              </div>
              <div className={`h-5 w-14 ${BLOQUE}`} />
            </div>
          ))}
          <div className="px-5 pb-4 pt-3 sm:pb-5 sm:pt-4 md:px-6 md:pb-6">
            <div className={`h-12 w-full rounded-lg ${BLOQUE}`} />
          </div>
        </div>
      </div>
    </div>
  );
}
