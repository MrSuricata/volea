// El motor de tanteo de la app (src/torneos/arbitraje/motor.ts) compilado al vuelo con esbuild para
// usarlo desde Node. Lo usa la base falsa v37 para rehacer la cuenta como lo hace la base real
// (_arbitraje_replay, cuya paridad con este motor prueba supabase/pruebas/paridad_motor.sql).
// La PRUEBA no lo usa como oráculo: el oráculo de tanteo es Tanteo en lib/arbitro.cjs.
const path = require('path');
const esbuild = require('esbuild');

const salida = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../../src/torneos/arbitraje/motor.ts')],
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
});
const modulo = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', 'require', salida.outputFiles[0].text)(modulo, modulo.exports, require);

module.exports = modulo.exports; // { estadoDe, resumen, resultadoFinal, formatoDelPartido, ... }
