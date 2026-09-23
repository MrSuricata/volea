// Leaflet (147 KB de JS + CSS) solo lo usa /mapa. Antes iba en el <head> de todas las
// páginas; ahora se pide la primera vez que alguien abre el mapa y queda en memoria.
// Mismos archivos self-hosted de /vendor/leaflet (1.9.4, verificados contra SRI).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Leaflet = any;

let pendiente: Promise<Leaflet> | null = null;

export function cargarLeaflet(): Promise<Leaflet> {
  const w = window as unknown as { L?: Leaflet };
  if (w.L) return Promise.resolve(w.L);
  if (pendiente) return pendiente;

  if (!document.querySelector('link[data-leaflet]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/leaflet/leaflet.css';
    css.dataset.leaflet = '';
    document.head.appendChild(css);
  }

  pendiente = new Promise<Leaflet>((ok, falla) => {
    const s = document.createElement('script');
    s.src = '/vendor/leaflet/leaflet.js';
    s.async = true;
    s.onload = () => (w.L ? ok(w.L) : falla(new Error('Leaflet cargó pero no definió L')));
    s.onerror = () => {
      // Sin red: que el próximo intento (volver a entrar a /mapa) pruebe de nuevo.
      pendiente = null;
      s.remove();
      falla(new Error('No se pudo descargar Leaflet'));
    };
    document.head.appendChild(s);
  });
  return pendiente;
}
