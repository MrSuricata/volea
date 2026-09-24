import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  ArrowLeft, Check, ChevronDown, Download, EyeOff, FileUp, Plus, SlidersHorizontal, Trash2, Trophy, Users,
} from 'lucide-react';
import type { ConfigPuntos as TConfigPuntos, Jugador, Torneo } from './engine/tipos';
import { CONFIG_PUNTOS_DEFAULT, nuevoId } from './engine/tipos';
import { DialogosProvider, useDialogos } from './ui/dialogos';
import { reconciliarTorneo } from './ui/reconciliar';
import PasoParejas from './ui/PasoParejas';
import PasoGrupos from './ui/PasoGrupos';
import PasoFaseGrupos from './ui/PasoFaseGrupos';
import PasoLlave from './ui/PasoLlave';
import PantallaRanking from './ui/PantallaRanking';
import PantallaJugadores from './ui/PantallaJugadores';
import PantallaConfigPuntos from './ui/ConfigPuntos';
import { Boton, BotonIcono, Campo, EncabezadoPagina, Entrada, Insignia, Interruptor, Selector, Vacio, type TonoInsignia } from '../admin/ui';
import { cn } from '../lib/cn';

// Estado completo del gestor (mismo shape que el "estado v2" de la app local, sin el campo version)
export type EstadoTorneos = { torneos: Torneo[]; jugadores: Jugador[]; configPuntos?: TConfigPuntos };

const ETIQUETA_FASE: Record<Torneo['fase'], string> = {
  parejas: 'Cargando parejas',
  grupos: 'Armando grupos',
  faseGrupos: 'Fase de grupos',
  llave: 'Llave',
  terminado: 'Terminado',
};
// En juego (grupos/llave) en azul; terminado en verde; armándose en gris.
const TONO_FASE: Record<Torneo['fase'], TonoInsignia> = {
  parejas: 'neutro',
  grupos: 'neutro',
  faseGrupos: 'navy',
  llave: 'navy',
  terminado: 'bien',
};

const ETIQUETA_FORMATO: Record<string, string> = { grupos: 'Grupos + llave', individual: 'One Point Challenge' };

type Props = { estado: EstadoTorneos; setEstado: (cambio: (e: EstadoTorneos) => EstadoTorneos) => void; extraCabecera?: ReactNode };

export default function TorneosApp(props: Props) {
  return (
    <DialogosProvider>
      <TorneosInterno {...props} />
    </DialogosProvider>
  );
}

function TorneosInterno({ estado, setEstado, extraCabecera }: Props) {
  const dialogos = useDialogos();
  const [torneoActivoId, setTorneoActivoId] = useState<string | null>(null);
  const [vista, setVista] = useState<'home' | 'ranking' | 'jugadores' | 'config'>('home');
  const config = estado.configPuntos ?? CONFIG_PUNTOS_DEFAULT;

  const torneo = estado.torneos.find((t) => t.id === torneoActivoId) ?? null;

  function actualizarTorneo(id: string, cambio: (t: Torneo) => Torneo) {
    setEstado((e) => ({ ...e, torneos: e.torneos.map((t) => (t.id === id ? cambio(t) : t)) }));
  }
  function setJugadores(jugadores: Jugador[]) { setEstado((e) => ({ ...e, jugadores })); }
  function setTorneos(torneos: Torneo[]) { setEstado((e) => ({ ...e, torneos })); }
  function setConfig(configPuntos: TConfigPuntos) { setEstado((e) => ({ ...e, configPuntos })); }

  async function vincularTorneo(torneoId: string) {
    const t = estado.torneos.find((x) => x.id === torneoId);
    if (!t) return;
    const jugadoresAntes = estado.jugadores; // snapshot pre-modal: para detectar que jugadores toco la reconciliacion
    const r = await reconciliarTorneo(t, jugadoresAntes, dialogos);
    if (r.cancelado) return;
    // reconciliarTorneo tarda (pregunta al usuario con dialogos): para cuando `r` resuelve,
    // el estado puede haber avanzado (un pull-merge, otra pestaña, un rename concurrente).
    // reconciliarTorneo devuelve TODO el padron (lo toco o no), asi que no alcanza con
    // "r gana por id" para cada id presente en r.jugadores - eso pisaria en silencio un
    // cambio concurrente en un jugador que esta reconciliacion nunca toco. Solo overlay
    // los que reconciliarTorneo efectivamente modifico (referencia distinta a jugadoresAntes)
    // o dio de alta (id nuevo); el resto queda como este en e.jugadores.
    setEstado((e) => {
      const antesPorId = new Map(jugadoresAntes.map((j) => [j.id, j]));
      const porId = new Map(e.jugadores.map((j) => [j.id, j])); // base: lo mas reciente
      for (const j of r.jugadores) {
        if (antesPorId.get(j.id) !== j) porId.set(j.id, j); // tocado por esta reconciliacion (alias nuevo o alta): aplicar
      }
      const jugadores = [...porId.values()];
      const existe = e.torneos.some((x) => x.id === torneoId);
      const torneos = existe ? e.torneos.map((x) => (x.id === torneoId ? r.torneo : x)) : e.torneos;
      return { ...e, jugadores, torneos };
    });
  }

  async function crearTorneo() {
    const r = await dialogos.pedirTextoConOpcion({
      titulo: 'Nuevo torneo',
      valorInicial: `Torneo ${new Date().toLocaleDateString('es-UY')}`,
      placeholder: 'Nombre del torneo',
      textoConfirmar: 'Crear',
      etiquetaOpciones: 'Formato',
      opciones: [
        { clave: 'grupos', etiqueta: 'Grupos + Llave', ayuda: 'Parejas, fase de grupos y llave final.' },
        { clave: 'individual', etiqueta: 'One Point Challenge', ayuda: 'Jugadores individuales, eliminación directa por rondas.' },
      ],
    });
    if (!r) return;
    const cat = await dialogos.elegirDeLista({
      titulo: 'Categoría del torneo',
      mensaje: 'Para el ranking VOLEA (la A da más puntos que la B). Se puede cambiar después.',
      opciones: [
        { clave: 'A', etiqueta: 'Categoría A', ayuda: 'Puntaje completo.' },
        { clave: 'B', etiqueta: 'Categoría B', ayuda: 'Un escalón menos que la A.' },
      ],
      textoConfirmar: 'Crear',
    });
    const nuevo: Torneo = {
      id: nuevoId(),
      nombre: r.texto,
      creadoEl: new Date().toISOString(),
      fase: 'parejas',
      formato: r.opcion === 'individual' ? 'individual' : 'grupos',
      categoria: cat === 'A' || cat === 'B' ? cat : undefined,
      visible: true,
      parejas: [],
      grupos: [],
      partidosGrupo: [],
      configLlave: null,
      partidosLlave: null,
    };
    setEstado((e) => ({ ...e, torneos: [nuevo, ...e.torneos] }));
    setTorneoActivoId(nuevo.id);
  }

  async function borrarTorneo(id: string) {
    const t = estado.torneos.find((x) => x.id === id);
    if (!t) return;
    const ok = await dialogos.confirmar({ titulo: 'Borrar torneo', mensaje: `¿Borrar "${t.nombre}"? No se puede deshacer.`, textoConfirmar: 'Borrar', peligro: true });
    if (!ok) return;
    setEstado((e) => ({ ...e, torneos: e.torneos.filter((x) => x.id !== id) }));
  }

  function exportar(t: Torneo) {
    const ids = new Set(t.parejas.flatMap((p) => p.jugadorIds ?? []));
    const jugadoresDelTorneo = estado.jugadores.filter((j) => ids.has(j.id));
    const json = JSON.stringify({ tipo: 'pickle-torneo', version: 2, torneo: t, jugadores: jugadoresDelTorneo }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t.nombre.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.torneo.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importar(ev: ChangeEvent<HTMLInputElement>) {
    const archivo = ev.target.files?.[0];
    ev.target.value = '';
    if (!archivo) return;
    archivo.text().then((texto) => {
      try {
        const dato = JSON.parse(texto) as { tipo?: string; torneo?: Torneo; jugadores?: Jugador[] };
        if (!dato || dato.tipo !== 'pickle-torneo' || !dato.torneo) throw new Error('El archivo no es un torneo exportado por la app');
        const t = dato.torneo;
        const formaValida = typeof t.id === 'string' && typeof t.nombre === 'string' && Array.isArray(t.parejas) && Array.isArray(t.grupos) && Array.isArray(t.partidosGrupo);
        if (!formaValida) throw new Error('El archivo de torneo está dañado o incompleto');
        if (typeof t.creadoEl !== 'string' || !t.creadoEl) throw new Error('Archivo sin fecha de creación');
        setEstado((e) => {
          const idsJ = new Set(e.jugadores.map((j) => j.id));
          const jugadoresNuevos = (dato.jugadores ?? []).filter((j) => j && typeof j.id === 'string' && !idsJ.has(j.id));
          const torneoFinal = e.torneos.some((x) => x.id === t.id) ? { ...t, id: nuevoId(), nombre: `${t.nombre} (importado)` } : t;
          return { ...e, torneos: [torneoFinal, ...e.torneos], jugadores: [...e.jugadores, ...jugadoresNuevos] };
        });
      } catch (err) {
        dialogos.avisar({ titulo: 'No se pudo importar', mensaje: err instanceof Error ? err.message : 'No se pudo importar el archivo' });
      }
    }).catch(() => dialogos.avisar({ titulo: 'No se pudo leer', mensaje: 'No se pudo leer el archivo' }));
  }

  if (!torneo && vista === 'ranking') {
    return <PantallaRanking torneos={estado.torneos} jugadores={estado.jugadores} config={config} onVincular={vincularTorneo} onVolver={() => setVista('home')} />;
  }
  if (!torneo && vista === 'jugadores') {
    return <PantallaJugadores jugadores={estado.jugadores} torneos={estado.torneos} config={config} setJugadores={setJugadores} setTorneos={setTorneos} onVolver={() => setVista('home')} />;
  }
  if (!torneo && vista === 'config') {
    return <PantallaConfigPuntos config={config} setConfig={setConfig} onVolver={() => setVista('home')} />;
  }

  if (!torneo) {
    const clasesAtajo = 'flex h-12 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 font-display text-sm font-bold text-navy-700 transition-colors hover:border-navy-700 active:scale-[0.98]';
    return (
      <main className="contenedor">
        <EncabezadoPagina
          rotulo="Torneos"
          titulo="Gestor de torneos"
          descripcion="Parejas, grupos, resultados y llave. Lo que cargás acá se ve en vivo en la web."
          acciones={(
            <>
              {extraCabecera}
              <Boton icono={<Plus size={18} />} onClick={crearTorneo}>Nuevo torneo</Boton>
            </>
          )}
        />
        {/* Atajos a ranking/jugadores/puntos: antes eran 5 botones sueltos que en el celular
            ocupaban tres renglones. Grilla de 2 en el celular, 4 en la compu. */}
        <nav aria-label="Ranking y ajustes" className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button type="button" className={clasesAtajo} onClick={() => setVista('ranking')}>
            <Trophy size={18} aria-hidden /> Ranking
          </button>
          <button type="button" className={clasesAtajo} onClick={() => setVista('jugadores')}>
            <Users size={18} aria-hidden /> Jugadores
          </button>
          <button type="button" className={clasesAtajo} onClick={() => setVista('config')}>
            <SlidersHorizontal size={18} aria-hidden /> Puntos
          </button>
          <label className={cn(clasesAtajo, 'cursor-pointer focus-within:ring-2 focus-within:ring-navy-700 focus-within:ring-offset-2')}>
            <FileUp size={18} aria-hidden /> Importar
            <input type="file" accept="application/json,.json" onChange={importar} className="sr-only" />
          </label>
        </nav>
        {estado.torneos.length === 0 ? (
          <Vacio
            icono={<Trophy size={22} />}
            titulo="Todavía no hay torneos"
            descripcion="Creá el primero: nombre, formato y categoría, y arrancás a cargar parejas."
            accion={<Boton icono={<Plus size={18} />} onClick={crearTorneo}>Nuevo torneo</Boton>}
          />
        ) : (
          <ul className="grid gap-2">
            {estado.torneos.map((t) => {
              const individual = (t.formato ?? 'grupos') === 'individual';
              const sumaOculto = t.fase === 'terminado' && t.cuentaParaRanking !== false && t.visible === false;
              return (
                <li key={t.id} className="flex items-stretch rounded-xl border border-gray-200 bg-white transition-colors hover:border-navy-700">
                  <button type="button" className="min-w-0 flex-1 rounded-l-xl px-4 py-3 text-left" onClick={() => setTorneoActivoId(t.id)}>
                    <span className="block break-words font-display text-base font-bold leading-snug text-navy-700">{t.nombre}</span>
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      <Insignia tono={TONO_FASE[t.fase]}>{ETIQUETA_FASE[t.fase]}</Insignia>
                      {t.categoria
                        ? <Insignia tono="navy">Cat {t.categoria}</Insignia>
                        : <Insignia tono="atencion">Sin categoría</Insignia>}
                      {t.evento && !individual && <Insignia>Evento {t.evento}</Insignia>}
                      {t.visible === false && (
                        <Insignia><EyeOff size={12} aria-hidden /> Oculto</Insignia>
                      )}
                      {sumaOculto && (
                        <span title="Está sumando al ranking pero el público no lo ve"><Insignia tono="alerta">Suma oculto</Insignia></span>
                      )}
                    </span>
                    <span className="mt-1.5 block text-[13px] text-gray-500">
                      {new Date(t.creadoEl).toLocaleDateString('es-UY')} · {t.parejas.length} {individual ? 'jugadores' : 'parejas'} · {ETIQUETA_FORMATO[t.formato ?? 'grupos']}
                    </span>
                  </button>
                  <div className="flex shrink-0 flex-col items-center justify-center border-l border-gray-100 px-1 sm:flex-row">
                    <BotonIcono etiqueta={`Exportar ${t.nombre}`} icono={<Download size={18} />} onClick={() => exportar(t)} />
                    <BotonIcono etiqueta={`Borrar ${t.nombre}`} icono={<Trash2 size={18} />} tono="peligro" onClick={() => borrarTorneo(t.id)} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    );
  }

  const esIndividual = (torneo.formato ?? 'grupos') === 'individual';
  return (
    <main className="contenedor">
      <Boton variante="fantasma" icono={<ArrowLeft size={18} />} onClick={() => setTorneoActivoId(null)} className="-ml-3 mb-1">
        Torneos
      </Boton>
      <EncabezadoPagina
        rotulo={ETIQUETA_FORMATO[torneo.formato ?? 'grupos']}
        titulo={<span className="break-words">{torneo.nombre}</span>}
        className="mb-4"
      />
      <AjustesTorneo
        torneo={torneo}
        eventosUsados={[...new Set(estado.torneos.map((x) => x.evento?.trim()).filter((ev): ev is string => !!ev))]}
        esIndividual={esIndividual}
        actualizar={(cambio) => actualizarTorneo(torneo.id, cambio)}
      />
      <Wizard torneo={torneo} actualizar={(cambio) => actualizarTorneo(torneo.id, cambio)} />
    </main>
  );
}

// Categoría, evento y los dos interruptores del torneo. Se tocan una vez: plegado por
// defecto (con un resumen en insignias) para que el cuadro quede arriba en el celular.
// Abierto de entrada si todavía no tiene categoría (sin ella no suma al ranking).
function AjustesTorneo({ torneo, eventosUsados, esIndividual, actualizar }: {
  torneo: Torneo;
  eventosUsados: string[];
  esIndividual: boolean;
  actualizar: (cambio: (t: Torneo) => Torneo) => void;
}) {
  const [abierto, setAbierto] = useState(!torneo.categoria);
  return (
    <section className="mb-5 rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left"
      >
        <span className="font-display text-sm font-bold uppercase tracking-wide text-navy-700">Ajustes</span>
        <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {torneo.categoria ? <Insignia tono="navy">Cat {torneo.categoria}</Insignia> : <Insignia tono="atencion">Sin categoría</Insignia>}
          {!esIndividual && torneo.evento && <Insignia>Evento {torneo.evento}</Insignia>}
          {torneo.cuentaParaRanking === false && <Insignia tono="atencion">No suma</Insignia>}
          {torneo.visible === false && <Insignia><EyeOff size={12} aria-hidden /> Oculto</Insignia>}
        </span>
        <ChevronDown size={18} aria-hidden className={cn('shrink-0 text-gray-500 transition-transform', abierto && 'rotate-180')} />
      </button>
      {abierto && (
        <div className="grid gap-4 border-t border-gray-100 px-4 py-4 sm:grid-cols-2">
          <Campo etiqueta="Categoría" ayuda="Para el ranking VOLEA (la A da más puntos que la B).">
            <Selector
              value={torneo.categoria ?? ''}
              onChange={(e) => actualizar((t) => ({ ...t, categoria: e.target.value === '' ? undefined : (e.target.value as 'A' | 'B') }))}
            >
              <option value="">— sin categoría —</option>
              <option value="A">A</option>
              <option value="B">B</option>
            </Selector>
          </Campo>
          {!esIndividual && (
            <Campo
              etiqueta="Evento"
              ayuda="Torneos con el mismo evento (la A y la B del mismo día): al jugador le cuenta solo el mejor."
            >
              <Entrada
                type="text"
                value={torneo.evento ?? ''}
                placeholder="ej. 26/7"
                list="rk-eventos-usados"
                autoComplete="off"
                onChange={(e) => actualizar((t) => ({ ...t, evento: e.target.value.trim() === '' ? undefined : e.target.value }))}
                onBlur={(e) => {
                  const limpio = e.target.value.trim();
                  if (limpio !== e.target.value) actualizar((t) => ({ ...t, evento: limpio === '' ? undefined : limpio }));
                }}
              />
            </Campo>
          )}
          {!esIndividual && (
            <datalist id="rk-eventos-usados">
              {eventosUsados.map((ev) => <option key={ev} value={ev} />)}
            </datalist>
          )}
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 px-3 sm:col-span-2">
            <Interruptor
              activo={torneo.cuentaParaRanking !== false}
              alCambiar={(v) => actualizar((t) => ({ ...t, cuentaParaRanking: v }))}
              etiqueta="Cuenta para el ranking"
              descripcion="Apagalo en torneos de prueba."
            />
            <Interruptor
              activo={torneo.visible !== false}
              alCambiar={(v) => actualizar((t) => ({ ...t, visible: v }))}
              etiqueta="Visible al público"
              descripcion="Si está apagado, la web no lo muestra."
            />
          </div>
        </div>
      )}
    </section>
  );
}

// Contrato de los pasos del wizard: `cambio` corre dentro del state updater de React,
// así que debe ser PURO (nada de alerts/confirms adentro; esos van antes de llamar a actualizar).
export type PropsPaso = { torneo: Torneo; actualizar: (cambio: (t: Torneo) => Torneo) => void };

const PASOS_GRUPOS: { fase: Exclude<Torneo['fase'], 'terminado'>; titulo: string }[] = [
  { fase: 'parejas', titulo: 'Parejas' },
  { fase: 'grupos', titulo: 'Grupos' },
  { fase: 'faseGrupos', titulo: 'Fase de grupos' },
  { fase: 'llave', titulo: 'Llave' },
];
const PASOS_INDIVIDUAL: { fase: Exclude<Torneo['fase'], 'terminado'>; titulo: string }[] = [
  { fase: 'parejas', titulo: 'Jugadores' },
  { fase: 'llave', titulo: 'Llave' },
];

function Wizard({ torneo, actualizar }: PropsPaso) {
  const dialogos = useDialogos();
  const individual = (torneo.formato ?? 'grupos') === 'individual';
  const PASOS = individual ? PASOS_INDIVIDUAL : PASOS_GRUPOS;
  const faseVisible = torneo.fase === 'terminado' ? 'llave' : torneo.fase;
  const idxActual = PASOS.findIndex((p) => p.fase === faseVisible);
  // En el celular la barra de pasos no entra: se desliza sola hasta el paso actual (si no,
  // en "Llave" se veía "Parejas · Grupos · Fase de…" y el paso activo quedaba afuera).
  const barraPasos = useRef<HTMLElement>(null);
  useEffect(() => {
    const barra = barraPasos.current;
    const activo = barra?.querySelector<HTMLElement>('[aria-current="step"]');
    if (barra && activo) barra.scrollLeft = Math.max(0, activo.offsetLeft - 16);
  }, [idxActual]);

  async function volverA(fase: (typeof PASOS)[number]['fase']) {
    const idx = PASOS.findIndex((p) => p.fase === fase);
    if (idx >= idxActual) return;
    if (fase === 'parejas' && (torneo.partidosGrupo.length > 0 || torneo.partidosLlave !== null)) {
      const ok = await dialogos.confirmar({
        titulo: individual ? 'Volver a Jugadores' : 'Volver a Parejas',
        mensaje: individual
          ? 'Descarta la llave armada. ¿Seguir?'
          : 'Descarta los grupos, el fixture, los resultados y la llave. ¿Seguir?',
        textoConfirmar: 'Volver',
        peligro: true,
      });
      if (!ok) return;
      actualizar((t) => ({ ...t, grupos: [], partidosGrupo: [], configLlave: null, partidosLlave: null, fase: 'parejas' }));
      return;
    }
    if (
      fase === 'grupos' &&
      (torneo.partidosGrupo.some((p) => p.puntosA !== null || p.puntosB !== null) || torneo.partidosLlave !== null)
    ) {
      const ok = await dialogos.confirmar({ titulo: 'Volver a Grupos', mensaje: 'Borra los resultados de la fase de grupos y la llave. ¿Seguir?', textoConfirmar: 'Volver', peligro: true });
      if (!ok) return;
      actualizar((t) => ({ ...t, partidosGrupo: [], configLlave: null, partidosLlave: null, fase: 'grupos' }));
      return;
    }
    actualizar((t) => ({ ...t, fase }));
  }

  return (
    <>
      {/* Pasos: el actual lleno en azul marino; los hechos se tocan para volver (con la
          misma confirmación de siempre si eso descarta algo). En el celular se desliza. */}
      <nav ref={barraPasos} aria-label="Pasos del torneo" className="relative -mx-4 mb-5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        <ol className="flex min-w-max items-center gap-1.5">
          {PASOS.map((p, i) => {
            const hecho = i < idxActual;
            const activo = i === idxActual;
            const numero = (
              <span
                aria-hidden
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold tabular-nums',
                  activo ? 'bg-white text-navy-700' : hecho ? 'bg-navy-700 text-white' : 'bg-gray-100 text-gray-500',
                )}
              >
                {hecho ? <Check size={15} strokeWidth={3} /> : i + 1}
              </span>
            );
            return (
              <li key={p.fase} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden className={cn('h-px w-4', i <= idxActual ? 'bg-navy-700' : 'bg-gray-300')} />}
                {hecho ? (
                  <button
                    type="button"
                    onClick={() => volverA(p.fase)}
                    aria-label={`Volver a ${p.titulo}`}
                    className="inline-flex h-11 items-center gap-2 rounded-full border border-navy-700 bg-white pl-2 pr-4 font-display text-[13px] font-bold text-navy-700 transition-colors hover:bg-navy-50"
                  >
                    {numero}{p.titulo}
                  </button>
                ) : (
                  <span
                    aria-current={activo ? 'step' : undefined}
                    className={cn(
                      'inline-flex h-11 items-center gap-2 rounded-full border pl-2 pr-4 font-display text-[13px] font-bold',
                      activo ? 'border-navy-700 bg-navy-700 text-white' : 'border-gray-200 bg-white text-gray-500',
                    )}
                  >
                    {numero}{p.titulo}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <section className="contenido">
        {faseVisible === 'parejas' && <PasoParejas torneo={torneo} actualizar={actualizar} />}
        {faseVisible === 'grupos' && <PasoGrupos torneo={torneo} actualizar={actualizar} />}
        {faseVisible === 'faseGrupos' && <PasoFaseGrupos torneo={torneo} actualizar={actualizar} />}
        {faseVisible === 'llave' && <PasoLlave torneo={torneo} actualizar={actualizar} />}
      </section>
    </>
  );
}
