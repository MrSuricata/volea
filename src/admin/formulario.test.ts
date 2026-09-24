import { describe, expect, it } from 'vitest';
import { hayCambios } from './formulario';

describe('hayCambios', () => {
  const base = { nombre: 'Copa', fecha: '2026-10-01', cupo: 32 as number | undefined, activo: true };

  it('sin tocar nada no hay cambios', () => {
    expect(hayCambios(base, { ...base })).toBe(false);
  });

  it('detecta texto, número y booleano distintos', () => {
    expect(hayCambios(base, { ...base, nombre: 'Copa VOLEA' })).toBe(true);
    expect(hayCambios(base, { ...base, cupo: 16 })).toBe(true);
    expect(hayCambios(base, { ...base, activo: false })).toBe(true);
  });

  it('vacío, null y undefined son lo mismo (abrir un campo y borrarlo no es un cambio)', () => {
    expect(hayCambios({ ...base, fin: undefined } as object, { ...base, fin: '' } as object)).toBe(false);
    expect(hayCambios(base as object, { ...base, fin: '' } as object)).toBe(false);
    expect(hayCambios({ ...base, cupo: undefined }, { ...base, cupo: undefined })).toBe(false);
  });

  it('compara objetos anidados por contenido', () => {
    const a = { tarifa: { base: 800, incluye: 1 } };
    expect(hayCambios(a, { tarifa: { base: 800, incluye: 1 } })).toBe(false);
    expect(hayCambios(a, { tarifa: { base: 900, incluye: 1 } })).toBe(true);
  });
});
