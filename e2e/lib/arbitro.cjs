// Cómo maneja la prueba la pantalla del árbitro (/arbitro) y la hoja de códigos del gestor, más un
// oráculo chico de las reglas de tanteo (independiente de src/torneos/arbitraje/motor.ts).
const { BASE } = require('./harness.cjs');
const g = require('./gestor.cjs');

// ─── Gestor: hoja de códigos ─────────────────────────────────────────────────

/** Abre "Códigos de árbitro" y devuelve [{codigo, titulo, a, b}] tal como los ve Brian. */
async function leerHojaCodigos(page) {
  await g.abrirAjustes(page);
  await page.getByRole('button', { name: 'Códigos de árbitro' }).click();
  const d = page.getByRole('dialog');
  await d.getByText('Generando códigos…').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  const filas = await d.locator('ul li').evaluateAll((lis) => lis.map((li) => {
    const codigo = li.querySelector('span.font-mono')?.innerText.trim() ?? '';
    const resto = li.querySelector('span.min-w-0')?.innerText.trim() ?? '';
    return { codigo, resto };
  }));
  const error = await d.locator('p.bg-red-50').allInnerTexts();
  const out = filas.map((f) => {
    const [titulo, cruce] = f.resto.split(' · ').length > 2 ? [f.resto.split(' · ').slice(0, -1).join(' · '), f.resto.split(' · ').slice(-1)[0]] : f.resto.split(' · ');
    const [a, b] = (cruce || '').split(/\s+vs\s+/);
    return { codigo: f.codigo, titulo, a: (a || '').trim(), b: (b || '').trim() };
  });
  return { filas: out, error: error.join(' '), dialogo: d };
}

async function cerrarHoja(page) {
  const d = page.getByRole('dialog');
  if (await d.count()) await page.keyboard.press('Escape');
  await d.waitFor({ state: 'detached' }).catch(() => {});
}

async function elegirArbitraje(page, fase, texto) {
  await g.abrirAjustes(page);
  await page.getByLabel(fase === 'grupos' ? 'Árbitro · fase de grupos' : 'Árbitro · llave').selectOption({ label: texto });
}

// ─── Pantalla del árbitro ────────────────────────────────────────────────────

async function entrar(page, codigo, { navegar = true } = {}) {
  if (navegar) await page.goto(`${BASE}/arbitro`);
  const caja = page.getByLabel('Código del partido');
  await caja.waitFor({ timeout: 15000 });
  await caja.fill(codigo);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

async function empezar(page, { tipo, a, mejorDe, saca }) {
  await page.getByText('¿Quién saca primero?').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: tipo === 'rally' ? 'Rally' : 'Saque tradicional', exact: true }).click();
  await page.getByRole('button', { name: `A ${a}`, exact: true }).click();
  await page.getByRole('button', { name: mejorDe === 3 ? 'Mejor de 3' : 'Un game', exact: true }).click();
  const botonesSaca = page.locator('p', { hasText: '¿Quién saca primero?' }).locator('xpath=following-sibling::div[1]').getByRole('button');
  await botonesSaca.nth(saca === 'A' ? 0 : 1).click();
  await page.getByRole('button', { name: 'Empezar partido' }).click();
  await page.getByRole('button', { name: 'Ganó el que saca' }).waitFor();
}

/** Lo que muestra el tanteador: nombres, puntos, quién saca (resaltado), canto, games y avisos. */
async function leer(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main main') || document.querySelector('main');
    const cajas = [...main.querySelectorAll('div.grid.grid-cols-2 > div.rounded-2xl')];
    const lados = cajas.map((c) => ({
      nombre: c.querySelector('p')?.innerText.trim(),
      puntos: Number(c.querySelector('p.text-6xl')?.innerText.trim()),
      saca: c.className.includes('bg-[#CCFF00]'),
    }));
    const canto = main.querySelector('p.text-5xl')?.innerText.trim() ?? null;
    const games = [...main.querySelectorAll('p')].map((p) => p.innerText.trim()).find((t) => /^Games \d+-\d+$/.test(t)) ?? null;
    const avisos = [...main.querySelectorAll('p')].map((p) => p.innerText.trim()).filter((t) => /CAMBIO DE LADO|FIN DEL GAME|Sin señal|Otro dispositivo|Ganó /.test(t));
    const alerta = main.querySelector('[role=alert]')?.innerText.trim() ?? null;
    const tiempos = [...main.querySelectorAll('button')].map((b) => b.innerText.trim()).filter((t) => t.startsWith('Tiempo'));
    return { lados, canto, games, avisos, alerta, tiempos, texto: main.innerText.slice(0, 600) };
  });
}

async function punto(page, quien) {
  await page.getByRole('button', { name: quien === 'saca' ? 'Ganó el que saca' : 'Ganó el que recibe' }).click();
}

// ─── Oráculo de tanteo (reglas del diseño, escritas aparte) ──────────────────

class Tanteo {
  constructor({ tipo, a, mejorDe }, saca, dobles = true) {
    Object.assign(this, { tipo, objetivo: a, mejorDe, dobles });
    this.games = []; this.gA = 0; this.gB = 0;
    this.terminado = false;
    this.empezar(saca);
  }
  empezar(saca) { this.pA = 0; this.pB = 0; this.saca = saca; this.primero = saca; this.servidor = this.tipo === 'sideout' && this.dobles ? 2 : 1; }
  rally(gana /* 'saca'|'recibe' */) {
    if (this.terminado) return;
    const sacador = this.saca;
    const otro = sacador === 'A' ? 'B' : 'A';
    const ganador = gana === 'saca' ? sacador : otro;
    if (this.tipo === 'rally') {
      if (ganador === 'A') this.pA++; else this.pB++;
      if (ganador !== sacador) this.saca = ganador;
    } else if (ganador === sacador) {
      if (ganador === 'A') this.pA++; else this.pB++;
    } else if (this.dobles && this.servidor === 1) {
      this.servidor = 2;
    } else { this.saca = otro; this.servidor = 1; }
    const fin = (x, y) => x >= this.objetivo && x - y >= 2;
    if (fin(this.pA, this.pB) || fin(this.pB, this.pA)) {
      this.games.push({ a: this.pA, b: this.pB });
      if (this.pA > this.pB) this.gA++; else this.gB++;
      const nec = this.mejorDe === 3 ? 2 : 1;
      if (this.gA === nec || this.gB === nec) { this.terminado = true; this.ganador = this.gA === nec ? 'A' : 'B'; }
      else this.empezar(this.primero === 'A' ? 'B' : 'A');
    }
  }
  canto() {
    const ps = this.saca === 'A' ? this.pA : this.pB;
    const pr = this.saca === 'A' ? this.pB : this.pA;
    return this.tipo === 'sideout' && this.dobles ? `${ps}-${pr}-${this.servidor}` : `${ps}-${pr}`;
  }
  resultado() {
    if (this.mejorDe === 1) return { puntosA: this.games[0].a, puntosB: this.games[0].b };
    return { puntosA: this.gA, puntosB: this.gB, games: this.games };
  }
}

module.exports = { leerHojaCodigos, cerrarHoja, elegirArbitraje, entrar, empezar, leer, punto, Tanteo };
