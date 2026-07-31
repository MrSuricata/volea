import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Grupo, PartidoGrupo, PartidoLlave, Torneo } from '../engine/tipos';
import { resultadoValido } from '../engine/tipos';
import { calcularTabla } from '../engine/tabla';
import { ganadorPartido, resolverSlot } from '../engine/llave';
import { nombreDe } from '../ui/util';
import { podioDeTorneo } from './resultado';
import { obtenerTorneoPublico } from './datos';
import { RkAviso, RkCargando, RkError } from './Estados';
import '../torneos.css';

const POLL_MS = 15000;

const ETIQUETA_FASE: Record<Torneo['fase'], string> = {
  parejas: 'Inscripción', grupos: 'Armando grupos', faseGrupos: 'Fase de grupos', llave: 'Llave en juego', terminado: 'Terminado',
};
const ETIQUETA_FORMATO: Record<string, string> = { grupos: 'Grupos + Llave', individual: 'One Point Challenge' };

type Estado = 'cargando' | 'ok' | 'no-encontrado' | 'error';
type Props = { onNombre?: (nombre: string) => void };

// Registro visual de un torneo: solo lectura (sin inputs, sin botones que muten nada).
// Mientras el torneo no está terminado, refresca el documento cada ~15s (setInterval +
// refetch puntual) y lo corta al terminar o al desmontar.
export default function TorneoDetallePage({ onNombre }: Props) {
  const { id } = useParams<{ id: string }>();
  const [estado, setEstado] = useState<Estado>('cargando');
  const [mensajeError, setMensajeError] = useState('');
  const [torneo, setTorneo] = useState<Torneo | null>(null);
  const onNombreRef = useRef(onNombre);
  onNombreRef.current = onNombre;

  const cargar = useCallback(async () => {
    if (!id) { setEstado('no-encontrado'); return; }
    setEstado('cargando');
    const r = await obtenerTorneoPublico(id);
    if (r.error) { setMensajeError(r.error); setEstado('error'); return; }
    if (!r.torneo) { setEstado('no-encontrado'); return; }
    setTorneo(r.torneo);
    onNombreRef.current?.(r.torneo.nombre);
    setEstado('ok');
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const enVivo = estado === 'ok' && torneo !== null && torneo.fase !== 'terminado';

  // Polling en vivo: arranca solo si ya cargó ok y el torneo no está terminado; se detiene
  // (no se re-arma) apenas fase pasa a 'terminado', y siempre se limpia al desmontar o
  // cambiar de torneo (AnimatedRoutes fuerza remount al cambiar de pathname).
  useEffect(() => {
    if (!id || estado !== 'ok' || !torneo || torneo.fase === 'terminado') return;
    const intervalo = window.setInterval(() => {
      void (async () => {
        const r = await obtenerTorneoPublico(id);
        if (r.torneo) {
          setTorneo(r.torneo);
          onNombreRef.current?.(r.torneo.nombre);
        } else if (r.error) {
          // Blip transitorio de red durante el polling: se loguea y se reintenta en el
          // próximo tick, sin pisar lo que el usuario ya está mirando con una pantalla de error.
          console.error('[torneos publico] fallo el refresco en vivo', r.error);
        }
        // r.torneo === null && r.error === null: el torneo se ocultó a mitad de la vista en
        // vivo. Se deja el último estado conocido en pantalla en vez de un "no encontrado" abrupto.
      })();
    }, POLL_MS);
    return () => window.clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- torneo se lee fresco vía closure en cada tick; solo id/estado/fase deciden si el intervalo debe (re)armarse.
  }, [id, estado, torneo?.fase]);

  if (estado === 'cargando') return <RkCargando texto="Cargando torneo…" />;
  if (estado === 'error') return <RkError mensaje={mensajeError} onReintentar={() => void cargar()} />;
  if (estado === 'no-encontrado' || !torneo) {
    return (
      <RkAviso titulo="Torneo no encontrado">
        <p>Puede que ya no esté publicado o que el link esté mal.</p>
        <Link className="boton secundario" to="/torneos" style={{ marginTop: 12, display: 'inline-block' }}>
          ← Ver torneos
        </Link>
      </RkAviso>
    );
  }

  const individual = (torneo.formato ?? 'grupos') === 'individual';
  const podio = podioDeTorneo(torneo);
  const tieneLlave = !!torneo.partidosLlave && torneo.partidosLlave.length > 0;
  const tieneGrupos = !individual && torneo.grupos.length > 0;

  return (
    <div className="rk">
      <main className="contenedor">
        <header className="cabecera">
          <Link className="boton secundario" to="/torneos">← Torneos</Link>
          <h1>{torneo.nombre}</h1>
          {enVivo && (
            <span className="en-vivo"><span className="punto-vivo" /> En vivo</span>
          )}
        </header>

        <div className="acciones" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
          <span className="chip">{ETIQUETA_FORMATO[torneo.formato ?? 'grupos']}</span>
          <span className="chip">{ETIQUETA_FASE[torneo.fase]}</span>
          {torneo.categoria && <span className="chip">Cat {torneo.categoria}</span>}
          {torneo.evento && !individual && <span className="chip">Evento {torneo.evento}</span>}
        </div>

        {podio.campeon && (
          <div className="carta campeon">
            <div style={{ fontSize: '3rem' }}>🏆</div>
            <h2>{nombreDe(torneo, podio.campeon)}</h2>
            <p>
              {podio.subcampeon && <>🥈 {nombreDe(torneo, podio.subcampeon)}</>}
              {podio.tercero && <> · 🥉 {nombreDe(torneo, podio.tercero)}</>}
            </p>
          </div>
        )}

        {tieneGrupos && torneo.grupos.map((g) => <GrupoPublico key={g.id} torneo={torneo} grupo={g} />)}

        {tieneLlave && <LlavePublica torneo={torneo} />}

        {!tieneGrupos && !tieneLlave && (
          <p className="vacio">
            {individual ? 'La llave todavía no se armó. ' : 'El torneo todavía no tiene grupos armados. '}
            {torneo.parejas.length} {individual ? 'jugador' : 'pareja'}{torneo.parejas.length === 1 ? '' : 's'} anotad
            {individual ? (torneo.parejas.length === 1 ? 'o' : 'os') : (torneo.parejas.length === 1 ? 'a' : 'as')}.
          </p>
        )}
      </main>
    </div>
  );
}

function GrupoPublico({ torneo, grupo }: { torneo: Torneo; grupo: Grupo }) {
  const partidos = torneo.partidosGrupo.filter((p) => p.grupoId === grupo.id);
  const filas = calcularTabla(grupo.parejaIds, partidos);
  return (
    <div className="carta" style={{ marginTop: 12 }}>
      <div className="grupo-titulo"><h3>Grupo {grupo.nombre}</h3></div>
      <div className="tabla-scroll" style={{ marginBottom: 14 }}>
        <table>
          <thead>
            <tr><th>#</th><th className="nombre">Pareja</th><th>PJ</th><th>PG</th><th>PP</th><th>PF</th><th>PC</th><th>Dif</th></tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.parejaId}>
                <td>{f.posicion}{f.desempatePorSorteo ? '*' : ''}</td>
                <td className="nombre">{nombreDe(torneo, f.parejaId)}</td>
                <td>{f.pj}</td><td>{f.pg}</td><td>{f.pp}</td><td>{f.pf}</td><td>{f.pc}</td>
                <td>{f.dif > 0 ? `+${f.dif}` : f.dif}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {partidos.length === 0 ? (
        <p className="vacio" style={{ padding: '10px 0' }}>Sin partidos cargados todavía.</p>
      ) : (
        partidos.map((p) => <FilaResultado key={p.id} torneo={torneo} partido={p} />)
      )}
    </div>
  );
}

function FilaResultado({ torneo, partido }: { torneo: Torneo; partido: PartidoGrupo }) {
  const valido = resultadoValido(partido.puntosA, partido.puntosB);
  const ganaA = valido && (partido.puntosA as number) > (partido.puntosB as number);
  return (
    <div className="fila-partido">
      <span className={`lado ${ganaA ? 'ganador' : ''}`}>{nombreDe(torneo, partido.aId)}</span>
      <span className="chip">{valido ? `${partido.puntosA} – ${partido.puntosB}` : 'sin jugar'}</span>
      <span className={`lado der ${valido && !ganaA ? 'ganador' : ''}`}>{nombreDe(torneo, partido.bId)}</span>
    </div>
  );
}

function LlavePublica({ torneo }: { torneo: Torneo }) {
  const individual = (torneo.formato ?? 'grupos') === 'individual';
  const partidos = torneo.partidosLlave as PartidoLlave[];
  const maxRonda = Math.max(...partidos.filter((p) => !p.esTercerPuesto).map((p) => p.ronda));
  const rondas = Array.from({ length: maxRonda }, (_, i) => i + 1);
  const tercero = partidos.find((p) => p.esTercerPuesto);

  // Procedencia "2º B" por pareja según la tabla actual de su grupo (solo formato grupos).
  const procedencia = new Map<string, string>();
  if (!individual) {
    for (const g of torneo.grupos) {
      const filas = calcularTabla(g.parejaIds, torneo.partidosGrupo.filter((p) => p.grupoId === g.id));
      for (const f of filas) procedencia.set(f.parejaId, `${f.posicion}º ${g.nombre}`);
    }
  }

  function nombreRonda(r: number): string {
    const desdeElFinal = maxRonda - r;
    if (desdeElFinal === 0) return 'Final';
    if (individual) return `Ronda ${r}`;
    if (desdeElFinal === 1) return 'Semifinales';
    if (desdeElFinal === 2) return 'Cuartos';
    if (desdeElFinal === 3) return 'Octavos';
    return `Ronda ${r}`;
  }

  return (
    <>
      <div className="llave">
        {rondas.map((r) => {
          const matchesDeLaRonda = partidos
            .filter((p) => !p.esTercerPuesto && p.ronda === r)
            .sort((a, b) => a.posicion - b.posicion);
          return (
            <div key={r} className="ronda-llave">
              <h3 style={{ textAlign: 'center', margin: '0 0 4px' }}>{nombreRonda(r)}</h3>
              {matchesDeLaRonda.map((p) => {
                const procA = r === 1 && p.a?.tipo === 'seed' ? procedencia.get(p.a.parejaId) : undefined;
                const procB = r === 1 && p.b?.tipo === 'seed' ? procedencia.get(p.b.parejaId) : undefined;
                return (
                  <CajaPartidoPublica
                    key={p.id}
                    torneo={torneo}
                    partido={p}
                    partidos={partidos}
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
          <CajaPartidoPublica torneo={torneo} partido={tercero} partidos={partidos} />
        </div>
      )}
    </>
  );
}

function CajaPartidoPublica({ torneo, partido, partidos, procedenciaA, procedenciaB }: {
  torneo: Torneo;
  partido: PartidoLlave;
  partidos: PartidoLlave[];
  procedenciaA?: string;
  procedenciaB?: string;
}) {
  const idA = resolverSlot(partido.a, partidos);
  const idB = resolverSlot(partido.b, partidos);
  const ganador = ganadorPartido(partido, partidos);

  function etiqueta(slot: PartidoLlave['a'], id: string | null): string {
    if (slot === null) return 'BYE';
    if (id !== null) return nombreDe(torneo, id);
    if (slot.tipo === 'perdedorDe') return 'Perdedor de semi';
    return 'A definir';
  }

  return (
    <div className="partido-llave">
      <div className={`slot ${ganador !== null && ganador === idA ? 'ganador' : ''}`}>
        <span>
          {etiqueta(partido.a, idA)}
          {procedenciaA && <> <span className="chip">{procedenciaA}</span></>}
        </span>
        {idA !== null && partido.puntosA !== null && <span className="puntaje-llave">{partido.puntosA}</span>}
      </div>
      <div className={`slot ${ganador !== null && ganador === idB ? 'ganador' : ''}`}>
        <span>
          {etiqueta(partido.b, idB)}
          {procedenciaB && <> <span className="chip">{procedenciaB}</span></>}
        </span>
        {idB !== null && partido.puntosB !== null && <span className="puntaje-llave">{partido.puntosB}</span>}
      </div>
    </div>
  );
}
