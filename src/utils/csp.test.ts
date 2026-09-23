import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cspHashes } from '@vitejs/plugin-legacy';
import vercel from '../../vercel.json';

// La CSP de vercel.json permite los <script> inline por su hash. Si alguien toca
// el script del <head> de index.html (o se actualiza @vitejs/plugin-legacy) el
// hash cambia: en Report-Only solo llueven avisos, pero con la CSP activa el
// sitio dejaría de traducir los links viejos "#/…" y los navegadores viejos no
// cargarían. Este test obliga a actualizar el hash en el mismo commit.

const politica = (() => {
  const h = vercel.headers[0].headers.find((x) => x.key.startsWith('Content-Security-Policy'));
  if (!h) throw new Error('vercel.json no tiene Content-Security-Policy');
  return h.value;
})();

describe('Content-Security-Policy', () => {
  it('permite cada <script> inline de index.html por su hash', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter((m) => !/ld\+json/.test(m[1])); // JSON-LD no se ejecuta: la CSP no lo mira
    expect(inline.length).toBeGreaterThan(0);
    for (const m of inline) {
      const hash = createHash('sha256').update(m[2]).digest('base64');
      expect(politica).toContain(`'sha256-${hash}'`);
    }
  });

  it('permite los scripts inline que agrega @vitejs/plugin-legacy', () => {
    for (const h of cspHashes) expect(politica).toContain(`'sha256-${h}'`);
  });

  it('deja hablar con Supabase (REST, storage y realtime)', () => {
    expect(politica).toMatch(/connect-src[^;]*https:\/\/scftuxrtflfowohiewsc\.supabase\.co/);
    expect(politica).toMatch(/connect-src[^;]*wss:\/\/scftuxrtflfowohiewsc\.supabase\.co/);
  });
});
