import { describe, expect, it } from 'vitest';
import { matchearDupr, parsearDuprPegado } from './dupr';

const padron = [
  { id: 'j1', nombre: 'GASTON MOIRANO', alias: ['GASTÓN MOIRANO'], duprId: null },
  { id: 'j2', nombre: 'Paula Segura', alias: [], duprId: 'PS0001' },
  { id: 'j3', nombre: 'Mia Batista', alias: [], duprId: null },
];

describe('parsearDuprPegado', () => {
  it('acepta coma, punto y coma, tab y espacios múltiples', () => {
    const filas = parsearDuprPegado('Ana Lopez, ABC123\nBeto Diaz;XYZ789\nCami Ruiz\t7GH4K2\nDani Paz   QW12ER');
    expect(filas.map(f => [f.nombre, f.duprId])).toEqual([
      ['Ana Lopez', 'ABC123'], ['Beto Diaz', 'XYZ789'], ['Cami Ruiz', '7GH4K2'], ['Dani Paz', 'QW12ER'],
    ]);
    expect(filas.every(f => !f.error)).toBe(true);
  });

  it('saltea líneas vacías y el encabezado de un Excel', () => {
    const filas = parsearDuprPegado('Nombre, DUPR ID\n\nAna Lopez, ABC123\n   \n');
    expect(filas).toHaveLength(1);
    expect(filas[0].nombre).toBe('Ana Lopez');
  });

  it('marca la línea sin ID y la que tiene ID con formato raro', () => {
    const filas = parsearDuprPegado('Ana Lopez\nBeto Diaz, ***');
    expect(filas[0].error).toBeTruthy();
    expect(filas[1].error).toBeTruthy();
  });

  it('ignora una tercera columna (ej: el rating) y guarda solo el ID', () => {
    const filas = parsearDuprPegado('Ana Lopez, ABC123, 3.75');
    expect(filas[0]).toMatchObject({ nombre: 'Ana Lopez', duprId: 'ABC123' });
    expect(filas[0].error).toBeUndefined();
  });
});

describe('matchearDupr', () => {
  it('matchea sin tildes, por alias, y distingue nuevo / actualiza / igual', () => {
    const m = matchearDupr(parsearDuprPegado(
      'gastón moirano, GM7777\nPaula Segura, PS0001\nMia Batista, MB2222',
    ), padron);
    expect(m[0]).toMatchObject({ estado: 'nuevo', duprId: 'GM7777' });
    expect(m[0].jugador?.id).toBe('j1');
    expect(m[1].estado).toBe('igual');
    expect(m[2].estado).toBe('nuevo');
  });

  it('el mismo jugador con OTRO id se marca como actualiza', () => {
    const m = matchearDupr(parsearDuprPegado('Paula Segura, PS9999'), padron);
    expect(m[0]).toMatchObject({ estado: 'actualiza' });
    expect(m[0].jugador?.duprId).toBe('PS0001');
  });

  it('nombre parecido queda dudoso con candidatos, y desconocido sin match', () => {
    const m = matchearDupr(parsearDuprPegado('Mia Batistta, MB1111\nPersona Inexistente, ZZ0000'), padron);
    expect(m[0].estado).toBe('dudoso');
    expect(m[0].candidatos?.[0].nombre).toBe('Mia Batista');
    expect(m[1].estado).toBe('sin-match');
  });

  it('el mismo jugador repetido en el pegado marca duplicado', () => {
    const m = matchearDupr(parsearDuprPegado('Mia Batista, MB1111\nmia batista, MB2222'), padron);
    expect(m[0].estado).toBe('nuevo');
    expect(m[1].estado).toBe('duplicado');
  });

  it('las líneas con error de parseo llegan como inválidas', () => {
    const m = matchearDupr(parsearDuprPegado('Ana Lopez'), padron);
    expect(m[0].estado).toBe('invalido');
  });
});
