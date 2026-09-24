import { ArrowLeft, RotateCcw } from 'lucide-react';
import type { ConfigPuntos as TConfig } from '../engine/tipos';
import { CONFIG_PUNTOS_DEFAULT, ESCALONES } from '../engine/tipos';
import { puntosDe } from '../engine/ranking';
import { useDialogos } from './dialogos';
import { Boton, EncabezadoPagina, Tarjeta } from '../../admin/ui';
import { Nota } from './piezas';

const NOMBRE_ESCALON = ['Campeón', 'Finalista', 'Semi', 'Cuartos', 'Octavos', 'Participó'];

type Props = { config: TConfig; setConfig: (c: TConfig) => void; onVolver: () => void };

export default function ConfigPuntos({ config, setConfig, onVolver }: Props) {
  const dialogos = useDialogos();
  function setEscalon(i: number, valor: number) {
    const escalera = [...config.escalera] as TConfig['escalera'];
    escalera[i] = Math.max(0, valor);
    setConfig({ ...config, escalera });
  }
  // Pisa toda la escalera (y el recalculo del ranking entero): se confirma antes.
  async function volverAlDefault() {
    const ok = await dialogos.confirmar({
      titulo: 'Volver al default',
      mensaje: `Reemplaza la escalera actual por la de fábrica (${CONFIG_PUNTOS_DEFAULT.escalera.join(' · ')}, la B baja ${CONFIG_PUNTOS_DEFAULT.offsetB}). El ranking se recalcula con esos puntos. ¿Seguir?`,
      textoConfirmar: 'Volver al default',
      peligro: true,
    });
    if (!ok) return;
    setConfig({ ...CONFIG_PUNTOS_DEFAULT });
  }
  const esDefault = config.offsetB === CONFIG_PUNTOS_DEFAULT.offsetB && config.escalera.every((v, i) => v === CONFIG_PUNTOS_DEFAULT.escalera[i]);
  return (
    <main className="contenedor">
      <Boton variante="fantasma" icono={<ArrowLeft size={18} />} onClick={onVolver} className="-ml-3 mb-1">Torneos</Boton>
      <EncabezadoPagina
        rotulo="Torneos"
        titulo="Puntos del ranking"
        descripcion={<>Editá los puntos de la categoría <strong className="text-navy-700">A</strong>. La <strong className="text-navy-700">B</strong> se calcula sola bajando los escalones que elijas (semi de B = cuartos de A con el default).</>}
      />
      <Tarjeta>
        <label className="flex flex-wrap items-center gap-3 text-[15px] font-semibold text-navy-700">
          Escalones que baja la B
          <input
            type="number" min={0} max={5} value={config.offsetB} onWheel={(e) => e.currentTarget.blur()}
            className="caja-puntos"
            onChange={(e) => setConfig({ ...config, offsetB: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })}
          />
        </label>
        <div className="tabla-scroll mt-4">
          <table>
            <thead><tr><th className="nombre">Llegaste a…</th><th>A (editable)</th><th>B (auto)</th></tr></thead>
            <tbody>
              {ESCALONES.map((esc, i) => (
                <tr key={esc}>
                  <td className="nombre">{NOMBRE_ESCALON[i]}</td>
                  <td>
                    <input
                      className="caja-puntos" type="number" min={0} value={config.escalera[i]} onWheel={(e) => e.currentTarget.blur()}
                      aria-label={`Puntos de ${NOMBRE_ESCALON[i]} en categoría A`}
                      onChange={(e) => setEscalon(i, Number(e.target.value) || 0)}
                    />
                  </td>
                  <td><strong className="font-display text-lg tabular-nums text-navy-700">{puntosDe(esc, 'B', config)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Nota tono="info" className="mt-4">
          Reglas fijas: en torneos <strong>individuales</strong> (One Point Challenge) participar no da puntos — pagan solo
          las instancias de llave. Y si dos torneos de parejas comparten <strong>Evento</strong> (ej. la A y la B del mismo
          día), a cada jugador le cuenta solo el mejor de los dos.
        </Nota>
        <Boton variante="secundario" icono={<RotateCcw size={18} />} className="mt-4" disabled={esDefault} onClick={() => void volverAlDefault()}>
          Volver al default
        </Boton>
      </Tarjeta>
    </main>
  );
}
