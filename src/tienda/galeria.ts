// Cuentas de la galería de la ficha de producto (GaleriaProducto.tsx), aparte y sin
// React para poder testearlas: zoom que sigue al puntero, paneo que no deja ver "fuera"
// de la foto, pellizco, swipe y la fila de miniaturas del celular.

export type Punto = { x: number; y: number };
export type Tamano = { ancho: number; alto: number };
export type Ajuste = 'cover' | 'contain';

/** Las prendas se fotografían en vertical: la caja de la galería es 4:5. */
export const ASPECTO_FOTO = 4 / 5;
export const ESCALA_MIN = 1;
export const ESCALA_MAX = 4;
/** Zoom del doble toque / doble clic en el visor. */
export const ESCALA_DOBLE_TOQUE = 2.5;
/** Zoom al pasar el mouse por la foto grande (compu). */
export const ESCALA_HOVER = 2.2;

const acotar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Índice que da la vuelta: -1 es la última, total es la primera. */
export function indiceCircular(i: number, total: number): number {
  if (total <= 0) return 0;
  return ((i % total) + total) % total;
}

/** Anterior y siguiente (sin repetir ni incluir la actual) para precargarlas. */
export function vecinos(i: number, total: number): number[] {
  if (total <= 1) return [];
  const anterior = indiceCircular(i - 1, total);
  const siguiente = indiceCircular(i + 1, total);
  return anterior === siguiente ? [siguiente] : [anterior, siguiente];
}

/** Qué foto del carrusel (scroll-snap) está en pantalla según el scroll horizontal. */
export function indiceDesdeScroll(scrollLeft: number, anchoFoto: number, total: number): number {
  if (anchoFoto <= 0 || total <= 0) return 0;
  return acotar(Math.round(scrollLeft / anchoFoto), 0, total - 1);
}

/**
 * transform-origin (en %) para que el zoom crezca desde donde está el puntero. Se mide
 * contra la caja SIN transformar: la foto ya escalada da un rect más grande y el origen
 * se correría.
 */
export function origenZoom(x: number, y: number, caja: { left: number; top: number; width: number; height: number }): Punto {
  if (caja.width <= 0 || caja.height <= 0) return { x: 50, y: 50 };
  return {
    x: acotar(((x - caja.left) / caja.width) * 100, 0, 100),
    y: acotar(((y - caja.top) / caja.height) * 100, 0, 100),
  };
}

/**
 * Casi todas las fotos del catálogo son mockups apaisados (frente y espalda lado a
 * lado, ~1,6:1): con `cover` en una caja 4:5 se verían dos medias remeras. Solo se
 * recorta la foto que ya es casi 4:5; el resto se muestra entera.
 */
export function ajusteFoto(ancho: number, alto: number, aspectoCaja = ASPECTO_FOTO, tolerancia = 0.1): Ajuste {
  if (!(ancho > 0) || !(alto > 0)) return 'contain';
  return Math.abs(ancho / alto / aspectoCaja - 1) <= tolerancia ? 'cover' : 'contain';
}

export function limitarEscala(escala: number, min = ESCALA_MIN, max = ESCALA_MAX): number {
  return Number.isFinite(escala) ? acotar(escala, min, max) : min;
}

/**
 * Corrimiento máximo con la foto ampliada: sus bordes no pueden entrar en la caja (si
 * no, se ve el fondo). En el eje donde la foto ampliada todavía entra, queda centrada.
 * `t` es el translate aplicado ANTES del scale, con transform-origin en el centro.
 */
export function limitarPaneo(t: Punto, escala: number, base: Tamano, caja: Tamano): Punto {
  const maxX = Math.max(0, (base.ancho * escala - caja.ancho) / 2);
  const maxY = Math.max(0, (base.alto * escala - caja.alto) / 2);
  return { x: acotar(t.x, -maxX, maxX) || 0, y: acotar(t.y, -maxY, maxY) || 0 };
}

/**
 * Nuevo translate para cambiar de escala sin que se mueva el punto `p` (relativo al
 * centro de la caja): lo que estaba debajo del dedo/cursor sigue ahí.
 */
export function zoomEnPunto(t: Punto, escala: number, nuevaEscala: number, p: Punto): Punto {
  const f = nuevaEscala / escala;
  return { x: p.x - (p.x - t.x) * f, y: p.y - (p.y - t.y) * f };
}

export function distancia(a: Punto, b: Punto): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function puntoMedio(a: Punto, b: Punto): Punto {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Pellizco: escala proporcional a cuánto se abrieron los dedos, y el punto de la foto
 * que estaba bajo el punto medio inicial acompaña al punto medio actual (se puede
 * pellizcar y arrastrar a la vez).
 */
export function pellizco(
  inicio: { escala: number; t: Punto; medio: Punto; distancia: number },
  medio: Punto,
  dist: number,
): { escala: number; t: Punto } {
  const escala = inicio.distancia > 0 ? limitarEscala(inicio.escala * (dist / inicio.distancia)) : inicio.escala;
  const f = escala / inicio.escala;
  return {
    escala,
    t: { x: medio.x - (inicio.medio.x - inicio.t.x) * f, y: medio.y - (inicio.medio.y - inicio.t.y) * f },
  };
}

/**
 * Swipe en el visor: +1 = siguiente (dedo hacia la izquierda), -1 = anterior, 0 = nada.
 * Pasa por distancia (50px, o 20% del ancho si la pantalla es angosta) o por un
 * "flick" rápido aunque sea corto. Tiene que ser más horizontal que vertical.
 */
export function decidirSwipe(dx: number, dy: number, ms: number, ancho: number): -1 | 0 | 1 {
  if (Math.abs(dx) <= Math.abs(dy)) return 0;
  const umbral = Math.min(50, ancho * 0.2);
  const rapido = ms > 0 && Math.abs(dx) / ms > 0.5 && Math.abs(dx) > 20;
  if (Math.abs(dx) < umbral && !rapido) return 0;
  return dx < 0 ? 1 : -1;
}

export type Toque = { t: number; x: number; y: number };

/** Dos toques cortos, seguidos y en el mismo lugar = doble toque. */
export function esDobleToque(anterior: Toque | null, actual: Toque, ventanaMs = 300, radio = 30): boolean {
  if (!anterior) return false;
  const dt = actual.t - anterior.t;
  return dt >= 0 && dt <= ventanaMs && distancia(anterior, actual) <= radio;
}

/** Rueda del mouse / pellizco del trackpad (llega como wheel con ctrlKey). */
export function escalaConRueda(escala: number, deltaY: number): number {
  return limitarEscala(escala * Math.exp(-deltaY * 0.0025));
}

/**
 * Ancho de las miniaturas del celular. Si entran todas, el ideal. Si no, se ajusta
 * para que la última visible quede cortada a la mitad: así se entiende que la fila se
 * desliza (una fila que termina justo en el borde parece completa).
 */
export function anchoMiniatura(anchoFila: number, total: number, ideal = 56, gap = 8): number {
  if (!(anchoFila > 0) || total <= 0) return ideal;
  if (total * ideal + (total - 1) * gap <= anchoFila) return ideal;
  const enteras = Math.max(1, Math.round((anchoFila - ideal / 2) / (ideal + gap)));
  return (anchoFila - enteras * gap) / (enteras + 0.5);
}

/**
 * Scroll para que la miniatura activa quede a la vista en su fila (horizontal o
 * vertical), moviendo lo mínimo. `inicio`/`largo` de la miniatura dentro de la fila.
 */
export function scrollParaVer(scrollActual: number, visible: number, inicio: number, largo: number, margen = 8): number {
  if (inicio - margen < scrollActual) return Math.max(0, inicio - margen);
  if (inicio + largo + margen > scrollActual + visible) return inicio + largo + margen - visible;
  return scrollActual;
}
