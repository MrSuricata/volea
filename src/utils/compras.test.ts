import { describe, expect, it } from 'vitest';
import type { CompraItem } from '../types';
import { esUuid, planLineasCompra, uuidNuevo } from './compras';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

const item = (id: string, cantidad: number, extra: Partial<CompraItem> = {}): CompraItem => ({
  id,
  compraId: 'c1',
  productId: 'remera',
  descripcion: `Remera ${id.slice(0, 4)}`,
  variante: 'M|Negro',
  cantidad,
  cantidadRecibida: 0,
  costoUnitario: 100,
  orden: 0,
  ...extra,
});

describe('planLineasCompra', () => {
  it('las líneas existentes van por id y SIN cantidad_recibida (la escribe solo la recepción)', () => {
    // El formulario cree que no llegó nada, pero en la base ya se recibieron 10.
    const plan = planLineasCompra([item(U1, 20, { cantidadRecibida: 0 })], [{ id: U1, cantidadRecibida: 10, descripcion: 'Remera' }]);
    expect(plan.filas).toHaveLength(1);
    expect(plan.filas[0].id).toBe(U1);
    expect(plan.filas[0]).not.toHaveProperty('cantidad_recibida');
    expect(plan.borrar).toEqual([]);
  });

  it('una línea nueva con id UUID lo conserva (el reintento no la duplica)', () => {
    const plan = planLineasCompra([item(U2, 5)], []);
    expect(plan.filas[0].id).toBe(U2);
  });

  it('una línea nueva con id que no es UUID recibe uno nuevo', () => {
    const plan = planLineasCompra([item('tmp-123-abc', 5)], [], () => U3);
    expect(plan.filas[0].id).toBe(U3);
  });

  it('borra solo las quitadas sin nada recibido', () => {
    const plan = planLineasCompra(
      [item(U1, 5)],
      [
        { id: U1, cantidadRecibida: 0, descripcion: 'queda' },
        { id: U2, cantidadRecibida: 0, descripcion: 'quitada limpia' },
        { id: U3, cantidadRecibida: 4, descripcion: 'quitada con recibidas' },
      ],
    );
    expect(plan.borrar).toEqual([U2]);
    expect(plan.retenidas.map(l => l.id)).toEqual([U3]);
  });

  it('detecta encargar menos de lo que ya llegó según la base, aunque el formulario no lo sepa', () => {
    const plan = planLineasCompra([item(U1, 3, { cantidadRecibida: 0 })], [{ id: U1, cantidadRecibida: 8, descripcion: 'Remera' }]);
    expect(plan.bajoLoRecibido).toEqual([{ descripcion: 'Remera 1111', cantidad: 3, recibida: 8 }]);
  });

  it('el orden es el del formulario', () => {
    const plan = planLineasCompra([item(U2, 1), item(U1, 1)], []);
    expect(plan.filas.map(f => [f.id, f.orden])).toEqual([[U2, 0], [U1, 1]]);
  });

  it('mapea los campos a las columnas de compra_items', () => {
    const plan = planLineasCompra([item(U1, 2, { productId: null, variante: null, costoUnitario: null })], []);
    expect(plan.filas[0]).toEqual({
      id: U1, product_id: null, descripcion: 'Remera 1111', variante: null, cantidad: 2, costo_unitario: null, orden: 0,
    });
  });
});

describe('uuidNuevo', () => {
  it('da UUIDs válidos y distintos', () => {
    const a = uuidNuevo();
    const b = uuidNuevo();
    expect(esUuid(a)).toBe(true);
    expect(a).not.toBe(b);
  });
});
