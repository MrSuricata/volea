import type { ConfigPuntos as TConfig } from '../engine/tipos';
import { CONFIG_PUNTOS_DEFAULT, ESCALONES } from '../engine/tipos';
import { puntosDe } from '../engine/ranking';

const NOMBRE_ESCALON = ['Campeón', 'Finalista', 'Semi', 'Cuartos', 'Octavos', 'Participó'];

type Props = { config: TConfig; setConfig: (c: TConfig) => void; onVolver: () => void };

export default function ConfigPuntos({ config, setConfig, onVolver }: Props) {
  function setEscalon(i: number, valor: number) {
    const escalera = [...config.escalera] as TConfig['escalera'];
    escalera[i] = Math.max(0, valor);
    setConfig({ ...config, escalera });
  }
  return (
    <main className="contenedor">
      <header className="cabecera">
        <button className="boton secundario" onClick={onVolver}>← Volver</button>
        <h1>Config de puntos</h1>
      </header>
      <div className="carta">
        <p>Editá los puntos de la categoría <strong>A</strong>. La <strong>B</strong> se calcula sola bajando los escalones que elijas (semi de B = cuartos de A con el default).</p>
        <label style={{ display: 'block', margin: '10px 0' }}>
          Escalones que baja la B:{' '}
          <input type="number" min={0} max={5} value={config.offsetB} onWheel={(e) => e.currentTarget.blur()}
            onChange={(e) => setConfig({ ...config, offsetB: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })} />
        </label>
        <div className="tabla-scroll">
          <table>
            <thead><tr><th className="nombre">Llegaste a…</th><th>A (editable)</th><th>B (auto)</th></tr></thead>
            <tbody>
              {ESCALONES.map((esc, i) => (
                <tr key={esc}>
                  <td className="nombre">{NOMBRE_ESCALON[i]}</td>
                  <td>
                    <input className="puntos" type="number" min={0} value={config.escalera[i]} onWheel={(e) => e.currentTarget.blur()}
                      onChange={(e) => setEscalon(i, Number(e.target.value) || 0)} />
                  </td>
                  <td><strong>{puntosDe(esc, 'B', config)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: 14, opacity: 0.85 }}>
          Reglas fijas: en torneos <strong>individuales</strong> (One Point Challenge) participar no da puntos — pagan solo
          las instancias de llave. Y si dos torneos de parejas comparten <strong>Evento</strong> (ej. la A y la B del mismo
          día), a cada jugador le cuenta solo el mejor de los dos.
        </p>
        <button className="boton secundario" style={{ marginTop: 4 }} onClick={() => setConfig({ ...CONFIG_PUNTOS_DEFAULT })}>Volver al default</button>
      </div>
    </main>
  );
}
