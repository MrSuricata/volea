// Ubicación de los clubes (mapa de /clubes). Antes latitud y longitud arrancaban en
// -34,9 / -56,2 y eran "obligatorias": un club nuevo se guardaba solo en el centro de
// Montevideo sin que nadie lo notara. Ahora arrancan vacías y se pueden completar
// pegando lo que da Google Maps (link largo o los números del pin).

export type Coordenadas = { lat: number; lng: number };

export type LecturaCoordenadas = ({ ok: true } & Coordenadas) | { ok: false; error: string };

/** Punto que usaba el formulario viejo: si un club lo tiene, casi seguro nunca se ubicó. */
export const PUNTO_POR_DEFECTO: Coordenadas = { lat: -34.9, lng: -56.2 };

export const esPuntoPorDefecto = ({ lat, lng }: Coordenadas): boolean =>
  lat === PUNTO_POR_DEFECTO.lat && lng === PUNTO_POR_DEFECTO.lng;

const redondear = (n: number) => Math.round(n * 1e6) / 1e6; // ~10 cm: sobra

function armar(lat: number, lng: number): LecturaCoordenadas {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: 'No encontré dos números.' };
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, error: 'Esos números no son una ubicación (la latitud va de -90 a 90 y la longitud de -180 a 180).' };
  }
  return { ok: true, lat: redondear(lat), lng: redondear(lng) };
}

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;

/** "34°54'04.0"S 56°09'52.2"W" (lo que muestra la ficha del lugar en Google Maps). */
function leerGrados(texto: string): LecturaCoordenadas | null {
  const parte = String.raw`(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:["″]|'')?\s*`;
  const m = texto.match(new RegExp(`${parte}([NS])[\\s,;]+${parte}([EOW])`, 'i'));
  if (!m) return null;
  const decimal = (g: string, min: string, seg: string) => Number(g) + Number(min) / 60 + Number(seg.replace(',', '.')) / 3600;
  const lat = decimal(m[1], m[2], m[3]) * (m[4].toUpperCase() === 'S' ? -1 : 1);
  const lng = decimal(m[5], m[6], m[7]) * (m[8].toUpperCase() === 'E' ? 1 : -1);
  return armar(lat, lng);
}

/**
 * Lee una ubicación pegada: link largo de Google Maps, "lat, lng" (el pin del celular
 * copia "-34.901100, -56.164500") o grados/minutos/segundos.
 */
export function leerCoordenadas(entrada: string): LecturaCoordenadas {
  const texto = entrada.trim();
  if (!texto) return { ok: false, error: 'Pegá un link de Google Maps o las coordenadas.' };

  // Los links cortos de "Compartir" no traen los números: habría que abrirlos (y el
  // navegador no deja seguir la redirección desde el panel).
  if (/(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(texto)) {
    return {
      ok: false,
      error: 'Ese es un link corto de "Compartir" y no trae la ubicación. Abrilo, mantené apretado el pin y copiá los números que aparecen (ej. -34.9011, -56.1645).',
    };
  }

  let t = texto;
  try { t = decodeURIComponent(texto); } catch { /* URL con % sueltos: se lee tal cual */ }

  // 1) !3d…!4d…: el pin exacto del lugar (el @ de más abajo es el centro de la vista).
  const pin = t.match(new RegExp(`!3d${NUM}!4d${NUM}`));
  if (pin) return armar(Number(pin[1]), Number(pin[2]));

  // 2) Parámetros ?q= / ?query= / ?ll= / destination= … y geo:lat,lng
  const param = t.match(new RegExp(String.raw`(?:[?&](?:q|query|ll|sll|center|destination|daddr)=|geo:)${NUM}\s*,\s*${NUM}`, 'i'));
  if (param) return armar(Number(param[1]), Number(param[2]));

  // 3) /@lat,lng,17z
  const arroba = t.match(new RegExp(`@${NUM},${NUM}`));
  if (arroba) return armar(Number(arroba[1]), Number(arroba[2]));

  // 4) Grados, minutos y segundos.
  const grados = leerGrados(t);
  if (grados) return grados;

  // 5) Dos números sueltos: "-34.9011, -56.1645" · "-34.9011 -56.1645" · "-34,9011; -56,1645"
  const conPunto = t.match(new RegExp(String.raw`^\(?${NUM}(\s*[,;]\s*|\s+)${NUM}\)?$`));
  // "-34,9" sin decimales ni espacio es un número con coma, no un par: mejor no adivinar.
  if (conPunto && ((conPunto[1] + conPunto[3]).includes('.') || /\s/.test(conPunto[2]))) {
    return armar(Number(conPunto[1]), Number(conPunto[3]));
  }
  const conComa = t.match(/^\(?(-?\d{1,3},\d+)\s*(?:;\s*|\s+)(-?\d{1,3},\d+)\)?$/);
  if (conComa) return armar(Number(conComa[1].replace(',', '.')), Number(conComa[2].replace(',', '.')));

  return { ok: false, error: 'No encontré la ubicación. Pegá el link largo de Google Maps o los números del pin (ej. -34.9011, -56.1645).' };
}

/** Un número de coordenada tipeado a mano: acepta coma o punto decimal. null = inválido. */
export function leerNumeroCoordenada(texto: string): number | null {
  const limpio = texto.trim().replace(/[−–]/g, '-').replace(',', '.');
  if (!/^-?\d{1,3}(?:\.\d+)?$/.test(limpio)) return null;
  return Number(limpio);
}

/**
 * Los clubes están en Uruguay, Argentina, Chile o Brasil. Un punto fuera de Sudamérica
 * casi siempre es latitud y longitud al revés (o un signo menos que se perdió).
 */
export const fueraDeSudamerica = ({ lat, lng }: Coordenadas): boolean =>
  lat < -56 || lat > 13 || lng < -82 || lng > -34;

/** Link para chequear el pin: el mismo que arma el botón de la ficha pública del club. */
export const linkMapa = ({ lat, lng }: Coordenadas): string =>
  `https://www.google.com/maps?q=${lat},${lng}`;
