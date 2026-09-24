import { describe, expect, it } from 'vitest';
import {
  ajusteFoto, anchoMiniatura, decidirSwipe, esDobleToque, escalaConRueda, indiceCircular,
  indiceDesdeScroll, limitarEscala, limitarPaneo, origenZoom, pellizco, scrollParaVer, vecinos,
  tamanoContenido, zoomEnPunto, colorDeFondo, type Rgba,
} from './galeria';

describe('indiceCircular / vecinos', () => {
  it('da la vuelta en los dos sentidos', () => {
    expect(indiceCircular(-1, 3)).toBe(2);
    expect(indiceCircular(3, 3)).toBe(0);
    expect(indiceCircular(7, 3)).toBe(1);
    expect(indiceCircular(-4, 3)).toBe(2);
    expect(indiceCircular(5, 0)).toBe(0);
  });

  it('precarga anterior y siguiente sin repetir', () => {
    expect(vecinos(0, 5)).toEqual([4, 1]);
    expect(vecinos(0, 2)).toEqual([1]);
    expect(vecinos(0, 1)).toEqual([]);
  });
});

describe('indiceDesdeScroll', () => {
  it('redondea a la foto más visible y no se pasa de los bordes', () => {
    expect(indiceDesdeScroll(0, 358, 3)).toBe(0);
    expect(indiceDesdeScroll(170, 358, 3)).toBe(0);
    expect(indiceDesdeScroll(190, 358, 3)).toBe(1);
    expect(indiceDesdeScroll(716, 358, 3)).toBe(2);
    expect(indiceDesdeScroll(5000, 358, 3)).toBe(2); // rebote de iOS
    expect(indiceDesdeScroll(-40, 358, 3)).toBe(0);
    expect(indiceDesdeScroll(100, 0, 3)).toBe(0);
  });
});

describe('origenZoom', () => {
  const caja = { left: 100, top: 50, width: 400, height: 500 };
  it('traduce el puntero a % de la caja', () => {
    expect(origenZoom(300, 300, caja)).toEqual({ x: 50, y: 50 });
    expect(origenZoom(100, 50, caja)).toEqual({ x: 0, y: 0 });
    expect(origenZoom(500, 550, caja)).toEqual({ x: 100, y: 100 });
  });
  it('se queda dentro de 0–100 aunque el puntero salga', () => {
    expect(origenZoom(20, 900, caja)).toEqual({ x: 0, y: 100 });
    expect(origenZoom(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 50, y: 50 });
  });
});

describe('ajusteFoto', () => {
  it('recorta solo las fotos que ya son casi 4:5', () => {
    expect(ajusteFoto(939, 1157)).toBe('cover'); // camiseta CRP
    expect(ajusteFoto(2047, 2560)).toBe('cover');
    expect(ajusteFoto(1587, 1097)).toBe('contain'); // mockup frente + espalda
    expect(ajusteFoto(1000, 1000)).toBe('contain');
    expect(ajusteFoto(1000, 1500)).toBe('contain'); // 2:3, recortaría cabeza o pies
  });
  it('sin medidas (todavía cargando) no recorta', () => {
    expect(ajusteFoto(0, 0)).toBe('contain');
    expect(ajusteFoto(NaN, 100)).toBe('contain');
  });
});

describe('limitarEscala', () => {
  it('queda entre 1 y 4', () => {
    expect(limitarEscala(0.3)).toBe(1);
    expect(limitarEscala(2)).toBe(2);
    expect(limitarEscala(9)).toBe(4);
    expect(limitarEscala(NaN)).toBe(1);
  });
});

describe('limitarPaneo', () => {
  const caja = { ancho: 400, alto: 800 };
  const base = { ancho: 400, alto: 300 }; // foto apaisada, entra entera en la caja

  it('sin zoom no se puede mover', () => {
    expect(limitarPaneo({ x: 50, y: -30 }, 1, base, caja)).toEqual({ x: 0, y: 0 });
  });

  it('con zoom el borde de la foto no entra en la caja', () => {
    // x2: la foto mide 800 de ancho → sobran 200 por lado; 600 de alto → entra, centrada
    expect(limitarPaneo({ x: 500, y: 100 }, 2, base, caja)).toEqual({ x: 200, y: 0 });
    expect(limitarPaneo({ x: -500, y: 0 }, 2, base, caja)).toEqual({ x: -200, y: 0 });
    // x4: 1200 de alto en una caja de 800 → 200 por lado también en vertical
    expect(limitarPaneo({ x: 10, y: -999 }, 4, base, caja)).toEqual({ x: 10, y: -200 });
  });
});

describe('zoomEnPunto', () => {
  it('el punto bajo el dedo queda quieto', () => {
    const t = zoomEnPunto({ x: 0, y: 0 }, 1, 2.5, { x: 100, y: -40 });
    // punto de la foto bajo el dedo antes: (p - t) / s = (100, -40); después: t + c * s'
    expect(t.x + 100 * 2.5).toBeCloseTo(100);
    expect(t.y + -40 * 2.5).toBeCloseTo(-40);
  });
  it('zoom en el centro no mueve nada', () => {
    expect(zoomEnPunto({ x: 0, y: 0 }, 1, 3, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
  it('volver a escala 1 desde un zoom lo deja centrado si el punto es el mismo', () => {
    const t = zoomEnPunto({ x: 0, y: 0 }, 1, 2, { x: 80, y: 20 });
    const vuelta = zoomEnPunto(t, 2, 1, { x: 80, y: 20 });
    expect(vuelta.x).toBeCloseTo(0);
    expect(vuelta.y).toBeCloseTo(0);
  });
});

describe('pellizco', () => {
  const inicio = { escala: 1, t: { x: 0, y: 0 }, medio: { x: 50, y: 0 }, distancia: 100 };
  it('escala según cuánto se abren los dedos, con tope', () => {
    expect(pellizco(inicio, { x: 50, y: 0 }, 200).escala).toBe(2);
    expect(pellizco(inicio, { x: 50, y: 0 }, 1000).escala).toBe(4);
    expect(pellizco(inicio, { x: 50, y: 0 }, 20).escala).toBe(1);
  });
  it('el punto bajo los dedos los acompaña', () => {
    const r = pellizco(inicio, { x: 70, y: 10 }, 200);
    // contenido que estaba en 50 (relativo al centro) ahora se dibuja en t + 50 * 2
    expect(r.t.x + 50 * r.escala).toBeCloseTo(70);
    expect(r.t.y + 0 * r.escala).toBeCloseTo(10);
  });
  it('distancia inicial cero no rompe', () => {
    expect(pellizco({ ...inicio, distancia: 0 }, { x: 0, y: 0 }, 50).escala).toBe(1);
  });
});

describe('decidirSwipe', () => {
  it('dedo a la izquierda = siguiente, a la derecha = anterior', () => {
    expect(decidirSwipe(-80, 5, 400, 390)).toBe(1);
    expect(decidirSwipe(80, 5, 400, 390)).toBe(-1);
  });
  it('poco recorrido y lento no cambia', () => {
    expect(decidirSwipe(-30, 0, 400, 390)).toBe(0);
  });
  it('un flick corto pero rápido sí cambia', () => {
    expect(decidirSwipe(-35, 0, 50, 390)).toBe(1);
  });
  it('si fue más vertical que horizontal no cuenta', () => {
    expect(decidirSwipe(-80, 120, 300, 390)).toBe(0);
  });
  it('en pantallas angostas el umbral es 20% del ancho', () => {
    expect(decidirSwipe(-45, 0, 500, 200)).toBe(1); // 20% de 200 = 40
  });
});

describe('esDobleToque', () => {
  const a = { t: 1000, x: 100, y: 100 };
  it('dos toques cerca y seguidos', () => {
    expect(esDobleToque(a, { t: 1200, x: 110, y: 95 })).toBe(true);
  });
  it('muy separados en tiempo o lugar no', () => {
    expect(esDobleToque(a, { t: 1400, x: 100, y: 100 })).toBe(false);
    expect(esDobleToque(a, { t: 1100, x: 180, y: 100 })).toBe(false);
    expect(esDobleToque(null, a)).toBe(false);
  });
});

describe('escalaConRueda', () => {
  it('rueda hacia arriba agranda, hacia abajo achica, con topes', () => {
    expect(escalaConRueda(1, -100)).toBeGreaterThan(1);
    expect(escalaConRueda(2, 100)).toBeLessThan(2);
    expect(escalaConRueda(1, 500)).toBe(1);
    expect(escalaConRueda(3.9, -2000)).toBe(4);
  });
});

describe('anchoMiniatura', () => {
  it('si entran todas, tamaño ideal', () => {
    expect(anchoMiniatura(358, 3)).toBe(56);
    expect(anchoMiniatura(358, 5)).toBe(56); // 5*56 + 4*8 = 312
  });
  it('si no entran, la última visible queda cortada a la mitad', () => {
    const fila = 358;
    const w = anchoMiniatura(fila, 9);
    // cuántas enteras + la mitad de la siguiente llenan la fila exacto
    const enteras = Math.floor(fila / (w + 8));
    const sobra = fila - enteras * (w + 8);
    expect(sobra / w).toBeCloseTo(0.5);
    expect(w).toBeGreaterThan(48);
    expect(w).toBeLessThan(64);
  });
  it('sin medir todavía, ideal', () => {
    expect(anchoMiniatura(0, 9)).toBe(56);
  });
});

describe('scrollParaVer', () => {
  it('no se mueve si la miniatura ya se ve', () => {
    expect(scrollParaVer(0, 300, 100, 56)).toBe(0);
  });
  it('corre lo justo hacia adelante o hacia atrás', () => {
    expect(scrollParaVer(0, 300, 280, 56)).toBe(280 + 56 + 8 - 300);
    expect(scrollParaVer(200, 300, 120, 56)).toBe(112);
    expect(scrollParaVer(50, 300, 4, 56)).toBe(0);
  });
});

describe('tamanoContenido', () => {
  it('encaja la foto entera en el marco sin deformarla', () => {
    expect(tamanoContenido({ ancho: 1600, alto: 1000 }, { ancho: 400, alto: 800 })).toEqual({ ancho: 400, alto: 250 });
    expect(tamanoContenido({ ancho: 800, alto: 1000 }, { ancho: 1000, alto: 500 })).toEqual({ ancho: 400, alto: 500 });
  });
  it('fotos chicas se agrandan hasta el marco', () => {
    expect(tamanoContenido({ ancho: 100, alto: 100 }, { ancho: 300, alto: 600 })).toEqual({ ancho: 300, alto: 300 });
  });
  it('sin medidas naturales usa el marco', () => {
    expect(tamanoContenido({ ancho: 0, alto: 0 }, { ancho: 300, alto: 600 })).toEqual({ ancho: 300, alto: 600 });
  });
});

describe('colorDeFondo', () => {
  const op = (r: number, g = r, b = r): Rgba => [r, g, b, 255];
  it('blanco o casi blanco: se funde con multiply (null)', () => {
    expect(colorDeFondo([op(255), op(255), op(255), op(255)])).toBeNull();
    expect(colorDeFondo([op(255), op(255), op(254), op(244)])).toBeNull(); // una esquina con sombra
  });
  it('transparente: se ve la caja (null)', () => {
    expect(colorDeFondo([[0, 0, 0, 0], op(255), op(255), op(255)])).toBeNull();
  });
  it('fondo parejo oscuro o gris: se rellena con ese color', () => {
    expect(colorDeFondo([op(51), op(51), op(51), op(51)])).toBe('rgb(51, 51, 51)'); // VOLEA Shadow
    expect(colorDeFondo([op(246, 248, 248), op(236, 237, 238), op(230, 232, 233), op(227, 227, 229)])).toBe('rgb(235, 236, 237)');
  });
  it('fondo variado (foto con escenario): no inventa un color', () => {
    expect(colorDeFondo([op(195, 194, 195), op(84, 98, 110), op(138, 142, 153), op(95, 67, 79)])).toBeNull();
  });
  it('sin muestras no rompe', () => {
    expect(colorDeFondo([])).toBeNull();
  });
});
