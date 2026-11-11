#!/usr/bin/env node
// Corre los escenarios de punta a punta.
//   node e2e/run.cjs                      → todos
//   node e2e/run.cjs gestor               → los 16 del gestor (8 formatos × una rueda / ida y vuelta)
//   node e2e/run.cjs gestor-final-1r ...  → escenarios sueltos
//   node e2e/run.cjs --listar             → lista de escenarios
// Levanta el dev server en 127.0.0.1:5311 si no está corriendo (y lo apaga al terminar).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { correrEscenario, BASE, CAPTURAS } = require('./lib/harness.cjs');
const gestor = require('./escenarios/gestor.cjs');
const arbitro = require('./escenarios/arbitro.cjs');
const publico = require('./escenarios/publico.cjs');
const sinBase = require('./escenarios/sinBase.cjs');

const ESCENARIOS = {};
for (const id of gestor.idsDeEscenarios()) {
  const [, formato, rueda] = id.match(/^gestor-(.+)-(1r|iv)$/);
  ESCENARIOS[id] = { grupo: 'gestor', fn: (esc) => gestor.flujoGestor(esc, formato, rueda === 'iv') };
}
for (const f of ['cruces4', 'auto', 'copas']) ESCENARIOS[`gestor-${f}-1r-celular`] = { grupo: 'gestor-celular', fn: (esc) => gestor.flujoGestor(esc, f, false, require('./lib/harness.cjs').CELULAR) };
for (const [id, fn] of Object.entries(arbitro.ESCENARIOS)) ESCENARIOS[id] = { grupo: 'arbitro', fn };
for (const [id, fn] of Object.entries(publico.ESCENARIOS)) ESCENARIOS[id] = { grupo: 'publico', fn };
for (const [id, fn] of Object.entries(sinBase.ESCENARIOS)) ESCENARIOS[id] = { grupo: 'sin-base', fn };

function arriba() {
  return new Promise((res) => {
    const req = http.get(BASE, (r) => { r.resume(); res(r.statusCode === 200); });
    req.on('error', () => res(false));
    req.setTimeout(2000, () => { req.destroy(); res(false); });
  });
}

async function levantarServidor() {
  if (await arriba()) return null;
  const raiz = path.resolve(__dirname, '..');
  const proc = spawn('npx', ['vite', '--config', 'e2e/vite.e2e.config.mjs'], { cwd: raiz, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i++) {
    if (await arriba()) return proc;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('No levantó el dev server en 5311');
}

(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--listar')) {
    for (const [id, e] of Object.entries(ESCENARIOS)) console.log(`${e.grupo.padEnd(8)} ${id}`);
    return;
  }
  let ids = args.length === 0 ? Object.keys(ESCENARIOS) : args.flatMap((a) => (ESCENARIOS[a] ? [a] : Object.keys(ESCENARIOS).filter((id) => ESCENARIOS[id].grupo === a)));
  if (ids.length === 0) { console.error('No hay escenarios con ese nombre. Usá --listar.'); process.exit(2); }
  let servidor = await levantarServidor();
  const resumen = [];
  try {
    for (const id of ids) {
      if (!(await arriba())) { const s2 = await levantarServidor(); if (s2) servidor = s2; }
      const t0 = Date.now();
      process.stdout.write(`▶ ${id} … `);
      const r = await correrEscenario(id, ESCENARIOS[id].fn);
      const seg = Math.round((Date.now() - t0) / 1000);
      console.log(`${r.estado} (${seg}s, ${r.verificaciones.total - r.verificaciones.fallidas.length}/${r.verificaciones.total} verificaciones)`);
      if (r.error) console.log(`   error: ${r.error.split('\n')[0]}`);
      for (const f of r.verificaciones.fallidas) console.log(`   ✗ ${f.mensaje}${f.detalle ? ` :: ${JSON.stringify(f.detalle).slice(0, 300)}` : ''}`);
      resumen.push({ id, estado: r.estado, seg, verificaciones: `${r.verificaciones.total - r.verificaciones.fallidas.length}/${r.verificaciones.total}`, error: r.error, fallidas: r.verificaciones.fallidas.map((f) => f.mensaje), observaciones: r.observacionesPorTipo, reporte: path.join(CAPTURAS, id, 'reporte.json') });
    }
  } finally {
    if (servidor) { try { process.kill(-servidor.pid); } catch { /* ya terminó */ } }
  }
  fs.mkdirSync(CAPTURAS, { recursive: true });
  fs.writeFileSync(path.join(CAPTURAS, `resumen-${Date.now()}.json`), JSON.stringify(resumen, null, 2));
  const mal = resumen.filter((r) => r.estado !== 'PASA').length;
  console.log(`\n${resumen.length - mal}/${resumen.length} escenarios PASAN. Reportes en ${CAPTURAS}/<escenario>/reporte.json`);
  process.exit(mal ? 1 : 0);
})();
