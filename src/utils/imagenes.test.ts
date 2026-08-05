import { describe, expect, it } from 'vitest';
import { cambiarExtension, dimensionesDestino, hayQueComprimir } from './imagenes';

describe('dimensionesDestino', () => {
  it('achica proporcionalmente al lado mayor', () => {
    expect(dimensionesDestino(4000, 3000, 1600)).toEqual({ ancho: 1600, alto: 1200 });
    expect(dimensionesDestino(3000, 4000, 1600)).toEqual({ ancho: 1200, alto: 1600 });
  });

  it('nunca agranda una imagen chica', () => {
    expect(dimensionesDestino(800, 600, 1600)).toEqual({ ancho: 800, alto: 600 });
  });

  it('redondea a enteros', () => {
    const d = dimensionesDestino(3001, 2000, 1600);
    expect(Number.isInteger(d.ancho)).toBe(true);
    expect(Number.isInteger(d.alto)).toBe(true);
  });
});

describe('hayQueComprimir', () => {
  const MB = 1024 * 1024;
  it('foto pesada del celu: si', () => {
    expect(hayQueComprimir('image/jpeg', 4 * MB)).toBe(true);
    expect(hayQueComprimir('image/png', 1 * MB)).toBe(true);
    expect(hayQueComprimir('image/heic', 3 * MB)).toBe(true); // se intenta; si el navegador no la decodifica, sube original
  });

  it('imagen ya liviana: no (pasa directo, no perder tiempo)', () => {
    expect(hayQueComprimir('image/jpeg', 200 * 1024)).toBe(false);
  });

  it('gif (puede ser animado) y svg: nunca', () => {
    expect(hayQueComprimir('image/gif', 5 * MB)).toBe(false);
    expect(hayQueComprimir('image/svg+xml', 5 * MB)).toBe(false);
  });

  it('no-imagen: nunca', () => {
    expect(hayQueComprimir('application/pdf', 5 * MB)).toBe(false);
  });
});

describe('cambiarExtension', () => {
  it('reemplaza la extension y respeta el nombre', () => {
    expect(cambiarExtension('IMG_1234.HEIC', 'jpg')).toBe('IMG_1234.jpg');
    expect(cambiarExtension('foto.final.png', 'jpg')).toBe('foto.final.jpg');
  });
  it('sin extension: la agrega', () => {
    expect(cambiarExtension('foto', 'jpg')).toBe('foto.jpg');
  });
});
