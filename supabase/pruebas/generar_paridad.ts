// Genera paridad_motor.sql: partidos al azar (con semilla fija) contados por el motor de la web
// (src/torneos/arbitraje/motor.ts) para comparar contra _arbitraje_replay() de la base (v37).
// Regenerar si se toca cualquiera de los dos:  npx vite-node supabase/pruebas/generar_paridad.ts > supabase/pruebas/paridad_motor.sql
import type { FormatoArbitraje } from '../../src/torneos/engine/tipos';
import { estadoDe, formatoDelPartido, resultadoFinal, resumen, type Jugada, type Lado } from '../../src/torneos/arbitraje/motor';

let s = 20261111;
const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
const elegir = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const sql = (x: unknown) => `'${JSON.stringify(x).replace(/'/g, "''")}'`;

const FORMATOS: FormatoArbitraje[] = [];
for (const tipo of ['rally', 'sideout'] as const) for (const a of [11, 15, 21] as const) for (const mejorDe of [1, 3] as const) FORMATOS.push({ tipo, a, mejorDe });

const lineas: string[] = [
  '-- GENERADO por supabase/pruebas/generar_paridad.ts: no editar a mano.',
  '\\set ON_ERROR_STOP 1',
  // Jugadas compactas: seq = 'A'/'B' rally ganado, 'a'/'b' tiempo pedido.
  `CREATE FUNCTION pg_temp.jug(saca text, da int, db int, formato jsonb, seq text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('t', 'inicio', 'saca', saca, 'derechaA', da, 'derechaB', db, 'formato', formato)))
      || COALESCE((SELECT jsonb_agg(CASE WHEN c IN ('A', 'B') THEN jsonb_build_object('t', 'rally', 'gana', c)
                                         ELSE jsonb_build_object('t', 'tiempo', 'equipo', upper(c)) END ORDER BY o)
                     FROM regexp_split_to_table(seq, '') WITH ORDINALITY AS x(c, o) WHERE c <> ''), '[]'::jsonb)
$$;`,
  `CREATE FUNCTION pg_temp.par(n int, base jsonb, dobles boolean, j jsonb, esperado jsonb, resultado jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f jsonb := _arbitraje_formato_de(j, base); m jsonb := _arbitraje_replay(f, dobles, j);
BEGIN
  IF m IS DISTINCT FROM esperado THEN RAISE EXCEPTION 'FALLA paridad caso %: base % / web %', n, m, esperado; END IF;
  IF _arbitraje_resultado_de(f, m) IS DISTINCT FROM resultado THEN RAISE EXCEPTION 'FALLA resultado caso %: base % / web %', n, _arbitraje_resultado_de(f, m), resultado; END IF;
  IF resultado IS NOT NULL AND NOT _arbitraje_resultado_legal(f, resultado) THEN RAISE EXCEPTION 'FALLA legal caso %: %', n, resultado; END IF;
END $$;`,
];

const CASOS = 400;
for (let n = 0; n < CASOS; n++) {
  const base = elegir(FORMATOS);
  const dobles = rnd() < 0.75;
  const inicio: Jugada = { t: 'inicio', saca: elegir(['A', 'B'] as const), derechaA: elegir([0, 1] as const), derechaB: elegir([0, 1] as const) };
  if (rnd() < 0.3) inicio.formato = elegir(FORMATOS);
  const j: Jugada[] = [inicio];
  // Un lado un poco más fuerte para que haya de todo: palizas, partidos parejos y alargues.
  const sesgo = 0.35 + rnd() * 0.3;
  const largo = Math.floor(rnd() * 160);
  for (let i = 0; i < largo; i++) {
    if (rnd() < 0.04) j.push({ t: 'tiempo', equipo: elegir(['A', 'B'] as const) });
    else j.push({ t: 'rally', gana: (rnd() < sesgo ? 'A' : 'B') as Lado });
  }
  const f = formatoDelPartido(base, j);
  const e = estadoDe(f, dobles, j);
  const seq = j.slice(1).map((x) => (x.t === 'rally' ? x.gana : x.t === 'tiempo' ? x.equipo.toLowerCase() : '')).join('');
  const jug = `pg_temp.jug('${inicio.saca}', ${inicio.derechaA}, ${inicio.derechaB}, ${inicio.formato ? sql(inicio.formato) : 'NULL'}, '${seq}')`;
  const res = resultadoFinal(f, e);
  lineas.push(`SELECT pg_temp.par(${n}, ${sql(base)}, ${dobles}, ${jug}, ${sql(resumen(e))}, ${res ? sql(res) : 'NULL'});`);
}
lineas.push(`\\echo 'PARIDAD motor web / base: ${CASOS} partidos iguales'`);
console.log(lineas.join('\n'));
