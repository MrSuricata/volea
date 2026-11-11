import { describe, expect, it } from 'vitest';
import { ordenarTalles } from './talles';

describe('ordenarTalles', () => {
  it('ordena de XS a 3XL y respeta el orden original a igual talle', () => {
    const catalogo = ['S / Masculino', 'S / Femenino', 'L / Masculino', 'M / Masculino', 'XL / Femenino', '2XL / Masculino', '3XL / Femenino', 'XS / Masculino'];
    expect(ordenarTalles(catalogo)).toEqual([
      'XS / Masculino', 'S / Masculino', 'S / Femenino', 'M / Masculino', 'L / Masculino', 'XL / Femenino', '2XL / Masculino', '3XL / Femenino',
    ]);
  });

  it('no pierde ni inventa talles y deja lo desconocido al final', () => {
    expect(ordenarTalles(['Único', 'M', 'XXL', 'S'])).toEqual(['S', 'M', 'XXL', 'Único']);
    expect(ordenarTalles(['42', '40', 'L'])).toEqual(['L', '40', '42']);
    expect(ordenarTalles([])).toEqual([]);
  });

  it('no modifica el arreglo recibido', () => {
    const a = ['L', 'S'];
    ordenarTalles(a);
    expect(a).toEqual(['L', 'S']);
  });
});
