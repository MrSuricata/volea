import { useState } from 'react';
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
    <section>
      <div className="carta">
        <h2>Armar la llave</h2>
        <p>Los jugadores se emparejan en el orden de abajo (1 vs 2, 3 vs 4…). Sorteá si querés cambiarlo.</p>
        <div className="acciones">
          <button className="boton secundario" onClick={sortear}>🎲 Sortear orden</button>
          <button className="boton" onClick={armar}>Armar llave 🎯</button>
        </div>
      </div>

      <div className="carta" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Así arranca la ronda 1</h3>
        <ol style={{ margin: 0, paddingLeft: 24, lineHeight: 1.9 }}>
          {pares.map(([a, b], i) => (
            <li key={i}>
              <strong>{nombreDe(torneo, a)}</strong> vs <strong>{nombreDe(torneo, b)}</strong>
            </li>
          ))}
        </ol>
        {zafa && (
          <p className="aviso" style={{ marginTop: 10 }}>
            ⚠ {nombreDe(torneo, zafa)} zafa la ronda 1 (número impar) y entra directo a la ronda 2.
          </p>
        )}
      </div>

      <footer className="pie-paso">
        <button className="boton secundario" onClick={() => actualizar((t) => ({ ...t, fase: 'parejas' }))}>
          ← Jugadores
        </button>
        <span />
      </footer>
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
    <section>
      <div className="carta">
        <h2>¿Cómo se arma la llave?</h2>
        <p>Elegí cuántos clasifican. La primera es la recomendada: la llave más justa con estos grupos.</p>
        <div className="opciones-clasificacion">
          {opciones.map((o, i) => (
            <label key={`${o.porGrupo}-${o.mejoresExtra}`} className={`opcion-clasificacion ${elegida === i ? 'elegida' : ''}`}>
              <input type="radio" name="opcion" checked={elegida === i} onChange={() => elegirOpcion(i)} />
              <span>
                {i === 0 && (
                  <span className="chip" style={{ background: 'var(--lima)', color: '#001f3f' }}>Recomendada</span>
                )}{' '}
                {o.descripcion}
              </span>
            </label>
          ))}
        </div>
        <label style={{ display: 'block', marginTop: 8 }}>
          <input
            type="checkbox"
            checked={tercerPuesto && !!opcion && opcion.tamanoLlave >= 4}
            disabled={!opcion || opcion.tamanoLlave < 4}
            onChange={(e) => setTercerPuesto(e.target.checked)}
          />{' '}
          Jugar partido por el 3er puesto
        </label>
      </div>

      {opcion && clasificados.length > 0 && (
        <div className="carta" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Así entran (orden de seed)</h3>
          <ol style={{ margin: 0, paddingLeft: 24, lineHeight: 1.9 }}>
            {clasificados.map((c) => (
              <li key={c.parejaId}>
                <strong>{nombreDe(torneo, c.parejaId)}</strong>{' '}
                <span className="chip">{c.puesto}º del grupo {c.grupoNombre}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {opcion && opcion.mejoresExtra > 0 && (
        <SelectorExtras
          torneo={torneo}
          config={{ porGrupo: opcion.porGrupo, mejoresExtra: opcion.mejoresExtra }}
          elegidos={extrasElegidos}
          onToggle={toggleExtra}
        />
      )}

      <footer className="pie-paso">
        <button className="boton secundario" onClick={() => actualizar((t) => ({ ...t, fase: 'faseGrupos' }))}>
          ← Fase de grupos
        </button>
        <div className="acciones">
          {esGrupoUnico && (
            <button className="boton secundario" onClick={terminarSinLlave}>Terminar sin llave</button>
          )}
          <button className="boton" disabled={!opcion || !extrasCompletos} onClick={armar}>
            {extrasCompletos ? 'Armar llave 🎯' : `Elegí ${opcion?.mejoresExtra ?? 0} para armar`}
          </button>
        </div>
      </footer>
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
    <div className="carta" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>¿Qué {puesto}º entra? (mejores {PUESTO_PLURAL[puesto] ?? `${puesto}ºs`})</h3>
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
                <td>
                  {c.entra
                    ? <span className="chip chip-cancha">ENTRA</span>
                    : <span className="chip">afuera</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {empateEnCorte && (
        <p className="aviso" style={{ marginTop: 10 }}>
          ⚠ Empate total entre <strong>{nombreDe(torneo, candidatos[corte - 1].parejaId)}</strong> y{' '}
          <strong>{nombreDe(torneo, candidatos[corte].parejaId)}</strong> (mismas victorias y mismos puntos):
          entra el del grupo {candidatos[corte - 1].grupoNombre} por orden de grupos (A antes que B).
        </p>
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
    <div className="carta" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>
        ¿Qué {puesto}º entra? Elegí {config.mejoresExtra} (mejores {PUESTO_PLURAL[puesto] ?? `${puesto}ºs`})
      </h3>
      {hayEmpate && (
        <p className="aviso">
          ⚠ Hay empatados en el corte. Definilo en la cancha (sorteo, piedra-papel-tijera o partido a 11)
          y marcá acá quién pasa.
        </p>
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
      <p style={{ color: faltan === 0 ? 'var(--lima)' : 'var(--rojo)', marginTop: 8, fontWeight: 700 }}>
        Elegidos: {elegidos.length} / {config.mejoresExtra}
        {faltan > 0 && ` — falta${faltan > 1 ? 'n' : ''} ${faltan}`}
        {faltan < 0 && ` — sacá ${-faltan}`}
      </p>
    </div>
  );
}

function VerLlave({ torneo, actualizar }: PropsPaso) {
  const dialogos = useDialogos();
  const individual = (torneo.formato ?? 'grupos') === 'individual';
  const partidos = torneo.partidosLlave as PartidoLlave[];
  const resultado = podio(partidos);
  const maxRonda = Math.max(...partidos.filter((p) => !p.esTercerPuesto).map((p) => p.ronda));
  const rondas = Array.from({ length: maxRonda }, (_, i) => i + 1);
  const tercero = partidos.find((p) => p.esTercerPuesto);

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

  return (
    <section>
      {resultado.campeon && (
        <div className="carta campeon">
          <div style={{ fontSize: '3rem' }}>🏆</div>
          <h2>{nombreDe(torneo, resultado.campeon)}</h2>
          <p>
            {resultado.subcampeon && <>🥈 {nombreDe(torneo, resultado.subcampeon)}</>}
            {resultado.tercero && <> · 🥉 {nombreDe(torneo, resultado.tercero)}</>}
          </p>
          {torneo.fase !== 'terminado' && (
            <button className="boton" onClick={() => actualizar((t) => ({ ...t, fase: 'terminado' }))}>
              Dar por terminado el torneo
            </button>
          )}
        </div>
      )}

      <div className="llave">
        {rondas.map((r) => {
          const matchesDeLaRonda = partidos
            .filter((p) => !p.esTercerPuesto && p.ronda === r)
            .sort((a, b) => a.posicion - b.posicion);
          const canchas = torneo.canchas ?? 2;
          const turnos =
            !individual && matchesDeLaRonda.length >= 2
              ? ordenDeJuego(matchesDeLaRonda.map((m) => ({ id: m.id, grupoId: '' })), canchas)
              : [];
          const turnoPorId = new Map(turnos.map((t) => [t.partidoId, t]));
          return (
            <div key={r} className="ronda-llave">
              <h3 style={{ textAlign: 'center', margin: '0 0 4px' }}>{nombreRonda(r)}</h3>
              {matchesDeLaRonda.map((p) => {
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
              })}
            </div>
          );
        })}
      </div>

      {tercero && (
        <div className="carta" style={{ marginTop: 8, maxWidth: 430 }}>
          <div className="grupo-titulo"><h3>3er puesto</h3></div>
          <CajaPartido torneo={torneo} partido={tercero} partidos={partidos} onCargar={cargar} />
        </div>
      )}

      {!individual && torneo.configLlave && (
        <ResumenClasificacion torneo={torneo} config={torneo.configLlave} partidosLlave={partidos} />
      )}

      <footer className="pie-paso">
        <button className="boton secundario" onClick={() => actualizar((t) => ({ ...t, fase: individual ? 'parejas' : 'faseGrupos' }))}>
          {individual ? '← Jugadores' : '← Fase de grupos'}
        </button>
        <button className="boton peligro" onClick={rearmar}>Rearmar llave</button>
      </footer>
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
    <div className="carta" style={{ marginTop: 8 }}>
      <button className="boton secundario" onClick={() => setAbierto((a) => !a)}>
        {abierto ? 'Ocultar resumen de clasificación' : '📋 Resumen de clasificación (quién pasó y por qué)'}
      </button>
      {abierto && (
        <div style={{ marginTop: 12 }}>
          {desactualizada && (
            <p className="aviso" role="alert">
              ⚠ Las posiciones actuales de los grupos ya no coinciden con los clasificados de esta llave
              (corregiste resultados después de armarla). Si corresponde, usá "Rearmar llave".
            </p>
          )}
          <p style={{ color: 'var(--texto-suave)', marginTop: 4 }}>
            Cruce de la ronda 1: el mejor seed juega contra el más bajo (1º de un grupo vs 2º del otro),
            evitando cruces del mismo grupo cuando se puede. Orden de seeds: todos los 1º (por sus números),
            después los 2º, después los mejores extra.
          </p>
          <h3 style={{ marginBottom: 4 }}>Así entraron</h3>
          <ol style={{ margin: 0, paddingLeft: 24, lineHeight: 1.9 }}>
            {clasifActuales.map((c) => (
              <li key={c.parejaId}>
                <strong>{nombreDe(torneo, c.parejaId)}</strong>{' '}
                <span className="chip">{c.puesto}º del grupo {c.grupoNombre}</span>
              </li>
            ))}
          </ol>
          {config.mejoresExtra > 0 && (
            <div style={{ marginTop: 4 }}>
              <ComparacionExtras torneo={torneo} config={config} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CajaPartido({ torneo, partido, partidos, onCargar, etiquetaCancha, procedenciaA, procedenciaB }: {
  torneo: Torneo;
  partido: PartidoLlave;
  partidos: PartidoLlave[];
  onCargar: (partido: PartidoLlave, a: number | null, b: number | null) => void;
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

  function etiqueta(slot: PartidoLlave['a'], id: string | null): string {
    if (slot === null) return 'BYE';
    if (id !== null) return nombreDe(torneo, id);
    if (slot.tipo === 'perdedorDe') return 'Perdedor de semi';
    return 'A definir';
  }

  return (
    <div className="partido-llave">
      {etiquetaCancha && <div className="slot slot-cancha"><span className="chip chip-cancha">{etiquetaCancha}</span></div>}
      <div className={`slot ${ganador !== null && ganador === idA ? 'ganador' : ''}`}>
        <span>
          {etiqueta(partido.a, idA)}
          {procedenciaA && <> <span className="chip">{procedenciaA}</span></>}
        </span>
        {jugable && (
          <input
            className="puntos" type="number" min={0} value={partido.puntosA ?? ''}
            onWheel={(e) => e.currentTarget.blur()}
            onChange={(e) => onCargar(partido, e.target.value === '' ? null : Number(e.target.value), partido.puntosB)}
          />
        )}
      </div>
      <div className={`slot ${ganador !== null && ganador === idB ? 'ganador' : ''}`}>
        <span>
          {etiqueta(partido.b, idB)}
          {procedenciaB && <> <span className="chip">{procedenciaB}</span></>}
        </span>
        {jugable && (
          <input
            className="puntos" type="number" min={0} value={partido.puntosB ?? ''}
            onWheel={(e) => e.currentTarget.blur()}
            onChange={(e) => onCargar(partido, partido.puntosA, e.target.value === '' ? null : Number(e.target.value))}
          />
        )}
      </div>
      {invalido && (
        <div className="slot">
          <span className="chip" style={{ color: 'var(--rojo)' }}>
            {partido.puntosA === partido.puntosB ? 'empate no vale' : 'resultado no vale'}
          </span>
        </div>
      )}
    </div>
  );
}

function CampeonDeGrupoUnico({ torneo, actualizar }: PropsPaso) {
  const grupo = torneo.grupos[0];
  const filas = grupo ? calcularTabla(grupo.parejaIds, torneo.partidosGrupo) : [];
  return (
    <section>
      <div className="carta campeon">
        <div style={{ fontSize: '3rem' }}>🏆</div>
        <h2>{filas[0] ? nombreDe(torneo, filas[0].parejaId) : '—'}</h2>
        <p>
          {filas[1] && <>🥈 {nombreDe(torneo, filas[1].parejaId)}</>}
          {filas[2] && <> · 🥉 {nombreDe(torneo, filas[2].parejaId)}</>}
        </p>
        <button className="boton secundario" onClick={() => actualizar((t) => ({ ...t, fase: 'faseGrupos' }))}>
          ← Volver a la tabla
        </button>
      </div>
    </section>
  );
}
