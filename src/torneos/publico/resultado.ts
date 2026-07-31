import type { Torneo } from '../engine/tipos';
import { calcularTabla } from '../engine/tabla';
import { podio as podioLlave } from '../engine/llave';

export type Podio = { campeon: string | null; subcampeon: string | null; tercero: string | null };

// Resuelve el podio de un torneo para mostrarlo en público: reusa podio() de la llave
// cuando hay una armada (funciona para "en juego" y para "terminado" — mismo criterio que
// usa VerLlave en el admin para mostrar la carta de campeón antes de tocar "terminar").
// Si el torneo es de grupos con un único grupo y se declaró terminado SIN armar llave
// (ver CampeonDeGrupoUnico en PasoLlave.tsx), resuelve el podio con la tabla del grupo.
export function podioDeTorneo(torneo: Torneo): Podio {
  if (torneo.partidosLlave && torneo.partidosLlave.length > 0) {
    return podioLlave(torneo.partidosLlave);
  }
  if ((torneo.formato ?? 'grupos') !== 'individual' && torneo.fase === 'terminado' && torneo.grupos.length === 1) {
    const filas = calcularTabla(torneo.grupos[0].parejaIds, torneo.partidosGrupo);
    return {
      campeon: filas[0]?.parejaId ?? null,
      subcampeon: filas[1]?.parejaId ?? null,
      tercero: filas[2]?.parejaId ?? null,
    };
  }
  return { campeon: null, subcampeon: null, tercero: null };
}
