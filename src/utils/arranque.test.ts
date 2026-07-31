import { describe, expect, it, vi } from 'vitest';
import { conLimite } from './arranque';

// Helpers: promesas que tardan / fallan / no resuelven nunca.
const enMs = <T>(ms: number, valor: T) => new Promise<T>((r) => setTimeout(() => r(valor), ms));
const nuncaResuelve = <T>() => new Promise<T>(() => {});
const falla = (mensaje: string) => Promise.reject(new Error(mensaje));

describe('conLimite', () => {
  it('si la promesa responde a tiempo, devuelve su valor', async () => {
    await expect(conLimite(enMs(5, 'datos'), 100, 'respaldo')).resolves.toBe('datos');
  });

  it('si la promesa NO responde a tiempo, devuelve el respaldo (no se cuelga)', async () => {
    vi.useFakeTimers();
    try {
      const p = conLimite(nuncaResuelve<string>(), 2500, 'respaldo');
      await vi.advanceTimersByTimeAsync(2500);
      await expect(p).resolves.toBe('respaldo');
    } finally {
      vi.useRealTimers();
    }
  });

  it('si la promesa RECHAZA, devuelve el respaldo en vez de propagar el error', async () => {
    await expect(conLimite(falla('sin red'), 100, 'respaldo')).resolves.toBe('respaldo');
  });

  it('una promesa que rechaza tarde no deja un unhandledRejection despues del timeout', async () => {
    // El respaldo ya se devolvio; si la promesa original rechaza despues, no debe
    // escaparse (en el navegador seria un "Uncaught (in promise)" en consola).
    let capturada: unknown = null;
    const alRechazar = (e: unknown) => { capturada = e; };
    process.on('unhandledRejection', alRechazar);
    try {
      const lenta = new Promise<string>((_, rej) => setTimeout(() => rej(new Error('tarde')), 20));
      await expect(conLimite(lenta, 5, 'respaldo')).resolves.toBe('respaldo');
      await new Promise((r) => setTimeout(r, 60)); // dar tiempo a que rechace y a que el runtime lo reporte
      expect(capturada).toBeNull();
    } finally {
      process.off('unhandledRejection', alRechazar);
    }
  });

  it('no espera el limite completo si la promesa resuelve antes (no retrasa el arranque)', async () => {
    const t0 = Date.now();
    await conLimite(enMs(5, 'datos'), 5000, 'respaldo');
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
