import { useMemo } from 'react';
import type { ConfigPuntos, Jugador, Torneo } from '../engine/tipos';
import { calcularRanking, reasignarJugador, unirJugadores } from '../engine/ranking';
import { useDialogos } from './dialogos';

type Props = {
  jugadores: Jugador[];
  torneos: Torneo[];
  config: ConfigPuntos;
  setJugadores: (js: Jugador[]) => void;
  setTorneos: (ts: Torneo[]) => void;
  onVolver: () => void;
};

export default function PantallaJugadores({ jugadores, torneos, config, setJugadores, setTorneos, onVolver }: Props) {
  const dialogos = useDialogos();
  const puntosPorJugador = useMemo(() => {
    const m = new Map<string, { puntos: number; torneos: number }>();
    for (const f of calcularRanking(torneos, jugadores, config)) m.set(f.jugadorId, { puntos: f.puntos, torneos: f.torneosJugados });
    return m;
  }, [torneos, jugadores, config]);

  async function renombrar(j: Jugador) {
    const nuevo = await dialogos.pedirTexto({ titulo: 'Renombrar jugador', valorInicial: j.nombre, placeholder: 'Nombre', textoConfirmar: 'Guardar' });
    if (!nuevo) return;
    setJugadores(jugadores.map((x) => (x.id === j.id ? { ...x, nombre: nuevo } : x)));
  }

  async function unirCon(absorbido: Jugador) {
    const otros = jugadores.filter((x) => x.id !== absorbido.id);
    if (otros.length === 0) return;
    const quedaId = await dialogos.elegirDeLista({
      titulo: `Unir "${absorbido.nombre}" con…`,
      mensaje: 'Los puntos y torneos se combinan en el jugador que elijas. No se puede deshacer.',
      opciones: otros.map((x) => ({ clave: x.id, etiqueta: x.nombre })),
      textoConfirmar: 'Unir',
    });
    if (!quedaId) return;
    setJugadores(unirJugadores(jugadores, quedaId, absorbido.id));
    setTorneos(reasignarJugador(torneos, absorbido.id, quedaId));
  }

  async function borrar(j: Jugador) {
    const ok = await dialogos.confirmar({ titulo: 'Borrar jugador', mensaje: `¿Borrar a "${j.nombre}" del padrón? Sus torneos no se tocan.`, textoConfirmar: 'Borrar', peligro: true });
    if (!ok) return;
    setJugadores(jugadores.filter((x) => x.id !== j.id));
  }

  const ordenados = [...jugadores].sort(
    (a, b) => (puntosPorJugador.get(b.id)?.puntos ?? 0) - (puntosPorJugador.get(a.id)?.puntos ?? 0) || a.nombre.localeCompare(b.nombre),
  );

  return (
    <main className="contenedor">
      <header className="cabecera">
        <button className="boton secundario" onClick={onVolver}>← Volver</button>
        <h1>Jugadores</h1>
      </header>
      {jugadores.length === 0 ? (
        <p className="vacio">El padrón está vacío. Se llena solo al vincular torneos al ranking.</p>
      ) : (
        <ul className="lista-torneos">
          {ordenados.map((j) => {
            const p = puntosPorJugador.get(j.id);
            return (
              <li key={j.id} className="carta">
                <span style={{ flex: 1 }}>
                  <strong>{j.nombre}</strong>
                  <br />
                  <span style={{ color: 'var(--texto-suave)', fontSize: '0.9rem' }}>
                    {p ? `${p.puntos} pts · ${p.torneos} torneos` : 'sin torneos'}
                    {j.alias?.length ? ` · alias: ${j.alias.join(', ')}` : ''}
                  </span>
                </span>
                <div className="acciones">
                  <button className="boton secundario" onClick={() => renombrar(j)}>Renombrar</button>
                  <button className="boton secundario" onClick={() => unirCon(j)}>Unir con…</button>
                  <button className="boton peligro" onClick={() => borrar(j)}>Borrar</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
