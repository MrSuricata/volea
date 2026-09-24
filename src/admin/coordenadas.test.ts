import { describe, expect, it } from 'vitest';
import {
  esPuntoPorDefecto, fueraDeSudamerica, leerCoordenadas, leerNumeroCoordenada, linkMapa,
} from './coordenadas';

const ok = (lat: number, lng: number) => ({ ok: true, lat, lng });

describe('leerCoordenadas', () => {
  it('lee el par que copia el pin del celular', () => {
    expect(leerCoordenadas('-34.901100, -56.164500')).toEqual(ok(-34.9011, -56.1645));
    expect(leerCoordenadas('  -34.9011,-56.1645 ')).toEqual(ok(-34.9011, -56.1645));
    expect(leerCoordenadas('-34.9011 -56.1645')).toEqual(ok(-34.9011, -56.1645));
    expect(leerCoordenadas('(-34.9011, -56.1645)')).toEqual(ok(-34.9011, -56.1645));
  });

  it('acepta coma decimal si el par va separado por espacio o punto y coma', () => {
    expect(leerCoordenadas('-34,9011 -56,1645')).toEqual(ok(-34.9011, -56.1645));
    expect(leerCoordenadas('-34,9011; -56,1645')).toEqual(ok(-34.9011, -56.1645));
  });

  it('no adivina con un número suelto con coma', () => {
    expect(leerCoordenadas('-34,9').ok).toBe(false);
  });

  it('en un link de lugar prefiere el pin (!3d!4d) al centro de la vista (@)', () => {
    const url = 'https://www.google.com/maps/place/Club+Bigu%C3%A1/@-34.9100000,-56.1500000,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-34.9112341!4d-56.1523459!16s%2Fg%2F11';
    expect(leerCoordenadas(url)).toEqual(ok(-34.911234, -56.152346));
  });

  it('lee el @ de la vista si no hay pin', () => {
    expect(leerCoordenadas('https://www.google.com/maps/@-34.9011,-56.1645,15z')).toEqual(ok(-34.9011, -56.1645));
  });

  it('lee ?q=, ?query=, ?ll= y geo:', () => {
    expect(leerCoordenadas('https://maps.google.com/?q=-34.9011,-56.1645')).toEqual(ok(-34.9011, -56.1645));
    expect(leerCoordenadas('https://www.google.com/maps/search/?api=1&query=-34.9011%2C-56.1645')).toEqual(ok(-34.9011, -56.1645));
    expect(leerCoordenadas('https://www.google.com/maps?ll=-34.9011,-56.1645&z=16')).toEqual(ok(-34.9011, -56.1645));
    expect(leerCoordenadas('geo:-34.9011,-56.1645')).toEqual(ok(-34.9011, -56.1645));
  });

  it('lee grados, minutos y segundos (con O de oeste también)', () => {
    const r = leerCoordenadas(`34°54'04.0"S 56°09'52.2"W`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lat).toBeCloseTo(-34.901111, 5);
      expect(r.lng).toBeCloseTo(-56.1645, 5);
    }
    const o = leerCoordenadas(`34°54'04,0"S 56°09'52,2"O`);
    expect(o.ok && o.lng).toBeCloseTo(-56.1645, 5);
  });

  it('explica qué hacer con un link corto de Compartir', () => {
    const r = leerCoordenadas('https://maps.app.goo.gl/AbCdEf123');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/link corto/);
  });

  it('rechaza vacío, texto y números fuera de rango', () => {
    expect(leerCoordenadas('   ').ok).toBe(false);
    expect(leerCoordenadas('Club Biguá, Montevideo').ok).toBe(false);
    expect(leerCoordenadas('-134.9, -56.2').ok).toBe(false);
    expect(leerCoordenadas('https://www.google.com/maps/place/Club+Bigu%C3%A1').ok).toBe(false);
  });
});

describe('leerNumeroCoordenada', () => {
  it('acepta punto o coma y signo menos', () => {
    expect(leerNumeroCoordenada('-34.9011')).toBe(-34.9011);
    expect(leerNumeroCoordenada('-34,9011')).toBe(-34.9011);
    expect(leerNumeroCoordenada('−56.2')).toBe(-56.2);
    expect(leerNumeroCoordenada(' 56 ')).toBe(56);
  });
  it('rechaza lo que no es un número', () => {
    expect(leerNumeroCoordenada('')).toBeNull();
    expect(leerNumeroCoordenada('-')).toBeNull();
    expect(leerNumeroCoordenada('-34.9, -56.2')).toBeNull();
    expect(leerNumeroCoordenada('abc')).toBeNull();
  });
});

describe('ayudas de ubicación', () => {
  it('reconoce el punto por defecto del formulario viejo', () => {
    expect(esPuntoPorDefecto({ lat: -34.9, lng: -56.2 })).toBe(true);
    expect(esPuntoPorDefecto({ lat: -34.9011, lng: -56.1645 })).toBe(false);
  });
  it('avisa si el punto cae fuera de Sudamérica (latitud y longitud al revés)', () => {
    expect(fueraDeSudamerica({ lat: -34.9, lng: -56.2 })).toBe(false);
    expect(fueraDeSudamerica({ lat: -56.2, lng: -34.9 })).toBe(true);
    expect(fueraDeSudamerica({ lat: 34.9, lng: 56.2 })).toBe(true);
  });
  it('arma el link para chequear el pin', () => {
    expect(linkMapa({ lat: -34.9, lng: -56.2 })).toBe('https://www.google.com/maps?q=-34.9,-56.2');
  });
});
