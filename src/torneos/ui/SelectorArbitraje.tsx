// Cómo cuenta el árbitro: rally o saque, a cuántos puntos y si es a un game o al mejor de 3.
import type { FormatoArbitraje, Torneo } from '../engine/tipos';
import { Campo, Selector } from '../../admin/ui';
import { formatoDe } from '../arbitraje/partido';

const valor = (f: FormatoArbitraje) => `${f.tipo}-${f.a}-${f.mejorDe}`;
const OPCIONES: { valor: string; texto: string }[] = [
  { valor: 'rally-15-1', texto: 'Rally a 15 · un game' }, { valor: 'rally-21-1', texto: 'Rally a 21 · un game' },
  { valor: 'rally-11-3', texto: 'Rally a 11 · mejor de 3' }, { valor: 'rally-15-3', texto: 'Rally a 15 · mejor de 3' },
  { valor: 'sideout-11-1', texto: 'Saque a 11 · un game' }, { valor: 'sideout-15-1', texto: 'Saque a 15 · un game' },
  { valor: 'sideout-11-3', texto: 'Saque a 11 · mejor de 3' },
];
const leer = (v: string): FormatoArbitraje => {
  const [tipo, a, m] = v.split('-');
  return { tipo: tipo as FormatoArbitraje['tipo'], a: Number(a) as FormatoArbitraje['a'], mejorDe: Number(m) as 1 | 3 };
};

export default function SelectorArbitraje({ torneo, actualizar }: { torneo: Torneo; actualizar: (c: (t: Torneo) => Torneo) => void }) {
  const tieneGrupos = torneo.partidosGrupo.length > 0 || torneo.grupos.length > 0;
  const cambiar = (fase: 'grupos' | 'llave', v: string) =>
    actualizar((t) => ({ ...t, arbitraje: { ...t.arbitraje, [fase]: leer(v) } }));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {tieneGrupos && (
        <Campo etiqueta="Árbitro · fase de grupos" ayuda="Cómo cuenta el tanteador en los grupos.">
          <Selector value={valor(formatoDe(torneo, 'grupo'))} onChange={(e) => cambiar('grupos', e.target.value)}>
            {OPCIONES.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
          </Selector>
        </Campo>
      )}
      <Campo etiqueta="Árbitro · llave" ayuda="Semis, final y demás cruces.">
        <Selector value={valor(formatoDe(torneo, 'llave'))} onChange={(e) => cambiar('llave', e.target.value)}>
          {OPCIONES.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
        </Selector>
      </Campo>
    </div>
  );
}
