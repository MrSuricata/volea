import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, ChevronLeft, ChevronRight, CloudOff, ExternalLink, LayoutGrid, List,
  Loader2, Medal, RotateCcw, RotateCw, SkipForward, Square, Trophy, Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PropsPaso } from '../../TorneosApp';
import type { PartidoLlave, Torneo } from '../../engine/tipos';
import { nombreDe } from '../util';
import { useDialogos } from '../dialogos';
import { Boton } from '../../../admin/ui';
import { cn } from '../../../lib/cn';
import {
  armarModelo, borradosSiMarco, cruceInicial, describirLugar, marcar, proximoListo,
  type Cruce, type ModeloOpc, type Ronda,
} from './modelo';
import { guardarLugar, leerLugar, type Vista } from './memoria';
import { useContextoOpc, type EstadoSyncOpc, type InfoSync } from './contexto';
import { avanceDe } from '../listaGestor';
import './opc.css';

// Pantalla de control del One Point Challenge, pensada para manejarla parado al lado de la
// cancha con el celular o la tablet: un cruce se carga con UN toque sobre el nombre del que
// ganó el punto (se guarda 1-0). Tres vistas: cruce por cruce (grande), por ronda y el cuadro.

const PAUSA_AVANCE_MS = 700; // después de marcar: se ve el ganador y recién ahí pasa al próximo

type Lado = 'a' | 'b';

export default function ControlOpc({ torneo, actualizar }: PropsPaso) {
  const dialogos = useDialogos();
  const ctx = useContextoOpc();
  const partidos = torneo.partidosLlave as PartidoLlave[];
  const modelo = useMemo(() => armarModelo(partidos), [partidos]);
  const partidosRef = useRef(partidos);
  partidosRef.current = partidos;
  const nombre = (id: string) => nombreDe(torneo, id);

  const lugar = useMemo(() => leerLugar(torneo.id), [torneo.id]);
  const [vista, setVista] = useState<Vista>(lugar.vista ?? 'cruce');
  const [cruceId, setCruceId] = useState<string | null>(() => cruceInicial(modelo, lugar.cruceId)?.partido.id ?? null);
  const [ronda, setRonda] = useState<number>(() => (lugar.ronda && modelo.rondas.some((r) => r.ronda === lugar.ronda) ? lugar.ronda : modelo.rondaActual));
  // Después de un toque, un rato sin aceptar otro: el doble toque no marca el cruce siguiente.
  const [pausa, setPausa] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  useEffect(() => { guardarLugar(torneo.id, { vista, cruceId, ronda }); }, [torneo.id, vista, cruceId, ronda]);

  const cruce = modelo.cruces.find((c) => c.partido.id === cruceId) ?? cruceInicial(modelo, null);

  // Al abrir, la herramienta queda arriba de todo (debajo de la barra del panel).
  const raiz = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const barra = window.matchMedia?.('(min-width: 1024px)').matches ? 0 : 56;
    const destino = el.getBoundingClientRect().top + window.scrollY - barra - 8;
    if (destino > window.scrollY) window.scrollTo({ top: destino });
  }, []);

  // Con el estado del sync a la vista en la barra de arriba, la píldora flotante del gestor sobra
  // (y tapaba los botones de abajo): se esconde mientras esta pantalla está abierta.
  useEffect(() => {
    if (!ctx?.sync) return;
    document.body.classList.add('opc-control-abierto');
    return () => document.body.classList.remove('opc-control-abierto');
  }, [ctx?.sync]);

  function aplicar(partidoId: string, lado: Lado | null) {
    const ahora = new Date().toISOString();
    actualizar((t) => ({ ...t, partidosLlave: t.partidosLlave ? marcar(t.partidosLlave, partidoId, lado, ahora) : t.partidosLlave }));
  }

  async function confirmarCascada(partidoId: string, lado: Lado | null, titulo: string, mensaje: string, textoConfirmar: string): Promise<boolean> {
    const borrados = borradosSiMarco(partidosRef.current, partidoId, lado);
    const extra = borrados > 0
      ? ` Eso cambia quién avanzó y BORRA ${borrados} resultado${borrados > 1 ? 's' : ''} de cruces posteriores (hay que volver a jugarlos).`
      : '';
    return dialogos.confirmar({ titulo, mensaje: mensaje + extra, textoConfirmar, peligro: borrados > 0 });
  }

  async function deshacer(partidoId: string) {
    const actual = armarModelo(partidosRef.current).cruces.find((c) => c.partido.id === partidoId);
    if (!actual || actual.estado !== 'jugado') return;
    if (borradosSiMarco(partidosRef.current, partidoId, null) > 0) {
      const ok = await confirmarCascada(partidoId, null, 'Deshacer resultado', `¿Borrar el resultado de ${nombre(actual.idA!)} vs ${nombre(actual.idB!)}?`, 'Borrar');
      if (!ok) return;
    }
    aplicar(partidoId, null);
    setCruceId(partidoId);
    setRonda(actual.ronda);
  }

  /** El toque sobre un nombre. `avanzar`: en la vista cruce por cruce, pasar solo al próximo. */
  async function tocar(c: Cruce, lado: Lado, avanzar: boolean) {
    if (pausa || torneo.fase === 'terminado') return;
    const id = lado === 'a' ? c.idA : c.idB;
    if (!id || c.estado === 'esperando') return;
    if (c.estado === 'jugado') {
      if (c.ganador === id) return; // ya es el ganador: nada que hacer
      const otro = lado === 'a' ? c.idB! : c.idA!;
      const ok = await confirmarCascada(c.partido.id, lado, 'Cambiar ganador', `Estaba cargado que ganó ${nombre(otro)}. ¿Cambiarlo a ${nombre(id)}?`, 'Cambiar ganador');
      if (!ok) return;
      aplicar(c.partido.id, lado);
      toast(`Corregido: ganó ${nombre(id)}`, { id: 'opc-marca', duration: 4000 });
      return;
    }
    const ahora = new Date().toISOString();
    const despues = armarModelo(marcar(partidosRef.current, c.partido.id, lado, ahora));
    aplicar(c.partido.id, lado);
    // id fijo: cada toque reemplaza el aviso anterior (no se apilan tapando la barra de arriba)
    toast(`Ganó ${nombre(id)}`, {
      id: 'opc-marca',
      duration: 5000,
      action: { label: 'Deshacer', onClick: () => void deshacer(c.partido.id) },
    });
    setPausa(c.partido.id);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setPausa(null);
      if (avanzar) {
        const prox = proximoListo(despues, c.partido.id);
        if (prox) { setCruceId(prox.partido.id); setRonda(prox.ronda); } else {
          const final = despues.cruces[despues.cruces.length - 1];
          if (final) setCruceId(final.partido.id);
        }
      }
    }, PAUSA_AVANCE_MS);
  }

  async function rearmar() {
    const ok = await dialogos.confirmar({
      titulo: 'Rearmar llave',
      mensaje: modelo.jugados > 0
        ? `La llave tiene ${modelo.jugados} resultado${modelo.jugados > 1 ? 's' : ''} cargado${modelo.jugados > 1 ? 's' : ''}: rearmarla los borra todos. ¿Seguir?`
        : '¿Rearmar la llave? Volvés a ordenar o sortear a los jugadores.',
      textoConfirmar: 'Rearmar',
      peligro: modelo.jugados > 0,
    });
    if (!ok) return;
    guardarLugar(torneo.id, {});
    actualizar((t) => ({ ...t, configLlave: null, partidosLlave: null, fase: 'llave' }));
  }

  async function aJugadores() {
    const ok = await dialogos.confirmar({
      titulo: 'Volver a Jugadores',
      mensaje: modelo.jugados > 0 ? 'Descarta la llave armada y sus resultados. ¿Seguir?' : 'Descarta la llave armada. ¿Seguir?',
      textoConfirmar: 'Volver',
      peligro: true,
    });
    if (!ok) return;
    guardarLugar(torneo.id, {});
    actualizar((t) => ({ ...t, configLlave: null, partidosLlave: null, fase: 'parejas' }));
  }

  function irACruce(c: Cruce) {
    setCruceId(c.partido.id);
    setRonda(c.ronda);
    setVista('cruce');
  }

  const terminado = torneo.fase === 'terminado';
  const hayCampeon = modelo.campeon !== null;

  return (
    <div ref={raiz} className="opc space-y-4">
      <BarraEstado
        torneo={torneo}
        modelo={modelo}
        vista={vista}
        setVista={setVista}
        otros={ctx ? ctx.torneos : []}
        irATorneo={ctx?.irATorneo}
        sync={ctx?.sync}
      />

      {hayCampeon && (
        <Podio
          campeon={nombre(modelo.campeon!)}
          subcampeon={modelo.subcampeon ? nombre(modelo.subcampeon) : null}
          terminado={terminado}
          compacto={vista !== 'cruce'}
          onTerminar={() => actualizar((t) => ({ ...t, fase: 'terminado' }))}
          onReabrir={() => actualizar((t) => ({ ...t, fase: 'llave' }))}
        />
      )}

      {vista === 'cruce' && cruce && (
        <VistaCruce
          torneo={torneo}
          modelo={modelo}
          cruce={cruce}
          pausa={pausa === cruce.partido.id}
          bloqueado={pausa !== null || terminado}
          onTocar={(lado) => void tocar(cruce, lado, true)}
          onDeshacer={() => void deshacer(cruce.partido.id)}
          onIr={(c) => { setCruceId(c.partido.id); setRonda(c.ronda); }}
        />
      )}
      {vista === 'ronda' && (
        <VistaRonda
          torneo={torneo}
          modelo={modelo}
          ronda={ronda}
          setRonda={setRonda}
          bloqueado={pausa !== null || terminado}
          onTocar={(c, lado) => void tocar(c, lado, false)}
          onAbrir={irACruce}
        />
      )}
      {vista === 'cuadro' && <VistaCuadro torneo={torneo} modelo={modelo} actual={cruce?.partido.id ?? null} onAbrir={irACruce} />}

      <footer className="mt-8 flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Boton variante="secundario" icono={<ArrowLeft size={18} />} onClick={() => void aJugadores()}>Jugadores</Boton>
          <a
            href={`/torneos/${torneo.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-5 font-display text-sm font-bold text-navy-700 hover:border-navy-700"
          >
            <ExternalLink size={18} aria-hidden /> Ver en la web
          </a>
        </div>
        <Boton variante="secundario" icono={<RotateCcw size={18} />} onClick={() => void rearmar()} className="text-red-700 hover:border-red-700">
          Rearmar llave
        </Boton>
      </footer>
      {/* aire abajo: la barra de accesos del panel en el celular no tapa el último botón */}
      <div aria-hidden className="h-6" />
    </div>
  );
}

/** Desliza un carril horizontal hasta que `el` quede a la vista (con un poco de aire a la izquierda). */
function correrHasta(carril: HTMLElement | null | undefined, el: HTMLElement | null | undefined) {
  if (!carril || !el) return;
  const c = carril.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  if (e.left >= c.left && e.right <= c.right) return; // ya se ve entero
  carril.scrollLeft += e.left - c.left - 24;
}

// ─── Barra de arriba (fija): llave, avance, guardado y vista ─────────────────

const SYNC: Record<EstadoSyncOpc, { texto: string; clase: string; icono: ReactNode }> = {
  sincronizado: { texto: 'Guardado', clase: 'bg-emerald-700 text-white', icono: <CheckCircle2 size={16} aria-hidden /> },
  pendiente: { texto: 'Guardando…', clase: 'bg-navy-700 text-white', icono: <Loader2 size={16} className="animate-spin" aria-hidden /> },
  sinConexion: { texto: 'Sin señal · queda en este equipo', clase: 'bg-red-700 text-white', icono: <CloudOff size={16} aria-hidden /> },
  conflicto: { texto: 'Sin subir · elegí versión arriba', clase: 'bg-amber-400 text-navy-900', icono: <AlertTriangle size={16} aria-hidden /> },
};

function EstadoGuardado({ sync }: { sync: InfoSync }) {
  const s = SYNC[sync.estado];
  return (
    <>
      <span className="sr-only" aria-live="polite">{s.texto}</span>
      <button
        type="button"
        onClick={sync.refrescar}
        disabled={!sync.refrescar || sync.refrescando}
        title="Tocá para traer lo último del server"
        aria-label={`${s.texto}. Refrescar desde el server`}
        data-sync={sync.estado}
        className={cn('inline-flex h-9 max-w-full shrink-0 items-center gap-1.5 rounded-full px-3 font-display text-[12px] font-bold', s.clase)}
      >
        {s.icono}
        <span className="truncate">{s.texto}</span>
        {sync.refrescar && <RotateCw size={13} aria-hidden className={cn('ml-0.5 opacity-70', sync.refrescando && 'animate-spin')} />}
      </button>
    </>
  );
}

function BarraEstado({ torneo, modelo, vista, setVista, otros, irATorneo, sync }: {
  torneo: Torneo;
  modelo: ModeloOpc;
  vista: Vista;
  setVista: (v: Vista) => void;
  otros: Torneo[];
  irATorneo?: (id: string) => void;
  sync?: InfoSync;
}) {
  // Otras llaves del OPC en juego (p. ej. masculino y femenino): se salta sin volver a la lista.
  const llaves = otros
    .filter((t) => (t.formato ?? 'grupos') === 'individual' && (t.fase !== 'terminado' || t.id === torneo.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const faltan = modelo.total - modelo.jugados;
  const rondaActual = modelo.rondas.find((r) => r.ronda === modelo.rondaActual);
  const selector = useRef<HTMLDivElement>(null);
  useEffect(() => {
    correrHasta(selector.current, selector.current?.querySelector<HTMLElement>('[aria-current="true"]'));
  }, [torneo.id]);

  return (
    <div className="opc-barra sticky top-14 z-10 -mx-4 space-y-2 border-b border-gray-200 bg-gray-50/95 px-4 pb-2 pt-2 backdrop-blur lg:top-0 md:mx-0 md:rounded-b-xl md:px-3">
      {irATorneo && llaves.length > 1 && (
        <div ref={selector} role="navigation" aria-label="Cambiar de llave" className="sin-barra -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          {llaves.map((t) => {
            const actual = t.id === torneo.id;
            const av = avanceDe(t);
            return (
              <button
                key={t.id}
                type="button"
                aria-current={actual ? 'true' : undefined}
                onClick={() => { if (!actual) irATorneo(t.id); }}
                className={cn(
                  'flex h-12 max-w-[15rem] shrink-0 items-center gap-2 rounded-xl border-2 px-3 text-left font-display text-sm font-bold',
                  actual ? 'border-navy-700 bg-navy-700 text-white' : 'border-gray-300 bg-white text-navy-700',
                )}
              >
                <span className="truncate" title={t.nombre}>{t.nombre}</span>
                <span className={cn('shrink-0 rounded-md px-1.5 text-[11px] tabular-nums', actual ? 'bg-white/15' : 'bg-gray-100 text-gray-600')}>
                  {t.partidosLlave ? `${av.jugados}/${av.total}` : 'sin llave'}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="min-w-0 flex-1 font-display text-[15px] font-bold leading-tight text-navy-700">
          {faltan === 0
            ? 'Llave completa'
            : <>{rondaActual?.nombre ?? `Ronda ${modelo.rondaActual}`} <span className="font-semibold text-gray-500">· faltan {faltan} {faltan === 1 ? 'cruce' : 'cruces'}</span></>}
        </p>
        {sync && <EstadoGuardado sync={sync} />}
      </div>
      <div role="radiogroup" aria-label="Cómo ver la llave" className="grid grid-cols-3 gap-1 rounded-xl bg-gray-200/70 p-1">
        {([
          ['cruce', 'Cruce', <Square key="i" size={16} aria-hidden />],
          ['ronda', 'Ronda', <List key="i" size={16} aria-hidden />],
          ['cuadro', 'Cuadro', <LayoutGrid key="i" size={16} aria-hidden />],
        ] as const).map(([v, texto, icono]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={vista === v}
            onClick={() => setVista(v)}
            className={cn(
              'inline-flex h-11 items-center justify-center gap-1.5 rounded-lg font-display text-sm font-bold transition-colors',
              vista === v ? 'bg-navy-700 text-white shadow-sm' : 'text-gray-600',
            )}
          >
            {icono}{texto}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Botón de jugador: el toque que carga el cruce ───────────────────────────

function BotonJugador({ nombre, rol, onClick, disabled, grande = false, etiqueta }: {
  nombre: string;
  rol: 'ganador' | 'perdedor' | 'listo' | 'esperando';
  onClick?: () => void;
  disabled?: boolean;
  grande?: boolean;
  etiqueta: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || rol === 'esperando'}
      aria-label={etiqueta}
      aria-pressed={rol === 'ganador' ? true : rol === 'perdedor' ? false : undefined}
      className={cn(
        'opc-toque flex w-full items-center gap-3 rounded-xl border-2 px-4 text-left font-display font-bold leading-tight transition-[background-color,transform] active:scale-[0.98] disabled:active:scale-100',
        grande ? 'min-h-[88px] py-3 text-[22px] md:min-h-[104px] md:text-[28px]' : 'min-h-[60px] py-2 text-[17px]',
        rol === 'listo' && 'border-navy-700 bg-white text-navy-900',
        rol === 'ganador' && 'border-navy-900 bg-lime-400 text-navy-900',
        rol === 'perdedor' && 'border-gray-200 bg-gray-100 text-gray-500',
        rol === 'esperando' && 'border-dashed border-gray-300 bg-white text-gray-400',
      )}
    >
      <span className="opc-nombre min-w-0 flex-1">{nombre}</span>
      {rol === 'ganador' && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-navy-900 px-2.5 py-1 text-[12px] font-black uppercase tracking-wide text-lime-400">
          <Check size={14} strokeWidth={3.5} aria-hidden /> Ganó
        </span>
      )}
    </button>
  );
}

function rolDe(c: Cruce, id: string | null): 'ganador' | 'perdedor' | 'listo' | 'esperando' {
  if (id === null) return 'esperando';
  if (c.estado === 'jugado') return c.ganador === id ? 'ganador' : 'perdedor';
  return c.estado === 'listo' ? 'listo' : 'esperando';
}

// ─── Vista cruce por cruce ───────────────────────────────────────────────────

function VistaCruce({ torneo, modelo, cruce, pausa, bloqueado, onTocar, onDeshacer, onIr }: {
  torneo: Torneo;
  modelo: ModeloOpc;
  cruce: Cruce;
  pausa: boolean;
  bloqueado: boolean;
  onTocar: (lado: Lado) => void;
  onDeshacer: () => void;
  onIr: (c: Cruce) => void;
}) {
  const ronda = modelo.rondas.find((r) => r.ronda === cruce.ronda)!;
  const i = cruce.orden - 1;
  const anterior = modelo.cruces[i - 1];
  const siguiente = modelo.cruces[i + 1];
  const proximo = proximoListo(modelo, cruce.partido.id, [cruce.partido.id]);
  const nombre = (id: string | null, slot: PartidoLlave['a']) => (id ? nombreDe(torneo, id) : describirLugar(modelo, slot));

  const estadoTexto = cruce.estado === 'jugado'
    ? (pausa ? '¡Listo!' : 'Jugado')
    : cruce.estado === 'listo' ? 'Para jugar' : 'Esperando rivales';

  return (
    <section aria-label="Cruce" className="space-y-3">
      <div className="rounded-2xl bg-navy-700 p-4 text-white md:p-6">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-[13px] font-bold uppercase tracking-[0.15em] text-white/70">{ronda.nombre}</p>
            <p className="font-display text-xl font-black leading-tight md:text-2xl">Cruce {cruce.numero} de {cruce.deRonda}</p>
          </div>
          <span className={cn(
            'mt-1 shrink-0 rounded-full px-3 py-1 font-display text-[12px] font-bold',
            cruce.estado === 'jugado' ? 'bg-lime-400 text-navy-900' : cruce.estado === 'listo' ? 'bg-white text-navy-700' : 'bg-white/15 text-white/80',
          )}
          >
            {estadoTexto}
          </span>
        </div>
        <div className="space-y-2" key={cruce.partido.id}>
          <BotonJugador
            grande
            nombre={nombre(cruce.idA, cruce.partido.a)}
            rol={rolDe(cruce, cruce.idA)}
            disabled={bloqueado}
            onClick={() => onTocar('a')}
            etiqueta={cruce.idA ? `Ganó ${nombreDe(torneo, cruce.idA)}` : 'Todavía no se sabe'}
          />
          <p aria-hidden className="text-center font-display text-sm font-black uppercase tracking-[0.3em] text-white/60">vs</p>
          <BotonJugador
            grande
            nombre={nombre(cruce.idB, cruce.partido.b)}
            rol={rolDe(cruce, cruce.idB)}
            disabled={bloqueado}
            onClick={() => onTocar('b')}
            etiqueta={cruce.idB ? `Ganó ${nombreDe(torneo, cruce.idB)}` : 'Todavía no se sabe'}
          />
        </div>
        <div className="mt-3 flex min-h-[44px] flex-wrap items-center justify-between gap-2 text-[14px] text-white/80">
          {cruce.estado === 'listo' && <p>Tocá el nombre del que ganó el punto.</p>}
          {cruce.estado === 'esperando' && <p>Se juega cuando se definan los cruces anteriores.</p>}
          {cruce.estado === 'jugado' && (
            <>
              <p className="min-w-0 flex-1">Para corregir, tocá el otro nombre.</p>
              <button
                type="button"
                onClick={onDeshacer}
                disabled={bloqueado}
                className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-white/30 px-3 font-display text-[13px] font-bold text-white"
              >
                <Undo2 size={16} aria-hidden /> Borrar resultado
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!anterior}
          onClick={() => anterior && onIr(anterior)}
          className="opc-toque flex h-14 items-center justify-center gap-1 rounded-xl border-2 border-gray-300 bg-white font-display text-[15px] font-bold text-navy-700 disabled:opacity-40"
        >
          <ChevronLeft size={20} aria-hidden /> Anterior
        </button>
        <button
          type="button"
          disabled={!siguiente}
          onClick={() => siguiente && onIr(siguiente)}
          className="opc-toque flex h-14 items-center justify-center gap-1 rounded-xl border-2 border-gray-300 bg-white font-display text-[15px] font-bold text-navy-700 disabled:opacity-40"
        >
          Siguiente <ChevronRight size={20} aria-hidden />
        </button>
      </div>

      {proximo ? (
        <button
          type="button"
          onClick={() => onIr(proximo)}
          className="opc-toque flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left"
        >
          <span className="shrink-0 font-display text-[12px] font-bold uppercase tracking-wider text-gray-500">{cruce.estado === 'listo' ? 'Sigue' : 'Para jugar'}</span>
          <span className="opc-nombre min-w-0 flex-1 font-display text-[16px] font-bold text-navy-700">
            {nombreDe(torneo, proximo.idA!)} <span className="font-semibold text-gray-400">vs</span> {nombreDe(torneo, proximo.idB!)}
          </span>
          <ChevronRight size={20} className="shrink-0 text-gray-400" aria-hidden />
        </button>
      ) : modelo.jugados < modelo.total && (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-3 text-[14px] text-gray-500">No hay otro cruce listo para jugar todavía.</p>
      )}

      <PasaDirecto torneo={torneo} modelo={modelo} ronda={ronda} />
    </section>
  );
}

function PasaDirecto({ torneo, modelo, ronda }: { torneo: Torneo; modelo: ModeloOpc; ronda: Ronda }) {
  if (!ronda.pasaDirecto) return null;
  const sig = modelo.rondas.find((r) => r.ronda === ronda.ronda + 1);
  const quien = ronda.pasaDirecto.id ? nombreDe(torneo, ronda.pasaDirecto.id) : describirLugar(modelo, ronda.pasaDirecto.slot);
  return (
    <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sky-900">
      <SkipForward size={20} className="mt-0.5 shrink-0" aria-hidden />
      <p className="min-w-0 text-[15px] leading-snug">
        <strong className="opc-nombre font-display font-bold">{quien}</strong> no juega la {ronda.nombre.toLowerCase()}: pasa directo {sig ? `a la ${sig.nombre.toLowerCase()}` : 'a la ronda siguiente'} (son impares).
      </p>
    </div>
  );
}

// ─── Vista por ronda ─────────────────────────────────────────────────────────

function VistaRonda({ torneo, modelo, ronda, setRonda, bloqueado, onTocar, onAbrir }: {
  torneo: Torneo;
  modelo: ModeloOpc;
  ronda: number;
  setRonda: (r: number) => void;
  bloqueado: boolean;
  onTocar: (c: Cruce, lado: Lado) => void;
  onAbrir: (c: Cruce) => void;
}) {
  const r = modelo.rondas.find((x) => x.ronda === ronda) ?? modelo.rondas[0];
  const pestanas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    correrHasta(pestanas.current, pestanas.current?.querySelector<HTMLElement>('[aria-checked="true"]'));
  }, [ronda]);
  if (!r) return null;
  return (
    <section aria-label="Ronda" className="space-y-3">
      <div ref={pestanas} role="radiogroup" aria-label="Ronda" className="sin-barra -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {modelo.rondas.map((x) => {
          const elegida = x.ronda === r.ronda;
          const completa = x.jugados === x.cruces.length;
          return (
            <button
              key={x.ronda}
              type="button"
              role="radio"
              aria-checked={elegida}
              onClick={() => setRonda(x.ronda)}
              className={cn(
                'flex h-14 shrink-0 flex-col items-center justify-center rounded-xl border-2 px-4 font-display leading-tight',
                elegida ? 'border-navy-700 bg-navy-700 text-white' : 'border-gray-300 bg-white text-navy-700',
              )}
            >
              <span className="text-[14px] font-bold">{x.nombre}</span>
              <span className={cn('text-[12px] font-semibold tabular-nums', elegida ? 'text-white/75' : completa ? 'text-emerald-700' : 'text-gray-500')}>
                {completa ? '✓ ' : ''}{x.jugados}/{x.cruces.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-lg font-black uppercase text-navy-700">{r.nombre}</h3>
        <p className="font-display text-[14px] font-bold tabular-nums text-gray-600">{r.jugados}/{r.cruces.length} jugados · {r.vivos} jugadores</p>
      </div>

      <ol className="grid gap-3 md:grid-cols-2">
        {r.cruces.map((c) => (
          <li key={c.partido.id} className={cn('rounded-xl border bg-white p-2', c.estado === 'listo' ? 'border-navy-700' : 'border-gray-200')}>
            <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
              <span className="font-display text-[13px] font-bold uppercase tracking-wide text-gray-500">Cruce {c.numero}</span>
              <button type="button" onClick={() => onAbrir(c)} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 font-display text-[13px] font-bold text-navy-700">
                Ver grande <ChevronRight size={16} aria-hidden />
              </button>
            </div>
            <div className="grid gap-1.5">
              {(['a', 'b'] as const).map((lado) => {
                const id = lado === 'a' ? c.idA : c.idB;
                const slot = lado === 'a' ? c.partido.a : c.partido.b;
                return (
                  <BotonJugador
                    key={lado}
                    nombre={id ? nombreDe(torneo, id) : describirLugar(modelo, slot)}
                    rol={rolDe(c, id)}
                    disabled={bloqueado}
                    onClick={() => onTocar(c, lado)}
                    etiqueta={id ? `Ganó ${nombreDe(torneo, id)} (cruce ${c.numero})` : 'Todavía no se sabe'}
                  />
                );
              })}
            </div>
          </li>
        ))}
      </ol>
      <PasaDirecto torneo={torneo} modelo={modelo} ronda={r} />
    </section>
  );
}

// ─── Cuadro completo ─────────────────────────────────────────────────────────

function VistaCuadro({ torneo, modelo, actual, onAbrir }: {
  torneo: Torneo;
  modelo: ModeloOpc;
  actual: string | null;
  onAbrir: (c: Cruce) => void;
}) {
  const carril = useRef<HTMLDivElement>(null);
  useEffect(() => {
    correrHasta(carril.current, carril.current?.querySelector<HTMLElement>(`[data-ronda="${modelo.rondaActual}"]`));
    // solo al abrir el cuadro
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section aria-label="Cuadro completo">
      <p className="mb-2 text-[13px] text-gray-500">Deslizá de costado para ver todas las rondas. Tocá un cruce para abrirlo en grande.</p>
      <div ref={carril} className="opc-carril sin-barra -mx-4 flex gap-3 overflow-x-auto px-4 pb-3 md:mx-0 md:px-0">
        {modelo.rondas.map((r) => (
          <div key={r.ronda} data-ronda={r.ronda} className="opc-columna flex w-[76vw] max-w-[300px] shrink-0 flex-col gap-2 md:w-[250px]">
            <div className={cn('sticky top-0 rounded-lg px-3 py-2 font-display', r.ronda === modelo.rondaActual ? 'bg-navy-700 text-white' : 'bg-gray-200/70 text-navy-700')}>
              <p className="text-[14px] font-black uppercase">{r.nombre}</p>
              <p className="text-[12px] font-semibold tabular-nums opacity-80">{r.jugados}/{r.cruces.length} jugados · {r.vivos} jugadores</p>
            </div>
            <div className="flex flex-1 flex-col justify-around gap-2">
              {r.cruces.map((c) => (
                <button
                  key={c.partido.id}
                  type="button"
                  onClick={() => onAbrir(c)}
                  aria-label={`Abrir cruce ${c.numero} de ${r.nombre}`}
                  className={cn(
                    'opc-toque w-full rounded-xl border-2 bg-white text-left',
                    c.partido.id === actual ? 'border-lime-500 ring-2 ring-lime-400' : c.estado === 'listo' ? 'border-navy-700' : 'border-gray-200',
                  )}
                >
                  {(['a', 'b'] as const).map((lado, k) => {
                    const id = lado === 'a' ? c.idA : c.idB;
                    const slot = lado === 'a' ? c.partido.a : c.partido.b;
                    const gana = c.estado === 'jugado' && c.ganador === id;
                    const pierde = c.estado === 'jugado' && c.ganador !== id;
                    return (
                      <span
                        key={lado}
                        className={cn(
                          'flex min-h-[40px] items-center gap-2 px-3 py-1.5 text-[14px] leading-tight',
                          k === 0 && 'border-b border-gray-100',
                          gana && 'bg-lime-400 font-bold text-navy-900',
                          pierde && 'text-gray-400 line-through',
                          !id && 'italic text-gray-400',
                          id && !gana && !pierde && 'font-semibold text-navy-700',
                        )}
                      >
                        <span className="opc-nombre line-clamp-2 min-w-0 flex-1" title={id ? nombreDe(torneo, id) : undefined}>
                          {id ? nombreDe(torneo, id) : describirLugar(modelo, slot)}
                        </span>
                        {gana && <Check size={16} strokeWidth={3} aria-hidden className="shrink-0" />}
                      </span>
                    );
                  })}
                </button>
              ))}
              {r.pasaDirecto && (
                <div className="flex items-center gap-2 rounded-xl border-2 border-dashed border-sky-300 bg-sky-50 px-3 py-2 text-[13px] text-sky-900">
                  <SkipForward size={16} className="shrink-0" aria-hidden />
                  <span className="opc-nombre min-w-0">
                    <strong className="font-bold">{r.pasaDirecto.id ? nombreDe(torneo, r.pasaDirecto.id) : describirLugar(modelo, r.pasaDirecto.slot)}</strong> pasa directo
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
        {modelo.campeon && (
          <div className="flex w-[60vw] max-w-[220px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl bg-navy-700 p-4 text-center text-white md:w-[200px]">
            <Trophy size={32} className="text-lime-400" aria-hidden />
            <p className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-white/70">Campeón</p>
            <p className="opc-nombre font-display text-lg font-black uppercase leading-tight">{nombreDe(torneo, modelo.campeon)}</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Podio ───────────────────────────────────────────────────────────────────

function Podio({ campeon, subcampeon, terminado, compacto, onTerminar, onReabrir }: {
  campeon: string;
  subcampeon: string | null;
  terminado: boolean;
  /** En las vistas ronda y cuadro: una franja, para que la llave quede a la vista. */
  compacto: boolean;
  onTerminar: () => void;
  onReabrir: () => void;
}) {
  if (compacto) {
    return (
      <section aria-label="Podio" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-navy-700 px-4 py-3 text-white">
        <Trophy size={28} className="shrink-0 text-lime-400" aria-hidden />
        <p className="min-w-[12rem] flex-1 leading-tight">
          <span className="block font-display text-[11px] font-bold uppercase tracking-[0.2em] text-lime-400">Campeón</span>
          <strong className="opc-nombre font-display text-lg font-black uppercase">{campeon}</strong>
          {subcampeon && <span className="block text-[13px] text-white/75">Subcampeón: <span className="opc-nombre font-semibold text-white">{subcampeon}</span></span>}
        </p>
        {terminado
          ? <button type="button" onClick={onReabrir} className="h-11 shrink-0 rounded-lg px-2 font-display text-[13px] font-bold text-white/80 underline-offset-4 hover:underline">Reabrir</button>
          : <Boton variante="acento" onClick={onTerminar} className="w-full shrink-0 sm:w-auto">Dar por terminado</Boton>}
      </section>
    );
  }
  return (
    <section aria-label="Podio" className="opc-podio relative overflow-hidden rounded-2xl bg-navy-700 px-5 py-7 text-center text-white">
      <span aria-hidden className="opc-destello" />
      <Trophy size={48} className="relative mx-auto text-lime-400" aria-hidden />
      <p className="relative mt-2 font-display text-[12px] font-bold uppercase tracking-[0.3em] text-lime-400">Campeón</p>
      <h2 className="opc-nombre relative mt-1 font-display text-3xl font-black uppercase leading-tight md:text-4xl">{campeon}</h2>
      {subcampeon && (
        <p className="relative mt-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-[15px] text-white/90">
          <Medal size={18} aria-hidden className="text-gray-300" />
          <span><span className="text-white/60">Subcampeón:</span> <strong className="opc-nombre font-bold">{subcampeon}</strong></span>
        </p>
      )}
      <div className="relative mt-5">
        {terminado ? (
          <div className="flex flex-col items-center gap-2">
            <p className="inline-flex items-center gap-1.5 font-display text-sm font-bold text-lime-400"><CheckCircle2 size={18} aria-hidden /> Torneo terminado</p>
            <button type="button" onClick={onReabrir} className="h-11 rounded-lg px-4 font-display text-[13px] font-bold text-white/80 underline-offset-4 hover:underline">
              Reabrir para corregir
            </button>
          </div>
        ) : (
          <Boton variante="acento" onClick={onTerminar} className="h-14 px-6 text-base">
            Dar por terminado el torneo
          </Boton>
        )}
      </div>
    </section>
  );
}
