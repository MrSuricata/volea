/**
 * Fechas humanizadas para la Caja: "hoy 14:32" / "ayer 09:15" / "mar 5/8 · 14:32".
 * Todo se mira desde el reloj de Montevideo (UTC-3 fijo, sin horario de verano),
 * igual que el resto del admin. `ahoraMs` siempre se inyecta: nada de Date.now()
 * acá adentro, así los tests son deterministas.
 */

const TZ = 'America/Montevideo';

/** Día calendario (YYYY-MM-DD) de un instante, visto desde Montevideo. */
const diaEnMontevideo = (date: Date): string =>
  date.toLocaleDateString('en-CA', { timeZone: TZ });

const DIA_MS = 24 * 60 * 60 * 1000;

export const fechaHumana = (iso: string, ahoraMs: number): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;

  const hora = d.toLocaleTimeString('es-UY', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const dia = diaEnMontevideo(d);
  if (dia === diaEnMontevideo(new Date(ahoraMs))) return `hoy ${hora}`;
  // Montevideo no tiene DST, así que restar 24h cae siempre en el día calendario anterior.
  if (dia === diaEnMontevideo(new Date(ahoraMs - DIA_MS))) return `ayer ${hora}`;

  const diaSemana = d.toLocaleDateString('es-UY', { timeZone: TZ, weekday: 'short' });
  const diaMes = d.toLocaleDateString('es-UY', {
    timeZone: TZ,
    day: 'numeric',
    month: 'numeric',
  });
  return `${diaSemana} ${diaMes} · ${hora}`;
};
