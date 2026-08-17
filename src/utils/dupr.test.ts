import { describe, expect, it } from 'vitest';
import { chequearTope, matchearDupr, parsearDuprPegado, parsearRating } from './dupr';

const padron = [
  { id: 'j1', nombre: 'GASTON MOIRANO', alias: ['GASTÓN MOIRANO'], duprId: null },
  { id: 'j2', nombre: 'Paula Segura', alias: [], duprId: 'PS0001' },
  { id: 'j3', nombre: 'Mia Batista', alias: [], duprId: null },
];

describe('parsearRating', () => {
  it('acepta 3.6 / 3.600 / 3,6 como el mismo valor', () => {
    expect(parsearRating('3.6')).toBe(3.6);
    expect(parsearRating('3.600')).toBe(3.6);
    expect(parsearRating('3,6')).toBe(3.6);
  });
  it('4 dígitos pegados son milésimas, como los copia la app de DUPR', () => {
    expect(parsearRating('4285')).toBe(4.285);
    expect(parsearRating('2950')).toBe(2.95);
  });
  it('rechaza lo que no es un DUPR (fuera de 1-8 o con letras)', () => {
    expect(parsearRating('9100')).toBeNull();
    expect(parsearRating('9.1')).toBeNull();
    expect(parsearRating('ABC123')).toBeNull();
    expect(parsearRating('123')).toBeNull();
  });
});

describe('formato real que pega Brian', () => {
  it('"nombre rating id" con espacios simples, y ":" como separador', () => {
    expect(parsearDuprPegado('cristian rodriguez 4285 M2EZED')[0])
      .toMatchObject({ nombre: 'cristian rodriguez', rating: 4.285, duprId: 'M2EZED' });
    expect(parsearDuprPegado('veronica sosa 3.054 XKQN5X')[0])
      .toMatchObject({ nombre: 'veronica sosa', rating: 3.054, duprId: 'XKQN5X' });
    expect(parsearDuprPegado('Sandra rigos: WX7PEL')[0])
      .toMatchObject({ nombre: 'Sandra rigos', duprId: 'WX7PEL', rating: null });
    expect(parsearDuprPegado('OSCAR FRIDELLA 3186  QXDN6R ')[0])
      .toMatchObject({ nombre: 'OSCAR FRIDELLA', rating: 3.186, duprId: 'QXDN6R' });
  });

  it('DUPR ID de SOLO letras después del rating, y la palabra "dupr" como ruido', () => {
    expect(parsearDuprPegado('rosana ahlers 3495 dupr YXWQDP')[0])
      .toMatchObject({ nombre: 'rosana ahlers', rating: 3.495, duprId: 'YXWQDP' });
    expect(parsearDuprPegado('MAXIMILIANO BUENAHORA 2957 DYJYWL')[0])
      .toMatchObject({ nombre: 'MAXIMILIANO BUENAHORA', rating: 2.957, duprId: 'DYJYWL' });
    expect(parsearDuprPegado('PEPE PIOMBO 3350 YMQOKP')[0])
      .toMatchObject({ nombre: 'PEPE PIOMBO', rating: 3.35, duprId: 'YMQOKP' });
  });

  it('sigue sin partir apellidos: "Ana Lopez" no tiene DUPR', () => {
    expect(parsearDuprPegado('Ana Lopez')[0].error).toBeTruthy();
    expect(parsearDuprPegado('NICOLAS G.')[0].error).toBeTruthy();
  });
});

describe('chequearTope (reglamento APU)', () => {
  it('Doble Masculino B: individual 3.6 y suma 7.0', () => {
    expect(chequearTope('Doble Masculino B', [
      { nombre: 'A', rating: 3.5 }, { nombre: 'B', rating: 3.4 },
    ]).estado).toBe('ok');
    expect(chequearTope('Doble Masculino B', [
      { nombre: 'A', rating: 3.7 }, { nombre: 'B', rating: 3.0 },
    ])).toMatchObject({ estado: 'excede-individual' });
    expect(chequearTope('Doble Masculino B', [
      { nombre: 'A', rating: 3.6 }, { nombre: 'B', rating: 3.5 },
    ])).toMatchObject({ estado: 'excede-suma', suma: 7.1 });
  });

  it('Doble Femenino B es más exigente (3.3 / 6.5)', () => {
    expect(chequearTope('Doble Femenino B', [
      { nombre: 'A', rating: 3.4 }, { nombre: 'B', rating: 3.0 },
    ]).estado).toBe('excede-individual');
    expect(chequearTope('Doble Femenino B', [
      { nombre: 'A', rating: 3.3 }, { nombre: 'B', rating: 3.3 },
    ]).estado).toBe('excede-suma');
  });

  it('las C topean en 3.0 individual y los singles no tienen suma', () => {
    expect(chequearTope('Doble Mixto C', [{ nombre: 'A', rating: 3.1 }, { nombre: 'B', rating: 2.0 }]).estado)
      .toBe('excede-individual');
    expect(chequearTope('Singles Masculino B', [{ nombre: 'A', rating: 3.6 }]).estado).toBe('ok');
    expect(chequearTope('Singles Masculino B', [{ nombre: 'A', rating: 3.61 }]).estado).toBe('excede-individual');
  });

  it('sin rating de alguien no afirma nada, y las categorías sin tope quedan aparte', () => {
    expect(chequearTope('Doble Masculino B', [{ nombre: 'A', rating: 3.0 }, { nombre: 'B', rating: null }]).estado)
      .toBe('sin-datos');
    expect(chequearTope('Doble Masculino A', [{ nombre: 'A', rating: 5.5 }]).estado).toBe('sin-tope');
  });
});

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

  it('coma decimal y un solo espacio (como se escribe en WhatsApp)', () => {
    expect(parsearDuprPegado('Matias Salaburu 3,45')[0]).toMatchObject({ nombre: 'Matias Salaburu', rating: 3.45 });
    expect(parsearDuprPegado('Franco Montero 3.6')[0]).toMatchObject({ nombre: 'Franco Montero', rating: 3.6 });
    expect(parsearDuprPegado('Ana Lopez ABC123')[0]).toMatchObject({ nombre: 'Ana Lopez', duprId: 'ABC123' });
    expect(parsearDuprPegado('Matias Salaburu 3,45')[0].error).toBeUndefined();
  });

  it('toma ID y rating en cualquier orden, y acepta solo rating', () => {
    expect(parsearDuprPegado('Ana Lopez, ABC123, 3.75')[0]).toMatchObject({ duprId: 'ABC123', rating: 3.75 });
    expect(parsearDuprPegado('Ana Lopez, 3.75, ABC123')[0]).toMatchObject({ duprId: 'ABC123', rating: 3.75 });
    expect(parsearDuprPegado('Ana Lopez, 3.600')[0]).toMatchObject({ duprId: '', rating: 3.6 });
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

  it('pegar SOLO el rating se guarda aunque el jugador no tenga ID (no es "igual")', () => {
    const conRating = [{ id: 'j9', nombre: 'Franco Montero', alias: [], duprId: null, rating: null }];
    const m = matchearDupr(parsearDuprPegado('Franco Montero, 3.600'), conRating);
    expect(m[0]).toMatchObject({ estado: 'nuevo', rating: 3.6, duprId: '' });
    // y si ya tenía ese mismo rating, ahí sí es igual
    const yaTenia = [{ id: 'j9', nombre: 'Franco Montero', alias: [], duprId: null, rating: 3.6 }];
    expect(matchearDupr(parsearDuprPegado('Franco Montero, 3.600'), yaTenia)[0].estado).toBe('igual');
    // cambiar solo el rating de alguien que ya tenía otro = actualiza
    const otro = [{ id: 'j9', nombre: 'Franco Montero', alias: [], duprId: 'FM1', rating: 3.2 }];
    expect(matchearDupr(parsearDuprPegado('Franco Montero, 3.600'), otro)[0].estado).toBe('actualiza');
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
