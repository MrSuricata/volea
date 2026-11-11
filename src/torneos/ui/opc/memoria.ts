// Dónde estaba el organizador en cada llave (vista, cruce, ronda), para que al saltar del OPC
// masculino al femenino y volver siga en el mismo cruce. Es una comodidad de este equipo: vive
// en memoria y en sessionStorage (si el navegador lo deja), nunca en el torneo guardado.
export type Vista = 'cruce' | 'ronda' | 'cuadro';
export type Lugar = { vista?: Vista; cruceId?: string | null; ronda?: number };

const CLAVE = 'volea-opc:lugar';
let cache: Record<string, Lugar> | null = null;

function todo(): Record<string, Lugar> {
  if (cache) return cache;
  try {
    const crudo = sessionStorage.getItem(CLAVE);
    const dato = crudo ? (JSON.parse(crudo) as unknown) : null;
    cache = dato && typeof dato === 'object' ? (dato as Record<string, Lugar>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

export function leerLugar(torneoId: string): Lugar {
  return todo()[torneoId] ?? {};
}

export function guardarLugar(torneoId: string, lugar: Lugar): void {
  const t = todo();
  t[torneoId] = lugar;
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(t));
  } catch { /* sin almacenamiento: queda en memoria */ }
}
