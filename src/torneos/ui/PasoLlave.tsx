import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, ChevronDown, ListChecks, Medal, RotateCcw, Shuffle, Trophy } from 'lucide-react';
import type { PropsPaso } from '../TorneosApp';
import type { PartidoLlave, Torneo } from '../engine/tipos';
import { resultadoValido } from '../engine/tipos';
import { calcularClasificados, candidatosMejoresExtra, compararMetricas, opcionesClasificacion } from '../engine/clasificacion';
import type { ConfigLlave, SlotLlave } from '../engine/tipos';
import { armarLlave, borradosSiCorrijo, cargarResultadoLlave, ganadorPartido, podio, resolverSlot } from '../engine/llave';
import { armarLlaveRolling } from '../engine/llaveIndividual';
import { crearRng, mezclar } from '../engine/rng';
import { calcularTabla } from '../engine/tabla';
import { ordenDeJuego } from '../engine/canchas';
import { nombreDe } from './util';
import { useDialogos } from './dialogos';
import { Boton, Insignia, Interruptor, Segmentado, Tarjeta } from '../../admin/ui';
import { cn } from '../../lib/cn';
import { CajaPuntos, Nota, PiePaso, useBorradorMarcador } from './piezas';

export default function PasoLlave({ torneo, actualizar }: PropsPaso) {
  const individual = (torneo.formato ?? 'grupos') === 'individual';
  if (individual) {
    if (!torneo.partidosLlave) return <ConfigurarLlaveIndividual torneo={torneo} actualizar={actualizar} />;
    return <VerLlave torneo={torneo} actualizar={actualizar} />;
  }
  if (torneo.fase === 'terminado' && !torneo.partidosLlave) {
    return <CampeonDeGrupoUnico torneo={torneo} actualizar={actualizar} />;
  }
  if (!torneo.partidosLlave) return <ConfigurarLlave torneo={torneo} actualizar={actualizar} />;
  return <VerLlave torneo={torneo} actualizar={actualizar} />;
}

/** Lista numerada de nombres (orden de la ronda 1, seeds, clasificados). */
function ListaOrden({ children }: { children: ReactNode }) {
  return <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200">{children}</ol>;
}
function ItemOrden({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex min-h-[44px] items-center gap-3 px-3 py-2">
      <span className="w-6 shrink-0 text-right text-[13px] font-semibold tabular-nums text-gray-500">{n}</span>
      <span className="min-w-0 flex-1 text-[15px] text-navy-700">{children}</span>
    </li>
  );
}

function ConfigurarLlaveIndividual({ torneo, actualizar }: PropsPaso) {
  const [orden, setOrden] = useState<string[]>(torneo.parejas.map((p) => p.id));

  function sortear() {
    setOrden((actual) => mezclar(actual, crearRng(Math.floor(Math.random() * 2 ** 31))));
  }
  function armar() {
    const partidos = armarLlaveRolling(orden);
    actualizar((t) => ({ ...t, configLlave: null, partidosLlave: partidos }));
  }

  const pares: [string, string][] = [];
  let zafa: string | null = null;
  for (let i = 0; i < orden.length; i += 2) {
    if (i + 1 < orden.length) pares.push([orden[i], orden[i + 1]]);
    else zafa = orden[i];
  }

  return (
    <section className="space-y-4">
      <Tarjeta titulo="Armar la llave">
        <p className="text-sm text-gray-600">Los jugadores se emparejan en el orden de abajo (1 vs 2, 3 vs 4…). Sorteá si querés cambiarlo.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Boton variante="secundario" icono={<Shuffle size={18} />} onClick={sortear}>Sortear orden</Boton>
          <Boton icono={<Check size={18} />} onClick={armar}>Armar llave</Boton>
        </div>
      </Tarjeta>

      <Tarjeta titulo="Así arranca la ronda 1">
        <ListaOrden>
          {pares.map(([a, b], i) => (
            <ItemOrden key={i} n={i + 1}>
              <strong className="font-semibold">{nombreDe(torneo, a)}</strong> <span className="text-gray-500">vs</span> <strong className="font-semibold">{nombreDe(torneo, b)}</strong>
            </ItemOrden>
          ))}
        </ListaOrden>
        {zafa && (
          <Nota className="mt-3">{nombreDe(torneo, zafa)} zafa la ronda 1 (número impar) y entra directo a la ronda 2.</Nota>
        )}
      </Tarjeta>

      <PiePaso
        izquierda={(
          <Boton variante="secundario" icono={<ArrowLeft size={18} />} onClick={() => actualizar((t) => ({ ...t, fase: 'parejas' }))}>
            Jugadores
          </Boton>
        )}
      />
    </section>
  );
}

function ConfigurarLlave({ torneo, actualizar }: PropsPaso) {
  const dialogos = useDialogos();
  const opciones = opcionesClasificacion(torneo.grupos).slice(0, 4);
  const [elegida, setElegida] = useState(0);
  const [tercerPuesto, setTercerPuesto] = useState(false);
  // extras elegidos a mano (parejaIds); null = automático por métricas
  const [extrasManuales, setExtrasManuales] = useState<string[] | null>(null);
  const esGrupoUnico = torneo.grupos.length === 1;

  const opcion = opciones[elegida] as (typeof opciones)[number] | undefined;

  // extras automáticos de la opción actual (los mejores por métricas)
  const extrasAuto =
    opcion && opcion.mejoresExtra > 0
      ? candidatosMejoresExtra(torneo.grupos, torneo.partidosGrupo, { porGrupo: opcion.porGrupo, mejoresExtra: opcion.mejoresExtra })
          .filter((c) => c.entra)
          .map((c) => c.parejaId)
      : [];
  const extrasElegidos = extrasManuales ?? extrasAuto;
  const configConExtras = opcion
    ? { porGrupo: opcion.porGrupo, mejoresExtra: opcion.mejoresExtra, extrasManuales: extrasElegidos }
    : null;
  const clasificados = configConExtras ? calcularClasificados(torneo.grupos, torneo.partidosGrupo, configConExtras) : [];
  const extrasCompletos = !opcion || opcion.mejoresExtra === 0 || extrasElegidos.length === opcion.mejoresExtra;

  function elegirOpcion(i: number) {
    setElegida(i);
    setExtrasManuales(null); // otra opción ⇒ volver al automático
  }
  function toggleExtra(parejaId: string) {
    const base = extrasManuales ?? extrasAuto;
    setExtrasManuales(base.includes(parejaId) ? base.filter((x) => x !== parejaId) : [...base, parejaId]);
  }

  function armar() {
    if (!opcion || !extrasCompletos) return;
    const conTercero = tercerPuesto && opcion.tamanoLlave >= 4;
    const seeds = clasificados.map((c) => ({ parejaId: c.parejaId, grupoId: c.grupoId }));
    actualizar((t) => ({
      ...t,
      configLlave: { porGrupo: opcion.porGrupo, mejoresExtra: opcion.mejoresExtra, tercerPuesto: conTercero, extrasManuales: extrasElegidos },
      partidosLlave: armarLlave(seeds, conTercero),
    }));
  }

  async function terminarSinLlave() {
    const ok = await dialogos.confirmar({ titulo: 'Terminar sin llave', mensaje: 'El campeón es el 1º de la tabla del grupo. ¿Terminar el torneo así?', textoConfirmar: 'Terminar' });
    if (!ok) return;
    actualizar((t) => ({ ...t, fase: 'terminado' }));
  }

  return (
    <section className="space-y-4">
      <Tarjeta titulo="¿Cómo se arma la llave?">
        <p className="mb-3 text-sm text-gray-600">Elegí cuántos clasifican. La primera es la recomendada: la llave más justa con estos grupos.</p>
        <div role="radiogroup" aria-label="Cómo se arma la llave" className="grid gap-2">
          {opciones.map((o, i) => {
            const activa = elegida === i;
            return (
              <label
                key={`${o.porGrupo}-${o.mejoresExtra}`}
                className={cn(
                  'flex min-h-[52px] cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors',
                  activa ? 'border-navy-700 bg-navy-50 ring-1 ring-inset ring-navy-700' : 'border-gray-300 bg-white hover:border-navy-700',
                )}
              >
                <input type="radio" name="opcion" checked={activa} onChange={() => elegirOpcion(i)} className="mt-0.5 h-5 w-5 shrink-0 accent-navy-700" />
                <span className="min-w-0 text-[15px] text-navy-700">
                  {i === 0 && <Insignia tono="bien" className="mb-1 mr-1.5">Recomendada</Insignia>}
                  {o.descripcion}
                </span>
              </label>
            );
          })}
        </div>
        <div className="mt-3 border-t border-gray-100 pt-1">
          <Interruptor
            activo={tercerPuesto && !!opcion && opcion.tamanoLlave >= 4}
            disabled={!opcion || opcion.tamanoLlave < 4}
            alCambiar={setTercerPuesto}
            etiqueta="Jugar partido por el 3er puesto"
            descripcion={!opcion || opcion.tamanoLlave < 4 ? 'Solo con llave de 4 o más.' : undefined}
          />
        </div>
      </Tarjeta>

      {opcion && clasificados.length > 0 && (
        <Tarjeta titulo="Así entran (orden de seed)">
          <ListaOrden>
            {clasificados.map((c, i) => (
              <ItemOrden key={c.parejaId} n={i + 1}>
                <span className="mr-2 font-semibold">{nombreDe(torneo, c.parejaId)}</span>
                <Insignia>{c.puesto}º del grupo {c.grupoNombre}</Insignia>
              </ItemOrden>
            ))}
          </ListaOrden>
        </Tarjeta>
      )}

      {opcion && opcion.mejoresExtra > 0 && (
        <SelectorExtras
          torneo={torneo}
          config={{ porGrupo: opcion.porGrupo, mejoresExtra: opcion.mejoresExtra }}
          elegidos={extrasElegidos}
          onToggle={toggleExtra}
        />
      )}

      <PiePaso
        izquierda={(
          <Boton variante="secundario" icono={<ArrowLeft size={18} />} onClick={() => actualizar((t) => ({ ...t, fase: 'faseGrupos' }))}>
            Fase de grupos
          </Boton>
        )}
        derecha={(
          <>
            {esGrupoUnico && (
              <Boton variante="secundario" onClick={() => void terminarSinLlave()}>Terminar sin llave</Boton>
            )}
            <Boton disabled={!opcion || !extrasCompletos} onClick={armar} icono={extrasCompletos ? <Check size={18} /> : undefined}>
              {extrasCompletos ? 'Armar llave' : `Elegí ${opcion?.mejoresExtra ?? 0} para armar`}
            </Boton>
          </>
        )}
      />
    </section>
  );
}

const PUESTO_PLURAL: Record<number, string> = { 2: 'segundos', 3: 'terceros', 4: 'cuartos' };

// Tabla comparativa de los candidatos a "mejores del puesto siguiente": quién entra, quién queda
// afuera y con qué números — y un aviso explícito si el corte se decidió por empate total
// (ahí manda el orden de grupo: A antes que B).
function ComparacionExtras({ torneo, config }: { torneo: Torneo; config: Pick<ConfigLlave, 'porGrupo' | 'mejoresExtra'> }) {
  const candidatos = candidatosMejoresExtra(torneo.grupos, torneo.partidosGrupo, config);
  if (candidatos.length === 0) return null;
  const puesto = config.porGrupo + 1;
  const corte = candidatos.findIndex((c) => !c.entra);
  const empateEnCorte =
    corte > 0 &&
    corte < candidatos.length &&
    compararMetricas(candidatos[corte - 1].metricas, candidatos[corte].metricas) === 0;
  return (
    <div className="mt-4">
      <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-navy-700">
        ¿Qué {puesto}º entra? (mejores {PUESTO_PLURAL[puesto] ?? `${puesto}ºs`})
      </h3>
      <div className="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th>Grupo</th><th className="nombre">Pareja</th><th>PG-PP</th><th>Dif</th><th>PF</th><th>%V</th><th></th>
            </tr>
          </thead>
          <tbody>
            {candidatos.map((c) => (
              <tr key={c.parejaId}>
                <td>{c.grupoNombre}</td>
                <td className="nombre">{nombreDe(torneo, c.parejaId)}</td>
                <td>{c.pg}-{c.pp}</td>
                <td>{c.dif > 0 ? `+${c.dif}` : c.dif}</td>
                <td>{c.pf}</td>
                <td>{c.pj > 0 ? `${Math.round((c.pg / c.pj) * 100)}%` : '—'}</td>
                <td>{c.entra ? <Insignia tono="bien">Entra</Insignia> : <Insignia>Afuera</Insignia>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {empateEnCorte && (
        <Nota className="mt-3">
          Empate total entre <strong>{nombreDe(torneo, candidatos[corte - 1].parejaId)}</strong> y{' '}
          <strong>{nombreDe(torneo, candidatos[corte].parejaId)}</strong> (mismas victorias y mismos puntos):
          entra el del grupo {candidatos[corte - 1].grupoNombre} por orden de grupos (A antes que B).
        </Nota>
      )}
    </div>
  );
}

// Versión interactiva de la comparación: tildás a mano quién entra (para resolver empates en la
// cancha con un sorteo o un partido a 11). Arranca con la elección automática ya marcada.
function SelectorExtras({ torneo, config, elegidos, onToggle }: {
  torneo: Torneo;
  config: Pick<ConfigLlave, 'porGrupo' | 'mejoresExtra'>;
  elegidos: string[];
  onToggle: (parejaId: string) => void;
}) {
  const candidatos = candidatosMejoresExtra(torneo.grupos, torneo.partidosGrupo, config);
  if (candidatos.length === 0) return null;
  const puesto = config.porGrupo + 1;
  const hayEmpate = candidatos.some((c, i) => i > 0 && compararMetricas(candidatos[i - 1].metricas, c.metricas) === 0);
  const faltan = config.mejoresExtra - elegidos.length;
  return (
    <Tarjeta
      titulo={`¿Qué ${puesto}º entra? Elegí ${config.mejoresExtra}`}
      acciones={(
        <Insignia tono={faltan === 0 ? 'bien' : 'alerta'}>
          {elegidos.length} / {config.mejoresExtra}
          {faltan > 0 && ` · falta${faltan > 1 ? 'n' : ''} ${faltan}`}
          {faltan < 0 && ` · sacá ${-faltan}`}
        </Insignia>
      )}
    >
      <p className="mb-3 text-[13px] text-gray-500">Mejores {PUESTO_PLURAL[puesto] ?? `${puesto}ºs`}: tocá la fila para marcar o desmarcar.</p>
      {hayEmpate && (
        <Nota className="mb-3">
          Hay empatados en el corte. Definilo en la cancha (sorteo, piedra-papel-tijera o partido a 11) y marcá acá quién pasa.
        </Nota>
      )}
      <div className="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th></th><th>Grupo</th><th className="nombre">Pareja</th><th>PG-PP</th><th>Dif</th><th>PF</th><th>%V</th>
            </tr>
          </thead>
          <tbody>
            {candidatos.map((c) => {
              const marcado = elegidos.includes(c.parejaId);
              return (
                <tr key={c.parejaId} style={marcado ? { background: 'var(--lima-suave)' } : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => onToggle(c.parejaId)}
                      aria-label={`Elegir ${nombreDe(torneo, c.parejaId)}`}
                      className="h-5 w-5 cursor-pointer accent-navy-700"
                    />
                  </td>
                  <td>{c.grupoNombre}</td>
                  <td className="nombre">{nombreDe(torneo, c.parejaId)}</td>
                  <td>{c.pg}-{c.pp}</td>
                  <td>{c.dif > 0 ? `+${c.dif}` : c.dif}</td>
                  <td>{c.pf}</td>
                  <td>{c.pj > 0 ? `${Math.round((c.pg / c.pj) * 100)}%` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Tarjeta>
  );
}

// Compu: el cuadro entero. Celular: de a una ronda (el cuadro de 4 columnas obligaba a
// deslizar de costado con el dedo sobre las cajas de puntos). Se puede cambiar a mano.
const CONSULTA_ANCHO = '(min-width: 768px)';
function useEsAncho(): boolean {
  const [ancho, setAncho] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(CONSULTA_ANCHO).matches : true));
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(CONSULTA_ANCHO);
    const alCambiar = () => setAncho(mq.matches);
    // Safari viejo (iOS < 14) solo tiene addListener.
    if (mq.addEventListener) mq.addEventListener('change', alCambiar); else mq.addListener(alCambiar);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', alCambiar); else mq.removeListener(alCambiar); };
  }, []);
  return ancho;
}

function VerLlave({ torneo, actualizar }: PropsPaso) {
  const dialogos = useDialogos();
  const individual = (torneo.formato ?? 'grupos') === 'individual';
  const partidos = torneo.partidosLlave as PartidoLlave[];
  const resultado = podio(partidos);
  const maxRonda = Math.max(...partidos.filter((p) => !p.esTercerPuesto).map((p) => p.ronda));
  const rondas = Array.from({ length: maxRonda }, (_, i) => i + 1);
  const tercero = partidos.find((p) => p.esTercerPuesto);
  const esAncho = useEsAncho();
  const [modo, setModo] = useState<'ronda' | 'cuadro' | null>(null);
  const modoVisible = modo ?? (esAncho ? 'cuadro' : 'ronda');

  // Procedencia "2º B" por pareja según la tabla ACTUAL de su grupo (solo formato grupos):
  // explica cada cruce de la ronda 1 y se mantiene coherente con las tablas del paso 3.
  const procedencia = new Map<string, string>();
  if (!individual) {
    for (const g of torneo.grupos) {
      const filas = calcularTabla(g.parejaIds, torneo.partidosGrupo.filter((p) => p.grupoId === g.id));
      for (const f of filas) procedencia.set(f.parejaId, `${f.posicion}º ${g.nombre}`);
    }
  }

  async function cargar(partido: PartidoLlave, puntosA: number | null, puntosB: number | null) {
    const borrados = borradosSiCorrijo(partidos, partido.id, puntosA, puntosB);
    if (borrados > 0) {
      const ok = await dialogos.confirmar({
        titulo: 'Corregir resultado',
        mensaje: `Esta corrección cambia el ganador y borra ${borrados} resultado${borrados > 1 ? 's' : ''} posterior${borrados > 1 ? 'es' : ''}. ¿Seguir?`,
        textoConfirmar: 'Corregir',
        peligro: true,
      });
      if (!ok) return;
    }
    actualizar((t) => ({
      ...t,
      partidosLlave: t.partidosLlave
        ? cargarResultadoLlave(t.partidosLlave, partido.id, puntosA, puntosB).partidos
        : t.partidosLlave,
    }));
  }

  async function rearmar() {
    const teniaResultados = partidos.some((p) => resultadoValido(p.puntosA, p.puntosB));
    const ok = await dialogos.confirmar({
      titulo: 'Rearmar llave',
      mensaje: teniaResultados
        ? 'La llave ya tiene resultados: rearmarla los borra. ¿Seguir?'
        : '¿Rearmar la llave? Volvés a elegir cuántos clasifican.',
      textoConfirmar: 'Rearmar',
      peligro: teniaResultados,
    });
    if (!ok) return;
    actualizar((t) => ({ ...t, configLlave: null, partidosLlave: null, fase: 'llave' }));
  }

  function nombreRonda(r: number): string {
    const desdeElFinal = maxRonda - r;
    if (desdeElFinal === 0) return 'Final';
    // en el rolling individual las rondas no mapean a octavos/cuartos limpios: solo "Ronda N"
    if (individual) return `Ronda ${r}`;
    if (desdeElFinal === 1) return 'Semifinales';
    if (desdeElFinal === 2) return 'Cuartos';
    if (desdeElFinal === 3) return 'Octavos';
    return `Ronda ${r}`;
  }

  // Partidos de una ronda con su etiqueta de cancha/tanda (misma cuenta de antes).
  function partidosDeRonda(r: number) {
    const matchesDeLaRonda = partidos
      .filter((p) => !p.esTercerPuesto && p.ronda === r)
      .sort((a, b) => a.posicion - b.posicion);
    const canchas = torneo.canchas ?? 2;
    const turnos =
      !individual && matchesDeLaRonda.length >= 2
        ? ordenDeJuego(matchesDeLaRonda.map((m) => ({ id: m.id, grupoId: '' })), canchas)
        : [];
    const turnoPorId = new Map(turnos.map((t) => [t.partidoId, t]));
    return matchesDeLaRonda.map((p) => {
      const t = turnoPorId.get(p.id);
      const etiquetaCancha = t
        ? turnos.length > canchas
          ? `Cancha ${t.cancha} · Tanda ${t.tanda}`
          : `Cancha ${t.cancha}`
        : undefined;
      const procA = r === 1 && p.a?.tipo === 'seed' ? procedencia.get(p.a.parejaId) : undefined;
      const procB = r === 1 && p.b?.tipo === 'seed' ? procedencia.get(p.b.parejaId) : undefined;
      return (
        <CajaPartido
          key={p.id}
          torneo={torneo}
          partido={p}
          partidos={partidos}
          onCargar={cargar}
          etiquetaCancha={etiquetaCancha}
          procedenciaA={procA}
          procedenciaB={procB}
        />
      );
    });
  }

  // Avance por ronda (para las pestañas del celular) y la ronda que conviene mostrar primero:
  // la primera con partidos para cargar; si no queda ninguno, la final.
  const avance = rondas.map((r) => {
    const deRonda = partidos.filter((p) => !p.esTercerPuesto && p.ronda === r);
    const jugables = deRonda.filter((p) => p.a !== null && p.b !== null && resolverSlot(p.a, partidos) !== null && resolverSlot(p.b, partidos) !== null);
    const jugados = jugables.filter((p) => resultadoValido(p.puntosA, p.puntosB));
    return { r, jugables: jugables.length, jugados: jugados.length };
  });
  const rondaSugerida = avance.find((a) => a.jugables > a.jugados)?.r ?? maxRonda;
  const [rondaElegida, setRondaElegida] = useState<number | null>(null);
  const rondaVisible = rondaElegida !== null && rondaElegida <= maxRonda ? rondaElegida : rondaSugerida;

  return (
    <section className="space-y-4">
      {resultado.campeon && (
        <Campeon
          nombre={nombreDe(torneo, resultado.campeon)}
          subcampeon={resultado.subcampeon ? nombreDe(torneo, resultado.subcampeon) : null}
          tercero={resultado.tercero ? nombreDe(torneo, resultado.tercero) : null}
          accion={torneo.fase !== 'terminado' ? (
            <Boton variante="acento" onClick={() => actualizar((t) => ({ ...t, fase: 'terminado' }))}>
              Dar por terminado el torneo
            </Boton>
          ) : undefined}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide text-navy-700">Llave</h3>
        <Segmentado
          etiqueta="Cómo ver la llave"
          valor={modoVisible}
          alCambiar={setModo}
          opciones={[{ valor: 'ronda', texto: 'Por ronda' }, { valor: 'cuadro', texto: 'Cuadro completo' }]}
        />
      </div>

      {modoVisible === 'ronda' ? (
        <div>
          <Segmentado
            etiqueta="Ronda"
            valor={String(rondaVisible)}
            alCambiar={(v) => setRondaElegida(Number(v))}
            anchoCompleto
            className="mb-3"
            opciones={avance.map((a) => ({
              valor: String(a.r),
              texto: (
                <>
                  {nombreRonda(a.r)}
                  {a.jugables > 0 && (
                    <span className="ml-1 text-[11px] font-bold tabular-nums opacity-70">{a.jugados}/{a.jugables}</span>
                  )}
                </>
              ),
            }))}
          />
          <div className="grid gap-3 md:grid-cols-2">{partidosDeRonda(rondaVisible)}</div>
        </div>
      ) : (
        <div className="llave">
          {rondas.map((r) => (
            <div key={r} className="ronda-llave">
              <h3 style={{ textAlign: 'center', margin: '0 0 4px' }}>{nombreRonda(r)}</h3>
              {partidosDeRonda(r)}
            </div>
          ))}
        </div>
      )}

      {tercero && (
        <div className="max-w-md">
          <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-navy-700">3er puesto</h3>
          <CajaPartido torneo={torneo} partido={tercero} partidos={partidos} onCargar={cargar} />
        </div>
      )}

      {!individual && torneo.configLlave && (
        <ResumenClasificacion torneo={torneo} config={torneo.configLlave} partidosLlave={partidos} />
      )}

      <PiePaso
        izquierda={(
          <Boton variante="secundario" icono={<ArrowLeft size={18} />} onClick={() => actualizar((t) => ({ ...t, fase: individual ? 'parejas' : 'faseGrupos' }))}>
            {individual ? 'Jugadores' : 'Fase de grupos'}
          </Boton>
        )}
        derecha={(
          <Boton variante="secundario" icono={<RotateCcw size={18} />} onClick={() => void rearmar()} className="text-red-700 hover:border-red-700">
            Rearmar llave
          </Boton>
        )}
      />
    </section>
  );
}

// Resumen consultable de la clasificación con la llave ya armada: quién pasó y por qué,
// la comparación de los "mejores extra", y un aviso si las posiciones actuales de los grupos
// ya no coinciden con los clasificados que se usaron para armar la llave.
function ResumenClasificacion({ torneo, config, partidosLlave }: {
  torneo: Torneo;
  config: ConfigLlave;
  partidosLlave: PartidoLlave[];
}) {
  const [abierto, setAbierto] = useState(false);
  const clasifActuales = calcularClasificados(torneo.grupos, torneo.partidosGrupo, config);
  const seedsArmados = new Set(
    partidosLlave
      .filter((p) => p.ronda === 1)
      .flatMap((p) => [p.a, p.b])
      .filter((s): s is Extract<SlotLlave, { tipo: 'seed' }> => s !== null && s.tipo === 'seed')
      .map((s) => s.parejaId),
  );
  const desactualizada =
    clasifActuales.length !== seedsArmados.size || clasifActuales.some((c) => !seedsArmados.has(c.parejaId));

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left"
      >
        <ListChecks size={18} className="shrink-0 text-navy-700" aria-hidden />
        <span className="min-w-0 flex-1 font-display text-sm font-bold text-navy-700">Resumen de clasificación (quién pasó y por qué)</span>
        {desactualizada && <Insignia tono="atencion">Desactualizada</Insignia>}
        <ChevronDown size={18} aria-hidden className={cn('shrink-0 text-gray-500 transition-transform', abierto && 'rotate-180')} />
      </button>
      {abierto && (
        <div className="space-y-3 border-t border-gray-100 px-4 py-4">
          {desactualizada && (
            <Nota>
              Las posiciones actuales de los grupos ya no coinciden con los clasificados de esta llave
              (corregiste resultados después de armarla). Si corresponde, usá "Rearmar llave".
            </Nota>
          )}
          <p className="text-sm text-gray-600">
            Cruce de la ronda 1: el mejor seed juega contra el más bajo (1º de un grupo vs 2º del otro),
            evitando cruces del mismo grupo cuando se puede. Orden de seeds: todos los 1º (por sus números),
            después los 2º, después los mejores extra.
          </p>
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy-700">Así entraron</h3>
          <ListaOrden>
            {clasifActuales.map((c, i) => (
              <ItemOrden key={c.parejaId} n={i + 1}>
                <span className="mr-2 font-semibold">{nombreDe(torneo, c.parejaId)}</span>
                <Insignia>{c.puesto}º del grupo {c.grupoNombre}</Insignia>
              </ItemOrden>
            ))}
          </ListaOrden>
          {config.mejoresExtra > 0 && <ComparacionExtras torneo={torneo} config={config} />}
        </div>
      )}
    </section>
  );
}

function CajaPartido({ torneo, partido, partidos, onCargar, etiquetaCancha, procedenciaA, procedenciaB }: {
  torneo: Torneo;
  partido: PartidoLlave;
  partidos: PartidoLlave[];
  /** Mismo camino de antes (confirma borradosSiCorrijo antes de actualizar); ahora se llama una vez por resultado. */
  onCargar: (partido: PartidoLlave, a: number | null, b: number | null) => void | Promise<void>;
  etiquetaCancha?: string;
  procedenciaA?: string;
  procedenciaB?: string;
}) {
  const idA = resolverSlot(partido.a, partidos);
  const idB = resolverSlot(partido.b, partidos);
  const ganador = ganadorPartido(partido, partidos);
  const esBye = partido.a === null || partido.b === null;
  const jugable = !esBye && idA !== null && idB !== null;
  const invalido =
    partido.puntosA !== null && partido.puntosB !== null && !resultadoValido(partido.puntosA, partido.puntosB);
  const borrador = useBorradorMarcador(partido.puntosA, partido.puntosB, (a, b) => onCargar(partido, a, b));

  function etiqueta(slot: PartidoLlave['a'], id: string | null): string {
    if (slot === null) return 'BYE';
    if (id !== null) return nombreDe(torneo, id);
    if (slot.tipo === 'perdedorDe') return 'Perdedor de semi';
    return 'A definir';
  }

  function lado(l: 'a' | 'b') {
    const slot = l === 'a' ? partido.a : partido.b;
    const id = l === 'a' ? idA : idB;
    const proc = l === 'a' ? procedenciaA : procedenciaB;
    const gana = ganador !== null && ganador === id;
    const nombre = etiqueta(slot, id);
    return (
      <div className={`slot ${gana ? 'ganador' : ''}`}>
        <span className={cn('min-w-0', id === null && 'text-gray-500')}>
          {nombre}
          {proc && <> <span className="chip">{proc}</span></>}
        </span>
        {jugable && (
          <CajaPuntos
            valor={borrador.mostrado[l]}
            alCambiar={(t) => borrador.cambiar(l, t)}
            alTeclear={borrador.alTeclear}
            etiqueta={`Puntos de ${nombre}`}
            gana={gana && !borrador.sucio}
            sinGuardar={borrador.sucio}
          />
        )}
      </div>
    );
  }

  return (
    <div className="partido-llave" onBlur={jugable ? borrador.alSalirDeLaFila : undefined}>
      {etiquetaCancha && <div className="slot slot-cancha"><span className="chip chip-cancha">{etiquetaCancha}</span></div>}
      {lado('a')}
      {lado('b')}
      {jugable && borrador.sucio && (
        <div className="slot slot-guardar">
          <Boton anchoCompleto icono={<Check size={18} strokeWidth={3} />} onClick={() => void borrador.confirmar()}>
            Guardar resultado
          </Boton>
        </div>
      )}
      {invalido && !borrador.sucio && (
        <div className="slot">
          <span className="text-[13px] font-semibold text-red-700">
            {partido.puntosA === partido.puntosB ? 'Empate: no vale' : 'Resultado que no vale'}
          </span>
        </div>
      )}
    </div>
  );
}

/** Podio: tarjeta oscura (el lima va solo sobre fondo oscuro). */
function Campeon({ nombre, subcampeon, tercero, accion }: {
  nombre: string;
  subcampeon: string | null;
  tercero: string | null;
  accion?: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-navy-700 px-5 py-7 text-center text-white">
      <Trophy size={40} className="mx-auto text-lime-400" aria-hidden />
      <p className="mt-2 font-display text-[11px] font-bold uppercase tracking-[0.25em] text-white/70">Campeón</p>
      <h2 className="mt-1 break-words font-display text-2xl font-black uppercase leading-tight md:text-3xl">{nombre}</h2>
      {(subcampeon || tercero) && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-white/85">
          {subcampeon && <span className="inline-flex items-center gap-1.5"><Medal size={16} aria-hidden className="text-gray-300" /> {subcampeon}</span>}
          {tercero && <span className="inline-flex items-center gap-1.5"><Medal size={16} aria-hidden className="text-amber-500" /> {tercero}</span>}
        </div>
      )}
      {accion && <div className="mt-5">{accion}</div>}
    </div>
  );
}

function CampeonDeGrupoUnico({ torneo, actualizar }: PropsPaso) {
  const grupo = torneo.grupos[0];
  const filas = grupo ? calcularTabla(grupo.parejaIds, torneo.partidosGrupo) : [];
  return (
    <section>
      <Campeon
        nombre={filas[0] ? nombreDe(torneo, filas[0].parejaId) : '—'}
        subcampeon={filas[1] ? nombreDe(torneo, filas[1].parejaId) : null}
        tercero={filas[2] ? nombreDe(torneo, filas[2].parejaId) : null}
        accion={(
          <button
            type="button"
            onClick={() => actualizar((t) => ({ ...t, fase: 'faseGrupos' }))}
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-white/30 px-5 font-display text-sm font-bold text-white transition-colors hover:bg-white/10"
          >
            <ArrowLeft size={18} aria-hidden /> Volver a la tabla
          </button>
        )}
      />
    </section>
  );
}
