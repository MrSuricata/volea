import { describe, expect, it } from 'vitest';
import { armarCuotas } from './socios';

describe('armarCuotas', () => {
  it('n=1: una cuota con el total y la fecha tal cual', () => {
    expect(armarCuotas(1500, 1, '2026-08-15')).toEqual([{ monto: 1500, fecha: '2026-08-15' }]);
  });

  it('divide en cuotas iguales, la última absorbe los centavos', () => {
    const c = armarCuotas(1000, 3, '2026-08-15');
    expect(c.map(x => x.monto)).toEqual([333.33, 333.33, 333.34]);
    expect(c.map(x => x.fecha)).toEqual(['2026-08-15', '2026-09-15', '2026-10-15']);
    expect(Math.round(c.reduce((s, x) => s + x.monto, 0) * 100) / 100).toBe(1000);
  });

  it('fin de mes con tope: compra el 31 → 30 en meses cortos', () => {
    const c = armarCuotas(300, 4, '2026-08-31');
    expect(c.map(x => x.fecha)).toEqual(['2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30']);
  });

  it('cruza el año y pisa febrero', () => {
    const c = armarCuotas(600, 3, '2026-12-31');
    expect(c.map(x => x.fecha)).toEqual(['2026-12-31', '2027-01-31', '2027-02-28']);
  });

  it('12 cuotas: 12 meses corridos, montos parejos', () => {
    const c = armarCuotas(12000, 12, '2026-08-15');
    expect(c).toHaveLength(12);
    expect(c[11].fecha).toBe('2027-07-15');
    expect(c.every(x => x.monto === 1000)).toBe(true);
  });
});
