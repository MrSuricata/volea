import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ConfigPuntos, Escalon, Jugador, Torneo } from '../engine/tipos';
import { calcularRanking } from '../engine/ranking';
import { listarJugadoresPublicos, listarTorneosPublicos, obtenerConfigPublico } from './datos';
import { RkCargando, RkError } from './Estados';
import '../torneos.css';

const NOMBRE_ESCALON: Record<Escalon, string> = {
  CAMPEON: 'Campeón', FINALISTA: 'Finalista', SEMI: 'Semi', CUARTOS: 'Cuartos', OCTAVOS: 'Octavos', PARTICIPO: 'Participó',
};

type Estado = 'cargando' | 'ok' | 'error';

// Ranking público VOLEA: misma cuenta que el admin (calcularRanking, motor sin tocar) sobre
// los torneos que RLS deja ver (visible = true). Sin acciones de escritura ni "vincular".
export default function RankingPage() {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [mensajeError, setMensajeError] = useState('');
  const [torneos, setTorneos] = useState<Torneo[]>([]);
  const [jugadores, setJugadores] = useState<Jugador[]>([]);
  const [config, setConfig] = useState<ConfigPuntos | null>(null);
  const [historico, setHistorico] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const anio = new Date().getFullYear();

  const cargar = useCallback(async () => {
    setEstado('cargando');
    const [rt, rj, cfg] = await Promise.all([listarTorneosPublicos(), listarJugadoresPublicos(), obtenerConfigPublico()]);
    if (rt.error || rj.error) {
      setMensajeError(rt.error || rj.error || 'No se pudo cargar el ranking.');
      setEstado('error');
      return;
    }
    setTorneos(rt.torneos);
    setJugadores(rj.jugadores);
    setConfig(cfg);
    setEstado('ok');
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const filas = useMemo(() => {
    if (!config) return [];
    return calcularRanking(torneos, jugadores, config, historico ? undefined : { desde: `${anio}-01-01T00:00:00.000Z` });
  }, [torneos, jugadores, config, historico, anio]);

  if (estado === 'cargando') return <RkCargando texto="Cargando ranking…" />;
  if (estado === 'error') return <RkError mensaje={mensajeError} onReintentar={() => void cargar()} />;

  return (
    <div className="rk">
      <main className="contenedor">
        <header className="cabecera">
          <h1><span className="marca">RANKING</span> VOLEA</h1>
          <div className="acciones">
            <Link className="boton secundario" to="/torneos">Ver torneos</Link>
          </div>
        </header>

        <div className="acciones" style={{ marginBottom: 16 }}>
          <button className={`boton ${historico ? 'secundario' : ''}`} onClick={() => setHistorico(false)}>{anio}</button>
          <button className={`boton ${historico ? '' : 'secundario'}`} onClick={() => setHistorico(true)}>Histórico</button>
        </div>

        {filas.length === 0 ? (
          <p className="vacio">Todavía no hay puntos cargados{historico ? '' : ` en ${anio}`}. Volvé después del próximo torneo.</p>
        ) : (
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr><th>#</th><th className="nombre">Jugador</th><th>Puntos</th><th>Torneos</th></tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <Fragment key={f.jugadorId}>
                    <tr onClick={() => setAbierto(abierto === f.jugadorId ? null : f.jugadorId)} style={{ cursor: 'pointer' }}>
                      <td>{i + 1}</td>
                      <td className="nombre">{f.nombre}</td>
                      <td><strong>{f.puntos}</strong></td>
                      <td>{f.torneosJugados}</td>
                    </tr>
                    {abierto === f.jugadorId && (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'left', background: 'var(--navy-1)' }}>
                          {f.aportes.map((a, k) => (
                            <div key={k} style={{ padding: '2px 0', opacity: a.descartadoPorEvento ? 0.55 : 1 }}>
                              {a.torneoNombre} <span className="chip">Cat {a.categoria}</span> {NOMBRE_ESCALON[a.escalon]} →{' '}
                              <strong style={a.descartadoPorEvento ? { textDecoration: 'line-through' } : undefined}>{a.puntos}</strong>
                              {a.descartadoPorEvento ? ' (no cuenta: ya suma el mejor del mismo evento)' : ''}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
