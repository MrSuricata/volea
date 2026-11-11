import { listarTorneosPublicos } from '../torneos/publico/datos';
import type { ListaTorneosResultado } from '../torneos/publico/datos';

// La home pide la lista de torneos desde dos lados (el aviso "en vivo" del hero y la
// sección de torneos más abajo): una sola consulta por visita, compartida. Si falló, el
// próximo que la pida vuelve a intentar.
let pendiente: Promise<ListaTorneosResultado> | null = null;
let pedidaEn = 0;
const VIGENCIA_MS = 60_000;

export function torneosPublicosCompartidos(): Promise<ListaTorneosResultado> {
  if (pendiente && Date.now() - pedidaEn < VIGENCIA_MS) return pendiente;
  pedidaEn = Date.now();
  const p = listarTorneosPublicos().then((r) => {
    if (r.error && pendiente === p) pendiente = null;
    return r;
  });
  pendiente = p;
  return p;
}
