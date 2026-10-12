import type { Torneo } from '../engine/tipos';
import type { FormatoLlave } from '../engine/formatoLlave';
import { conFormato, formatoDe, formatosPosibles } from '../engine/formatoLlave';
import { Campo, Entrada, Selector } from '../../admin/ui';

// Formato de la llave del cuadro. Se puede elegir antes de empezar o al terminar los grupos;
// En vivo y el gestor arman con este mismo formato.
export default function SelectorFormato({ torneo, actualizar }: {
  torneo: Torneo;
  actualizar: (cambio: (t: Torneo) => Torneo) => void;
}) {
  const opciones = formatosPosibles(torneo);
  const actual = formatoDe(torneo);
  const valor = opciones.some((o) => o.valor === actual) ? actual : 'auto';
  const ayuda = opciones.find((o) => o.valor === valor)?.ayuda;
  const llaveArmada = !!torneo.partidosLlave && torneo.partidosLlave.length > 0;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Campo
        etiqueta="Formato de la llave"
        ayuda={llaveArmada ? 'La llave ya está armada: para cambiar el formato, primero rearmala.' : ayuda}
      >
        <Selector
          value={valor}
          disabled={llaveArmada || torneo.grupos.length === 0}
          onChange={(e) => {
            const f = e.target.value as FormatoLlave;
            actualizar((t) => conFormato(t, f));
          }}
        >
          {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
        </Selector>
      </Campo>
      {valor === 'copas' && (
        <Campo etiqueta="Duplas a la Copa de Oro" ayuda={`El resto (${torneo.parejas.length - (torneo.copas?.oro ?? 0)}) va a la Copa de Plata.`}>
          <Entrada
            type="number"
            inputMode="numeric"
            min={2}
            max={Math.max(2, torneo.parejas.length - 2)}
            value={torneo.copas?.oro ?? ''}
            disabled={llaveArmada}
            onChange={(e) => {
              const n = Math.trunc(Number(e.target.value));
              if (!Number.isFinite(n) || n < 2 || n > torneo.parejas.length - 2) return;
              actualizar((t) => conFormato(t, 'copas', n));
            }}
          />
        </Campo>
      )}
    </div>
  );
}
