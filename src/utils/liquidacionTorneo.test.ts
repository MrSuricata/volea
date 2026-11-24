import { describe, expect, it } from 'vitest';
import {
  ACUERDO_DEFECTO, baseDeLinea, calcularLiquidacion, normalizarLiquidacion, sincronizarInscripciones,
  type GastoTorneo, type LineaInscripcion, type LiquidacionTorneo,
} from './liquidacionTorneo';

const linea = (id: string, total: number, pagado: number, base?: number): LineaInscripcion => ({ id, nombre: id.toUpperCase(), total, pagado, base });
const gasto = (id: string, cantidad: number, unitario: number, extra: Partial<GastoTorneo> = {}): GastoTorneo =>
  ({ id, concepto: id, cantidad, unitario, pctClub: 55, pagadoPor: 'volea', ...extra });

// Torneo de los Palos (15/11/2026): 16 inscriptos a $700 ($400 de inscripción + $300 de remera).
const palos = (): LiquidacionTorneo => ({
  nombre: 'Torneo de los Palos',
  acuerdo: { ...ACUERDO_DEFECTO },
  inscripciones: [
    ...Array.from({ length: 11 }, (_, i) => linea(`j${i}`, 700, 700)),
    linea('malena', 700, 0),
    linea('valentina', 300, 300, 300), linea('luis', 300, 300, 300), // sin remera: todo es inscripción
    linea('federica', 350, 350), linea('gabriela', 350, 350), // cupón 50 %
  ],
  gastos: [gasto('medallas', 1, 800), gasto('alfajores', 8, 50), gasto('cervezas', 4, 120), gasto('llaveros', 8, 30)],
});

describe('baseDeLinea', () => {
  const a = ACUERDO_DEFECTO;
  it('precio completo: la base del acuerdo', () => expect(baseDeLinea(linea('x', 700, 700), a)).toBe(400));
  it('con descuento: en proporción', () => expect(baseDeLinea(linea('x', 350, 350), a)).toBe(200));
  it('ajustada a mano manda, sin pasar el total', () => {
    expect(baseDeLinea(linea('x', 300, 300, 300), a)).toBe(300);
    expect(baseDeLinea(linea('x', 300, 300, 900), a)).toBe(300);
  });
});

describe('calcularLiquidacion', () => {
  it('Torneo de los Palos', () => {
    const r = calcularLiquidacion(palos());
    expect(r.inscriptos).toBe(16);
    expect(r.totalInscripciones).toBe(9700);
    expect(r.cobrado).toBe(9000);
    expect(r.deudores).toEqual([{ nombre: 'MALENA', debe: 700 }]);
    expect(r.base).toBe(5800);
    expect(r.remeras).toBe(3900);
    expect(r.clubInscripciones).toBe(3190);
    expect(r.gastos).toBe(1920);
    expect(r.clubGastos).toBe(1056);
    expect(r.voleaGastos).toBe(864);
    expect(r.netoClub).toBe(2134);
    expect(r.netoVolea).toBe(5646);
    expect(r.netoClub + r.netoVolea).toBe(r.totalInscripciones - r.gastos);
    expect(r.saldoClub).toBe(2134);
    expect(r.saldoClubPendiente).toBe(220);
    expect(r.saldoClubAhora).toBe(1914);
    expect(r.socios.map((s) => s.parte)).toEqual([1882, 1882, 1882]);
  });

  it('un gasto que puso el club se le devuelve en el saldo', () => {
    const l = palos();
    l.gastos[2] = gasto('cervezas', 4, 120, { pagadoPor: 'club' });
    const r = calcularLiquidacion(l);
    expect(r.netoClub).toBe(2134); // el reparto no cambia
    expect(r.saldoClub).toBe(2134 + 480);
  });

  it('si cobró el club, es el club el que le paga a VOLEA', () => {
    const l = palos();
    l.acuerdo.cobro = 'club';
    const r = calcularLiquidacion(l);
    expect(r.saldoClub).toBe(2134 - 9700);
    expect(r.saldoClub).toBe(-r.netoVolea - r.gastos);
  });

  it('lo que un socio puso de su bolsillo se le suma a su parte y lo impago va a proveedores', () => {
    const l = palos();
    l.gastos[0] = gasto('medallas', 1, 800, { pagadoPor: 'Brian' });
    l.gastos[3] = gasto('llaveros', 8, 30, { pagado: false, proveedor: 'Imprenta' });
    const r = calcularLiquidacion(l);
    expect(r.socios.find((s) => s.nombre === 'Brian')).toEqual({ nombre: 'Brian', puso: 800, parte: 1882, recibe: 2682 });
    expect(r.aProveedores).toEqual([{ concepto: 'llaveros', proveedor: 'Imprenta', monto: 240 }]);
  });

  it('una liquidación vacía da todo en cero', () => {
    const r = calcularLiquidacion(normalizarLiquidacion(null));
    expect(r.netoClub).toBe(0);
    expect(r.netoVolea).toBe(0);
    expect(r.saldoClubAhora).toBe(0);
  });
});

describe('sincronizarInscripciones', () => {
  const insc = (id: string, extra: Partial<Parameters<typeof sincronizarInscripciones>[1][number]> = {}) =>
    ({ id, nombre: id, estado: 'confirmada', costo: 700, pagado: 700, deuda: 0, cuponPct: null, ...extra });

  it('arma las líneas: cupón, deuda y bajas', () => {
    const r = sincronizarInscripciones([], [
      insc('a'), insc('b', { pagado: 350, deuda: 350 }), insc('c', { pagado: 350, deuda: 0, cuponPct: 50 }),
      insc('d', { pagado: null, deuda: null }), insc('e', { estado: 'baja' }),
    ], 700);
    expect(r.map((l) => [l.id, l.total, l.pagado])).toEqual([['a', 700, 700], ['b', 700, 350], ['c', 350, 350], ['d', 700, 0]]);
  });

  it('al volver a traer conserva los ajustes a mano y actualiza lo pagado', () => {
    const previas: LineaInscripcion[] = [{ id: 'a', nombre: 'a', total: 300, pagado: 0, base: 300, nota: 'sin remera' }, { id: 'manual-1', nombre: 'Invitado', total: 400, pagado: 400 }];
    const r = sincronizarInscripciones(previas, [insc('a', { pagado: 300 }), insc('z')], 700);
    expect(r[0]).toEqual({ id: 'a', nombre: 'a', total: 300, pagado: 300, base: 300, nota: 'sin remera' });
    expect(r.map((l) => l.id)).toEqual(['a', 'z', 'manual-1']);
  });
});
