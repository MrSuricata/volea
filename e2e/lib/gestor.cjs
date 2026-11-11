// Cómo maneja la prueba el gestor de torneos (/admin?tab=torneos), como lo haría Brian: solo
// clics y teclado sobre la pantalla real. El estado del torneo se LEE (nunca se escribe) del
// localStorage del gestor para saber los ids y armar el oráculo.
const { BASE } = require('./harness.cjs');

const CLAVE_CACHE = 'volea-torneos:cache';

async function login(page, { email = 'brian@volea.uy', password = 'clave-e2e-123' } = {}) {
  await page.goto(`${BASE}/admin?tab=torneos`);
  await page.getByRole('heading', { name: /entrar/i }).waitFor({ timeout: 20000 });
  const emailInput = page.getByLabel('Email');
  // OJO: la caja de contraseña NO tiene etiqueta accesible (Campo le pone el id al <div> que la
  // envuelve, no al <input>): se la busca por tipo.
  const clave = page.locator('input[autocomplete="current-password"]');
  if (!(await clave.count())) await page.getByRole('button', { name: 'Entrar con contraseña' }).click();
  await emailInput.fill(email);
  await clave.fill(password);
  await page.getByRole('button', { name: /Entrar al panel/ }).click();
  await page.getByRole('heading', { name: 'Gestor de torneos' }).waitFor({ timeout: 20000 });
}

async function estado(page) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), CLAVE_CACHE);
}

async function torneoLocal(page, id) {
  const c = await estado(page);
  return c && c.estado.torneos.find((t) => t.id === id);
}

async function torneoPorNombre(page, nombre) {
  const c = await estado(page);
  return c && c.estado.torneos.find((t) => t.nombre === nombre);
}

async function esperarSincronizado(page, timeout = 20000) {
  await page.getByRole('button', { name: /^Sincronizado\./ }).waitFor({ timeout });
}

async function dialogo(page) {
  const d = page.getByRole('dialog');
  await d.waitFor();
  return d;
}

async function crearTorneo(page, { nombre, categoria = 'A' }) {
  await page.getByRole('button', { name: 'Nuevo torneo' }).first().click();
  let d = await dialogo(page);
  await d.getByRole('textbox').first().fill(nombre);
  await d.getByText('Grupos + Llave', { exact: true }).click();
  await d.getByRole('button', { name: 'Crear' }).click();
  await page.getByRole('dialog').getByText('Categoría del torneo').waitFor();
  d = page.getByRole('dialog');
  await d.getByText(`Categoría ${categoria}`, { exact: true }).click();
  await d.getByRole('button', { name: 'Crear' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('heading', { name: nombre }).waitFor();
  const t = await torneoPorNombre(page, nombre);
  return t.id;
}

async function abrirTorneo(page, nombre) {
  if (await page.getByRole('heading', { name: nombre, exact: true }).count()) return;
  if (!(await page.getByRole('heading', { name: 'Gestor de torneos' }).count())) {
    await page.locator('main.contenedor').getByRole('button', { name: 'Torneos', exact: true }).first().click();
  }
  await page.getByRole('button', { name: new RegExp(`^${escapar(nombre)}`) }).first().click();
  await page.getByRole('heading', { name: nombre }).waitFor();
}

function escapar(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function abrirAjustes(page) {
  const b = page.getByRole('button', { name: /^Ajustes/ });
  if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click();
}
async function cerrarAjustes(page) {
  const b = page.getByRole('button', { name: /^Ajustes/ });
  if ((await b.getAttribute('aria-expanded')) === 'true') await b.click();
}

async function cargarParejas(page, nombres) {
  // Camino de Brian con la lista de inscriptos: pegar los jugadores y "Emparejar en orden".
  await page.getByRole('button', { name: /Pegar una lista de jugadores/ }).click();
  const jugadores = nombres.flatMap((n) => n.split(' y '));
  await page.getByLabel('Lista de jugadores, uno por línea').fill(jugadores.join('\n'));
  await page.getByRole('button', { name: 'Emparejar en orden' }).click();
}

async function irAGrupos(page) {
  await page.getByRole('button', { name: 'Seguir: Grupos' }).click();
  await page.getByText('Cantidad de grupos').waitFor();
}

async function elegirCantidadGrupos(page, n) {
  const sel = page.getByLabel('Cantidad de grupos');
  const actual = await sel.inputValue();
  if (actual !== String(n)) await sel.selectOption(String(n));
}

async function idaYVuelta(page, activo) {
  const sw = page.getByRole('switch', { name: /Ida y vuelta/ });
  if ((await sw.getAttribute('aria-checked')) !== String(activo)) await sw.click();
}

async function sortear(page) {
  await page.getByRole('button', { name: /Sortear grupos|Volver a sortear/ }).click();
  const conf = page.getByRole('dialog');
  if (await conf.count()) await conf.getByRole('button', { name: 'Sortear' }).click();
}

async function confirmarGrupos(page) {
  await page.getByRole('button', { name: 'Confirmar grupos y armar fixture' }).click();
  await page.getByText(/de \d+ jugados/).waitFor();
}

async function elegirFormatoEnAjustes(page, valorTexto) {
  await abrirAjustes(page);
  await page.getByLabel('Formato de la llave').first().selectOption({ label: valorTexto });
}

// Carga un resultado en una fila de la fase de grupos (vista "Por rondas"): dentro del bloque de
// la ronda, la fila que tiene las cajas "Puntos de X" y "Puntos de Y"; guarda con Enter (lo que
// hace Brian en la compu).
async function cargarResultadoGrupo(page, ronda, nombreA, nombreB, pa, pb) {
  const bloque = page.locator('div.rounded-xl', { has: page.getByRole('heading', { name: `Ronda ${ronda}`, exact: true }) }).last();
  const fila = bloque.locator('div.rounded-xl.border.bg-white')
    .filter({ has: page.getByLabel(`Puntos de ${nombreA}`, { exact: true }) })
    .filter({ has: page.getByLabel(`Puntos de ${nombreB}`, { exact: true }) });
  const cajaA = fila.getByLabel(`Puntos de ${nombreA}`, { exact: true });
  const cajaB = fila.getByLabel(`Puntos de ${nombreB}`, { exact: true });
  await cajaA.fill(String(pa));
  await cajaB.fill(String(pb));
  await cajaB.press('Enter');
}

module.exports = {
  CLAVE_CACHE, login, estado, torneoLocal, torneoPorNombre, esperarSincronizado, crearTorneo, abrirTorneo, abrirAjustes, cerrarAjustes,
  cargarParejas, irAGrupos, elegirCantidadGrupos, idaYVuelta, sortear, confirmarGrupos, elegirFormatoEnAjustes, cargarResultadoGrupo, escapar,
};
