// Lo que la primera pantalla va a necesitar, pedido apenas arranca el JS, mientras
// todavía se ve el "Cargando…" (que dura hasta que llegan los datos de Supabase).
//
// POR QUÉ: medido con Lighthouse en celular el 23/09.
// - Fuentes: el navegador pide cada @font-face recién cuando hay texto que la usa, y el
//   splash solo usa Montserrat 400. Al aparecer la página, llegaban Lexend y el resto de
//   los pesos y el texto se reacomodaba (CLS 0,117 en /tienda). Pedirlas ya hace que
//   estén listas antes de que se muestre la página.
// - Foto del hero de la home: es el elemento más grande de la pantalla (LCP) y, como es
//   un background de CSS, se descubría recién al renderizar el hero, después del splash.
//
// Nada de esto es imprescindible: si algo falla, la página carga igual que antes.

const FUENTES = [
  '400 1em Montserrat', '600 1em Montserrat', '700 1em Montserrat',
  '600 1em Lexend', '700 1em Lexend', '900 1em Lexend',
];

export const FOTO_HERO_HOME = '/products/lifestyle-sunset-back.jpg';

export function precargarPrimeraPantalla(): void {
  try {
    // El texto de muestra ('Aá') apunta al subset latino, que es el que usa el sitio.
    for (const f of FUENTES) document.fonts?.load(f, 'Aá').catch(() => {});
    if (location.pathname === '/') {
      const l = document.createElement('link');
      l.rel = 'preload';
      l.as = 'image';
      l.href = FOTO_HERO_HOME;
      l.setAttribute('fetchpriority', 'high');
      document.head.appendChild(l);
    }
  } catch {
    // Navegador viejo sin document.fonts o similar: no pasa nada.
  }
}
