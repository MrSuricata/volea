import { Fragment, useMemo, useState } from 'react';
import type { ConfigPuntos, Escalon, Jugador, Torneo } from '../engine/tipos';
import { calcularRanking } from '../engine/ranking';

const NOMBRE_ESCALON: Record<Escalon, string> = {
  CAMPEON: 'Campeón', FINALISTA: 'Finalista', SEMI: 'Semi', CUARTOS: 'Cuartos', OCTAVOS: 'Octavos', PARTICIPO: 'Participó',
};

type Props = {
  torneos: Torneo[];
  jugadores: Jugador[];
  config: ConfigPuntos;
  onVincular: (torneoId: string) => void;
  onVolver: () => void;
};

export default function PantallaRanking({ torneos, jugadores, config, onVincular, onVolver }: Props) {
  const [historico, setHistorico] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const anio = new Date().getFullYear();

  const filas = useMemo(
    () => calcularRanking(torneos, jugadores, config, historico ? undefined : { desde: `${anio}-01-01T00:00:00.000Z` }),
    [torneos, jugadores, config, historico, anio],
  );

  const pendientes = torneos.filter(
    (t) => t.fase === 'terminado' && t.cuentaParaRanking !== false && (!t.categoria || t.parejas.some((p) => !(p.jugadorIds && p.jugadorIds.length))),
  );

  return (
    <main className="contenedor">
      <header className="cabecera">
        <button className="boton secundario" onClick={onVolver}>← Volver</button>
        <h1><span className="marca">RANKING</span> VOLEA</h1>
      </header>

      <div className="acciones" style={{ marginBottom: 16 }}>
        <button className={`boton ${historico ? 'secundario' : ''}`} onClick={() => setHistorico(false)}>{anio}</button>
        <button className={`boton ${historico ? '' : 'secundario'}`} onClick={() => setHistorico(true)}>Histórico</button>
      </div>

      {pendientes.length > 0 && (
        <div className="aviso" role="alert">
          ⚠ {pendientes.length} torneo{pendientes.length > 1 ? 's' : ''} terminado{pendientes.length > 1 ? 's' : ''} todavía no suma{pendientes.length > 1 ? 'n' : ''} (falta categoría o vincular jugadores):
          <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            {pendientes.map((t) => (
              <li key={t.id} style={{ marginBottom: 4 }}>
                <strong>{t.nombre}</strong>{!t.categoria ? ' — sin categoría' : ' — jugadores sin vincular'}{' '}
                <button className="boton secundario" onClick={() => onVincular(t.id)}>Completar</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {filas.length === 0 ? (
        <p className="vacio">Todavía no hay puntos. Terminá un torneo, ponele categoría A/B y vinculá los jugadores.</p>
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
                          <div key={k} style={{ padding: '2px 0' }}>
                            {a.torneoNombre} <span className="chip">Cat {a.categoria}</span> {NOMBRE_ESCALON[a.escalon]} → <strong>{a.puntos}</strong>
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
  );
}
