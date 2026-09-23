// Formatos que comparten la tienda pública y el panel admin (que es un chunk aparte:
// vive acá y no en App.tsx para que el admin no tenga que importar App).

import type { Category, Product } from '../types';

export const formatPrice = (price: number): string => `$ ${price.toLocaleString('es-UY')}`;

export const TZ_UY = 'America/Montevideo';

/** "22 de agosto de 2026" — fecha larga de la ficha de un evento. */
export const fechaEventoLarga = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00Z`); // mediodía UTC: ver fechaTorneo (App.tsx)
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ_UY });
};

/** "22 al 24 de agosto de 2026" — rango en la ficha de un evento. */
export const rangoLargo = (desde: string, hasta?: string): string => {
  const ini = fechaEventoLarga(desde);
  if (!hasta || hasta === desde) return ini;
  const fin = fechaEventoLarga(hasta);
  // Mismo mes y año: se escribe solo el día de inicio ("22 al 24 de agosto de 2026").
  const resto = ini.slice(ini.indexOf(' de '));
  return fin.endsWith(resto) ? `${ini.replace(resto, '')} al ${fin}` : `${ini} al ${fin}`;
};

export const getTotalStock = (product: Product): number =>
  Object.values(product.stockBySize).reduce((sum, qty) => sum + qty, 0);

export const categoryLabel = (categories: Category[], id: string): string =>
  categories.find(c => c.id === id)?.name || id;
