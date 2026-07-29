import { useState } from 'react';
import type { PropsPaso } from '../TorneosApp';
import type { PartidoGrupo, Torneo } from '../engine/tipos';
import { resultadoValido } from '../engine/tipos';
import { calcularTabla } from '../engine/tabla';
import { ordenDeJuego } from '../engine/canchas';
import { nombreDe } from './util';
import { useDialogos } from './dialogos';

export default function PasoFaseGrupos({ torneo, actualizar }: PropsPaso) {
  const dialogos = useDialogos();
  const [vista, setVista] = useState<'rondas' | 'grupos'>('rondas');
  const canchas = torneo.canchas ?? 2;

  function cargarResultado(partidoId: string, puntosA: number | null, puntosB: number | null) {
    actualizar((t) => ({
      ...t,
      partidosGrupo: t.partidosGrupo.map((p) => (p.id === partidoId ? { ...p, puntosA, puntosB } : p)),
    }));
  }

  const total = torneo.partidosGrupo.length;
  const jugados = torneo.partidosGrupo.filter((p) => resultadoValido(p.puntosA, p.puntosB)).length;
  const faltan = total - jugados;

  async function irALlave() {
    if (faltan > 0) {
      const ok = await dialogos.confirmar({
        titulo: torneo.partidosLlave ? 'Ver la llave' : 'Armar la llave',
        mensaje: torneo.partidosLlave
          ? `Faltan ${faltan} partido${faltan > 1 ? 's' : ''} por jugar. ¿Ver la llave igual?`
          : `Faltan ${faltan} partido${faltan > 1 ? 's' : ''} por jugar y la tabla puede cambiar. ¿Armar la llave igual?`,
        textoConfirmar: torneo.partidosLlave ? 'Ver' : 'Armar',
      });
      if (!ok) return;
    }
    actualizar((t) => ({ ...t, fase: 'llave' }));
  }

  async function rearmarLlave() {
    const llave = torneo.partidosLlave;
    if (!llave) return;
    const teniaResultados = llave.some((p) => resultadoValido(p.puntosA, p.puntosB));
    const ok = await dialogos.confirmar({
      titulo: 'Rearmar llave',
      mensaje: teniaResultados
        ? 'La llave ya tiene partidos jugados: rearmarla borra esos resultados. ¿Seguir?'
        : '¿Rearmar la llave con las posiciones actuales?',
      textoConfirmar: 'Rearmar',
      peligro: teniaResultados,
    });
    if (!ok) return;
    actualizar((t) => ({ ...t, configLlave: null, partidosLlave: null, fase: 'llave' }));
  }

  const rondas = [...new Set(torneo.partidosGrupo.map((p) => p.ronda))].sort((a, b) => a - b);

  return (
    <section>
      <div className="carta acciones" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="acciones">
          <button className={`boton ${vista === 'rondas' ? '' : 'secundario'}`} onClick={() => setVista('rondas')}>
            Por rondas
          </button>
          <button className={`boton ${vista === 'grupos' ? '' : 'secundario'}`} onClick={() => setVista('grupos')}>
            Por grupo
          </button>
        </div>
        <label>
          Canchas:{' '}
          <select value={canchas} onChange={(e) => { const n = Number(e.target.value); actualizar((t) => ({ ...t, canchas: n })); }}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="chip">{jugados}/{total} jugados</span>
      </div>

      {torneo.partidosLlave && (
        <div className="aviso" role="alert">
          ⚠ La llave se armó con las posiciones de antes. Si corregiste algún resultado acá, rearmala para que tome
          las posiciones nuevas:{' '}
          <button className="boton secundario" onClick={rearmarLlave}>Rearmar llave</button>
        </div>
      )}

      {vista === 'rondas' &&
        rondas.map((r) => {
          const partidosDeLaRonda = torneo.partidosGrupo.filter((p) => p.ronda === r);
          const turnos = ordenDeJuego(partidosDeLaRonda, canchas);
          const partidoPorId = new Map(partidosDeLaRonda.map((p) => [p.id, p]));
          const maxTanda = turnos.length > 0 ? turnos[turnos.length - 1].tanda : 0;
          return (
            <div key={r} className="carta" style={{ marginTop: 12 }}>
              <div className="grupo-titulo"><h3>Ronda {r}</h3></div>
              {turnos.map((turno, i) => (
                <div key={turno.partidoId}>
                  {maxTanda > 1 && (i === 0 || turnos[i - 1].tanda !== turno.tanda) && (
                    <div className="tanda-titulo">Tanda {turno.tanda}</div>
                  )}
                  <FilaPartido
                    torneo={torneo}
                    partido={partidoPorId.get(turno.partidoId)!}
                    onCargar={cargarResultado}
                    conGrupo
                    cancha={turno.cancha}
                  />
                </div>
              ))}
            </div>
          );
        })}

      {vista === 'grupos' &&
        torneo.grupos.map((g) => (
          <div key={g.id} className="carta" style={{ marginTop: 12 }}>
            <div className="grupo-titulo"><h3>Grupo {g.nombre}</h3></div>
            <TablaGrupo torneo={torneo} grupoId={g.id} />
            {torneo.partidosGrupo
              .filter((p) => p.grupoId === g.id)
              .map((p) => (
                <FilaPartido key={p.id} torneo={torneo} partido={p} onCargar={cargarResultado} />
              ))}
          </div>
        ))}

      <footer className="pie-paso">
        <button className="boton secundario" onClick={() => actualizar((t) => ({ ...t, fase: 'grupos' }))}>← Grupos</button>
        <button className="boton" onClick={irALlave}>
          {torneo.partidosLlave ? 'Ver llave →' : 'Armar llave →'}
        </button>
      </footer>
    </section>
  );
}

function FilaPartido({ torneo, partido, onCargar, conGrupo, cancha }: {
  torneo: Torneo;
  partido: PartidoGrupo;
  onCargar: (id: string, a: number | null, b: number | null) => void;
  conGrupo?: boolean;
  cancha?: number;
}) {
  const grupo = torneo.grupos.find((g) => g.id === partido.grupoId);
  const valido = resultadoValido(partido.puntosA, partido.puntosB);
  const ganaA = valido && (partido.puntosA as number) > (partido.puntosB as number);
  const invalido = partido.puntosA !== null && partido.puntosB !== null && !valido;
  return (
    <div className="fila-partido">
      {cancha !== undefined && <span className="chip chip-cancha">Cancha {cancha}</span>}
      {conGrupo && grupo && <span className="chip">Grupo {grupo.nombre}</span>}
      <span className={`lado ${ganaA ? 'ganador' : ''}`}>{nombreDe(torneo, partido.aId)}</span>
      <input
        className="puntos" type="number" min={0} value={partido.puntosA ?? ''}
        onWheel={(e) => e.currentTarget.blur()}
        onChange={(e) => onCargar(partido.id, e.target.value === '' ? null : Number(e.target.value), partido.puntosB)}
      />
      <span>–</span>
      <input
        className="puntos" type="number" min={0} value={partido.puntosB ?? ''}
        onWheel={(e) => e.currentTarget.blur()}
        onChange={(e) => onCargar(partido.id, partido.puntosA, e.target.value === '' ? null : Number(e.target.value))}
      />
      <span className={`lado der ${valido && !ganaA ? 'ganador' : ''}`}>{nombreDe(torneo, partido.bId)}</span>
      {invalido && (
        <span className="chip" style={{ color: 'var(--rojo)' }}>
          {partido.puntosA === partido.puntosB ? 'empate no vale' : 'resultado no vale'}
        </span>
      )}
    </div>
  );
}

function TablaGrupo({ torneo, grupoId }: { torneo: Torneo; grupoId: string }) {
  const grupo = torneo.grupos.find((g) => g.id === grupoId);
  if (!grupo) return null;
  const filas = calcularTabla(grupo.parejaIds, torneo.partidosGrupo.filter((p) => p.grupoId === grupoId));
  return (
    <div className="tabla-scroll" style={{ marginBottom: 14 }}>
    <table>
      <thead>
        <tr>
          <th>#</th><th className="nombre">Pareja</th><th>PJ</th><th>PG</th><th>PP</th><th>PF</th><th>PC</th><th>Dif</th>
        </tr>
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
  );
}
