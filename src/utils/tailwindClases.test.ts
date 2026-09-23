import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Tailwind ahora se compila en el build (antes lo generaba el Play CDN en el
// navegador mirando el DOM). El compilador solo lee el código fuente como
// texto: una clase armada en runtime (`bg-${color}-500`, 'text-' + tono) NO
// aparece escrita entera, no se genera, y el elemento queda sin estilo en
// producción sin ningún error visible. Este test frena eso antes del deploy.

const PREFIJOS = String.raw`(?:bg|text|border|ring|from|via|to|fill|stroke|grid-cols|gap|[pm][trblxy]?|[wh])`;
// `bg-${color}` dentro de un template literal.
const EN_TEMPLATE = new RegExp(String.raw`\b${PREFIJOS}-\$\{`, 'g');
// 'bg-' + color
const EN_CONCATENACION = new RegExp(String.raw`['"]${PREFIJOS}-['"]\s*\+`, 'g');
// Templates que NO son clases (keys de React, ids de accesibilidad): `h-${idx}`
// como key es legítimo y matchea el prefijo "h-".
const ATRIBUTO_NO_CLASE = /\b(?:key|id|htmlFor|name)=\{\s*$/;

function clasesDinamicas(codigo: string): string[] {
  const hallazgos: string[] = [];
  codigo.split(/\r?\n/).forEach((linea, i) => {
    const enTemplate = [...linea.matchAll(EN_TEMPLATE)].filter((m) => {
      const inicioTemplate = linea.lastIndexOf('`', m.index);
      return !(inicioTemplate >= 0 && ATRIBUTO_NO_CLASE.test(linea.slice(0, inicioTemplate)));
    });
    const enConcatenacion = [...linea.matchAll(EN_CONCATENACION)];
    if (enTemplate.length + enConcatenacion.length > 0) hallazgos.push(`línea ${i + 1}: ${linea.trim()}`);
  });
  return hallazgos;
}

const SRC = fileURLToPath(new URL('..', import.meta.url));

function archivosFuente(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) return archivosFuente(ruta);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [ruta] : [];
  });
}

describe('clases de Tailwind escritas enteras (Tailwind compilado)', () => {
  it('el detector marca clases armadas y deja pasar keys/ids', () => {
    const d = '$' + '{';
    expect(clasesDinamicas('<div className={`p-4 bg-' + d + 'color}-500`} />')).toHaveLength(1);
    expect(clasesDinamicas('<div className={`hover:w-' + d + 'n}`} />')).toHaveLength(1);
    expect(clasesDinamicas("const c = 'text-' + tono;")).toHaveLength(1);
    expect(clasesDinamicas('<h2 key={`h-' + d + 'idx}`} className="mt-8" />')).toHaveLength(0);
    expect(clasesDinamicas('<input id={`p-' + d + 'i}`} />')).toHaveLength(0);
    expect(clasesDinamicas("className={`px-2 ${ESTADO_CHIP[e]}`}")).toHaveLength(0);
  });

  it('ningún archivo de src arma clases con template o concatenación', () => {
    const archivos = archivosFuente(SRC);
    expect(archivos.length).toBeGreaterThan(50);
    const problemas = archivos.flatMap((ruta) =>
      clasesDinamicas(readFileSync(ruta, 'utf8')).map((h) => `${relative(SRC, ruta)} ${h}`),
    );
    expect(
      problemas,
      'Clases de Tailwind armadas en runtime: el build no las ve y quedan SIN estilo en producción. ' +
        'Escribí la clase entera (ej. un mapa { ok: "bg-green-500", error: "bg-red-500" } o un ternario) ' +
        'o, si no hay otra, agregala a safelist en tailwind.config.js.',
    ).toEqual([]);
  });
});
