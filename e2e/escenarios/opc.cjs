// Recorrido 4: One Point Challenge (eliminación directa individual, cada cruce a UN punto).
// El organizador, desde el celular: crea un OPC de 13 jugadores, pega la lista, arma la llave y
// la juega entera a un toque por cruce en la pantalla de control; corrige un resultado de la
// ronda 1 (con cascada: se borran los cruces posteriores y se vuelven a jugar) y llega al
// campeón, que se compara con un cálculo independiente de la llave "rolling". Al final, el
// público abre /torneos/:id en el celular: ganador resaltado sin números, "pasa directo" y campeón.
const { CELULAR, BASE } = require('../lib/harness.cjs');
const g = require('../lib/gestor.cjs');
const { esperarEstado } = require('./gestor.cjs');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const TABLETA = { width: 820, height: 1180 };

const JUGADORES = [
  'Ana Acosta', 'Bruno Benítez', 'JuanCarlosDeLosSantosPérezRodríguez', 'Diego Duarte', 'Eli Espinoza',
  'Facundo Ferreira', 'Gisela Gómez', 'Hernán Herrera', 'Inés Ibarra', 'Juan Juárez', 'Karina Lima',
  'Lucas Méndez', 'María José Núñez',
];

// ─── Oráculo: la llave rolling y quién gana, escritos aparte de la app ───────────────────────
// Rolling: cada ronda empareja 1v2, 3v4…; si son impares el último pasa directo y entra AL FRENTE
// de la ronda siguiente. Gana el de menor índice en la lista (el "más fuerte"), salvo cuando la
// suma de los dos índices es múltiplo de 5 (sorpresa: gana el otro), para que no sea trivial.
function ganaRegla(i, j) {
  const fuerte = Math.min(i, j); const debil = Math.max(i, j);
  return (i + j) % 5 === 0 ? debil : fuerte;
}
/** Simula la llave entera. `forzados`: Map "ronda:cruce" → índice del ganador. */
function simular(n, forzados = new Map()) {
  let pool = Array.from({ length: n }, (_, i) => i);
  const rondas = [];
  let ronda = 1;
  while (pool.length > 1) {
    const cruces = [];
    let k = 0;
    for (; k + 1 < pool.length; k += 2) {
      const [a, b] = [pool[k], pool[k + 1]];
      const clave = `${ronda}:${cruces.length + 1}`;
      cruces.push({ a, b, gana: forzados.has(clave) ? forzados.get(clave) : ganaRegla(a, b) });
    }
    const directo = k < pool.length ? pool[k] : null;
    rondas.push({ ronda, cruces, directo });
    pool = directo !== null ? [directo, ...cruces.map((c) => c.gana)] : cruces.map((c) => c.gana);
    ronda += 1;
  }
  const final = rondas[rondas.length - 1].cruces[0];
  return { rondas, campeon: final.gana, subcampeon: final.gana === final.a ? final.b : final.a };
}

// ─── Cómo se maneja la pantalla ─────────────────────────────────────────────────────────────

async function crearOpc(page, nombre) {
  await page.getByRole('button', { name: 'Nuevo torneo' }).first().click();
  let d = page.getByRole('dialog');
  await d.waitFor();
  await d.getByRole('textbox').first().fill(nombre);
  await d.getByText('One Point Challenge', { exact: true }).click();
  await d.getByRole('button', { name: 'Crear' }).click();
  await page.getByRole('dialog').getByText('Categoría del torneo').waitFor();
  d = page.getByRole('dialog');
  await d.getByText('Categoría A', { exact: true }).click();
  await d.getByRole('button', { name: 'Crear' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('heading', { name: nombre }).waitFor();
  return (await g.torneoPorNombre(page, nombre)).id;
}

/** Lee el cruce que muestra la vista "Cruce" (los dos botones grandes). */
async function cruceEnPantalla(page) {
  const sec = page.locator('section[aria-label="Cruce"]');
  await sec.waitFor();
  const titulo = await sec.locator('p').nth(1).innerText();
  const ronda = await sec.locator('p').first().innerText();
  const botones = sec.getByRole('button', { name: /^Ganó / });
  const nombres = (await botones.evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))).map((s) => s.replace(/^Ganó /, ''));
  return { titulo, ronda, nombres };
}

/** Si el cruce a la vista no está para jugar, toca el atajo al próximo ("Sigue"/"Para jugar"). */
async function irAlProximo(page) {
  const sec = page.locator('section[aria-label="Cruce"]');
  await sec.waitFor();
  // para jugar = los dos botones con nombre y ninguno marcado como ganador
  const listo = await sec.getByRole('button', { name: /^Ganó / }).evaluateAll((bs) => bs.length === 2 && bs.every((x) => !x.hasAttribute('aria-pressed')));
  if (listo) return;
  const atajo = sec.getByRole('button', { name: /^(Sigue|Para jugar)/ });
  if (await atajo.count()) await atajo.first().click();
}

/** Un toque en la vista "Cruce" sobre el que gana según la regla del oráculo. */
async function tocarGanador(esc, page, id, idx) {
  await irAlProximo(page);
  const c = await cruceEnPantalla(page);
  esc.exigir(c.nombres.length === 2, 'el cruce en pantalla tiene a los dos jugadores definidos', c);
  const [i, j] = c.nombres.map(idx);
  const antes = (await g.torneoLocal(page, id)).partidosLlave.filter((p) => p.puntosA !== null).length;
  // UN toque sobre el nombre del que ganó el punto
  await page.locator('section[aria-label="Cruce"]').getByRole('button', { name: `Ganó ${JUGADORES[ganaRegla(i, j)]}`, exact: true }).click();
  const t = await esperarEstado(page, id, (x) => x.partidosLlave.filter((p) => p.puntosA !== null).length === antes + 1, 5000);
  esc.exigir(t.partidosLlave.filter((p) => p.puntosA !== null).length === antes + 1, `el toque en ${c.ronda} · ${c.titulo} guardó un resultado`, c);
}

/** Mide dónde aparece el aviso "Ganó X · Deshacer" respecto de las barras y de Anterior/Siguiente. */
async function revisarAviso(esc, page) {
  const r = await page.evaluate(() => {
    const caja = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
    const a = document.querySelector('[data-opc-aviso]');
    const sig = [...document.querySelectorAll('section[aria-label="Cruce"] button')].find((b) => /Siguiente/.test(b.innerText));
    return {
      aviso: caja(a), texto: a ? a.innerText : null,
      nav: caja(document.querySelector('nav[aria-label="Accesos rápidos"]')), sig: caja(sig), barra: caja(document.querySelector('.opc-barra')), alto: innerHeight,
    };
  });
  esc.verificar(r.aviso && /Ganó/.test(r.texto) && /Deshacer/.test(r.texto), 'aparece el aviso "Ganó X · Deshacer"', r);
  if (!r.aviso) return;
  esc.verificar(r.aviso.bottom <= (r.nav ? r.nav.top : r.alto) + 1, 'el aviso queda abajo, arriba de la barra de accesos del panel', r);
  esc.verificar(!r.sig || r.aviso.bottom <= r.sig.top + 1 || r.aviso.top >= r.sig.bottom - 1, 'el aviso no tapa Anterior/Siguiente', r);
  esc.verificar(!r.barra || r.aviso.top >= r.barra.bottom, 'el aviso no tapa la barra de arriba (llaves y guardado)', r);
}

/** Juega desde la vista "Cruce" hasta que no quede cruce para jugar. */
async function jugarHastaElFinal(esc, page, id, idx) {
  for (let vuelta = 0; vuelta < 30; vuelta++) {
    const t = await g.torneoLocal(page, id);
    if (t.partidosLlave.every((p) => p.puntosA !== null)) return;
    await tocarGanador(esc, page, id, idx);
    await esperar(900); // la pausa de 0,7 s y pasa solo al próximo
  }
  esc.exigir(false, 'la llave se terminó de jugar en menos de 30 toques');
}

async function abrirPublico(esc, nombre, viewport, id) {
  const page = await esc.contexto(nombre, viewport);
  await page.goto(`${BASE}/torneos/${id}`);
  await page.locator('.opc-pub').waitFor({ timeout: 20000 });
  return page;
}

// ─── El recorrido ───────────────────────────────────────────────────────────────────────────

async function opc13(esc) {
  const page = await esc.contexto('admin-celular', CELULAR);
  const nombre = 'One Point Challenge · Masculino';
  const idx = (n) => JUGADORES.indexOf(n);
  let id;

  await esc.paso('login del organizador (celular)', () => g.login(page));
  await esc.paso('crear el OPC y pegar los 13 jugadores', async () => {
    id = await crearOpc(page, nombre);
    await page.getByRole('button', { name: /Pegar lista de jugadores/ }).click();
    await page.getByLabel('Lista de jugadores, uno por línea').fill(JUGADORES.map((n, i) => `${i + 1}. ${n}`).join('\n'));
    await page.getByRole('button', { name: 'Agregar jugadores' }).click();
    const t = await esperarEstado(page, id, (x) => x.parejas.length === 13);
    esc.exigir(t.formato === 'individual', 'el torneo es individual (OPC)', t.formato);
    esc.exigir(JSON.stringify(t.parejas.map((p) => p.nombre)) === JSON.stringify(JUGADORES), 'los 13 jugadores quedan con el nombre y el orden de la lista (sin la numeración)', t.parejas.map((p) => p.nombre));
  });
  await esc.paso('armar la llave', async () => {
    await page.getByRole('button', { name: 'Seguir: Llave' }).click();
    await page.getByRole('button', { name: 'Armar llave', exact: true }).click();
    const t = await esperarEstado(page, id, (x) => Array.isArray(x.partidosLlave) && x.partidosLlave.length === 12);
    esc.exigir(t.partidosLlave && t.partidosLlave.length === 12, '13 jugadores = 12 cruces', t.partidosLlave && t.partidosLlave.length);
    await page.locator('section[aria-label="Cruce"]').waitFor();
    await esc.revisarPantalla(page, 'control-cruce-1');
  });

  const sim = simular(13);
  await esc.paso('jugar la ronda 1 entera a un toque por cruce', async () => {
    // Se juega toda la llave pero con una pausa en el medio para mirar la vista pública en vivo.
    const ronda1 = sim.rondas[0].cruces.length;
    for (let k = 0; k < ronda1; k++) {
      if (k === 1) {
        // Deshacer en la pausa de 0,7 s: borra el resultado y se queda en ese cruce (antes la
        // pausa seguía corriendo y lo llevaba igual al cruce siguiente).
        const antes = await cruceEnPantalla(page);
        await tocarGanador(esc, page, id, idx);
        await page.locator('[data-opc-aviso]').getByRole('button', { name: 'Deshacer' }).click();
        await esperar(1200);
        const despues = await cruceEnPantalla(page);
        const t = await g.torneoLocal(page, id);
        esc.verificar(t.partidosLlave.filter((p) => p.puntosA !== null).length === 1, 'Deshacer en la pausa borra el resultado', t.partidosLlave.filter((p) => p.puntosA !== null).length);
        esc.verificar(despues.titulo === antes.titulo && despues.ronda === antes.ronda && despues.nombres.join() === antes.nombres.join(), 'y se queda en el cruce deshecho (no avanza solo)', { antes, despues });
      }
      await tocarGanador(esc, page, id, idx);
      if (k === 0) { await revisarAviso(esc, page); await esc.captura(page, 'control-aviso-abajo-pantalla', { fullPage: false }); await esc.revisarPantalla(page, 'control-aviso-abajo'); }
      await esperar(900);
    }
    await g.esperarSincronizado(page).catch(() => {});
  });

  await esc.paso('vista Ronda: primero los pendientes, después los jugados con separador', async () => {
    await page.getByRole('radio', { name: 'Ronda', exact: true }).click();
    await page.locator('section[aria-label="Ronda"]').getByRole('radio', { name: /^Ronda 2/ }).click();
    // ronda 2: jugar el cruce 2 desde acá, así queda uno jugado entre pendientes
    const sec = page.locator('section[aria-label="Ronda"]');
    const c2 = sec.locator('li[data-cruce="2"]');
    const nombres = (await c2.getByRole('button', { name: /^Ganó / }).evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))).map((s) => s.replace(/^Ganó /, '').replace(/ \(cruce \d+\)$/, ''));
    const [i, j] = nombres.map(idx);
    await c2.getByRole('button', { name: `Ganó ${JUGADORES[ganaRegla(i, j)]} (cruce 2)` }).click();
    await esperar(900);
    const orden = await sec.locator('li[data-cruce]').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-cruce')));
    const sep = await sec.getByRole('separator').count();
    esc.verificar(orden[orden.length - 1] === '2' && orden.slice(0, -1).every((n, k, a) => k === 0 || +a[k - 1] < +n), 'pendientes en orden de juego arriba y el jugado (cruce 2) abajo, con su número', orden);
    esc.verificar(sep === 1, 'hay un separador entre pendientes y jugados', sep);
    await esc.revisarPantalla(page, 'control-ronda-pendientes-arriba');
    await esc.captura(page, 'control-ronda-pantalla', { fullPage: false });
    await page.setViewportSize(TABLETA);
    await esperar(300);
    await esc.revisarPantalla(page, 'control-ronda-tableta');
    await page.setViewportSize(CELULAR);
    await page.getByRole('radio', { name: 'Cruce', exact: true }).click();
  });

  await esc.paso('público en vivo: la pestaña elegida no se pierde con el refresco', async () => {
    const pub = await abrirPublico(esc, 'publico-vivo', CELULAR, id);
    const resumen = await pub.locator('.opc-pub-resumen').innerText();
    esc.verificar(/Ronda 2/i.test(resumen) && /faltan \d+ cruces/.test(resumen), 'el resumen dice la ronda en juego y cuántos cruces faltan', resumen);
    esc.verificar(/Próximo/i.test(resumen), 'el resumen dice cuál es el próximo cruce', resumen);
    const enJuego = await pub.getByRole('tab', { selected: true, name: /^Ronda 2/ }).count();
    esc.verificar(enJuego === 1, 'abre en la pestaña de la ronda en juego (Ronda 2)');
    await pub.getByRole('tab', { name: /^Ronda 1/ }).click();
    await esc.revisarPantalla(pub, 'publico-vivo-ronda1');
    // el organizador marca otro cruce; el público vuelve a la pestaña (refresca ya)
    const antes = (await g.torneoLocal(page, id)).partidosLlave.filter((p) => p.puntosA !== null).length;
    await tocarGanador(esc, page, id, idx);
    await g.esperarSincronizado(page).catch(() => {});
    await esperar(900);
    await pub.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const t1 = Date.now();
    let txt = '';
    while (Date.now() - t1 < 8000) {
      txt = await pub.locator('.opc-pub-resumen').innerText().catch(() => '');
      if (txt.includes(`${antes + 1} de 12`)) break;
      await esperar(250);
    }
    esc.verificar(txt.includes(`${antes + 1} de 12`), 'el público ve el cruce nuevo sin recargar', txt);
    const sigue = await pub.getByRole('tab', { selected: true, name: /^Ronda 1/ }).count();
    esc.verificar(sigue === 1, 'después del refresco sigue en la pestaña que eligió (Ronda 1)');
  });

  await esc.paso('jugar el resto hasta la final', async () => {
    await jugarHastaElFinal(esc, page, id, idx);
    await page.locator('section[aria-label="Podio"]').first().waitFor();
    const t = await g.torneoLocal(page, id);
    const campeonApp = await page.locator('section[aria-label="Podio"] h2').innerText();
    esc.verificar(campeonApp.toUpperCase() === JUGADORES[sim.campeon].toUpperCase(), 'campeón antes de corregir = cálculo independiente', { app: campeonApp, oraculo: JUGADORES[sim.campeon] });
    esc.verificar(t.partidosLlave.every((p) => p.puntosA !== null), 'los 12 cruces quedaron jugados');
    esc.verificar(t.partidosLlave.every((p) => (p.puntosA === 1 && p.puntosB === 0) || (p.puntosA === 0 && p.puntosB === 1)), 'cada cruce se guardó a un punto (1-0)');
    await esc.revisarPantalla(page, 'control-campeon-antes-de-corregir');
  });

  // Corrección: el cruce 1 de la ronda 1 lo ganó en realidad el otro. Se elige el cruce donde
  // jugó el campeón (o el 1 si no) para que la cascada cambie el resultado final.
  const r1 = sim.rondas[0].cruces;
  let nCruce = r1.findIndex((c) => c.a === sim.campeon || c.b === sim.campeon) + 1;
  if (nCruce === 0) nCruce = 1;
  const original = r1[nCruce - 1];
  const nuevoGanador = original.gana === original.a ? original.b : original.a;
  const forzados = new Map([[`1:${nCruce}`, nuevoGanador]]);
  const sim2 = simular(13, forzados);
  await esc.paso(`corregir el cruce ${nCruce} de la ronda 1 (con cascada)`, async () => {
    await page.getByRole('radio', { name: 'Ronda', exact: true }).click();
    await page.locator('section[aria-label="Ronda"]').getByRole('radio', { name: /^Ronda 1/ }).click();
    await page.locator('section[aria-label="Ronda"]').getByRole('button', { name: `Ganó ${JUGADORES[nuevoGanador]} (cruce ${nCruce})` }).click();
    const d = page.getByRole('dialog');
    await d.waitFor();
    const msg = await d.innerText();
    esc.verificar(/BORRA \d+ resultados?/.test(msg), 'la confirmación avisa cuántos resultados posteriores se borran', msg.slice(0, 300));
    await esc.revisarPantalla(page, 'control-corregir-confirmacion');
    await d.getByRole('button', { name: 'Cambiar ganador' }).click();
    const t = await esperarEstado(page, id, (x) => x.partidosLlave.some((p) => p.puntosA === null), 5000);
    const borrados = t.partidosLlave.filter((p) => p.puntosA === null).length;
    esc.verificar(borrados > 0, 'la corrección borró los cruces posteriores que dependían de él', borrados);
    esc.verificar(!(await page.locator('section[aria-label="Podio"]').count()), 'el podio desaparece hasta volver a jugar la final');
    await page.getByRole('radio', { name: 'Cruce', exact: true }).click();
  });
  await esc.paso('volver a jugar lo borrado y llegar al campeón', async () => {
    await jugarHastaElFinal(esc, page, id, idx);
    await page.locator('section[aria-label="Podio"]').first().waitFor();
    const campeonApp = await page.locator('section[aria-label="Podio"] h2').innerText();
    esc.verificar(campeonApp.toUpperCase() === JUGADORES[sim2.campeon].toUpperCase(), 'campeón después de corregir = cálculo independiente', { app: campeonApp, oraculo: JUGADORES[sim2.campeon], antes: JUGADORES[sim.campeon] });
    await page.getByRole('button', { name: 'Dar por terminado el torneo' }).click();
    await esperarEstado(page, id, (x) => x.fase === 'terminado', 5000);
    await g.esperarSincronizado(page).catch(() => {});
    await esc.revisarPantalla(page, 'control-terminado');
  });

  await esc.paso('vista pública en el celular: ganador resaltado, pasa directo y campeón', async () => {
    const pub = await abrirPublico(esc, 'publico-final', CELULAR, id);
    const campeon = (await pub.locator('[data-campeon]').innerText()).trim();
    const sub = (await pub.locator('[data-subcampeon]').innerText()).trim();
    esc.verificar(campeon.toUpperCase() === JUGADORES[sim2.campeon].toUpperCase(), 'la web muestra al campeón del cálculo independiente', { web: campeon, oraculo: JUGADORES[sim2.campeon] });
    esc.verificar(sub === JUGADORES[sim2.subcampeon], 'la web muestra al subcampeón', { web: sub, oraculo: JUGADORES[sim2.subcampeon] });
    await esc.revisarPantalla(pub, 'publico-final-celular');
    await pub.getByRole('tab', { name: /^Ronda 1/ }).click();
    const panel = pub.getByRole('tabpanel');
    const ganadores = await panel.locator('[data-gano]').evaluateAll((els) => els.map((e) => e.innerText));
    esc.verificar(ganadores.length === sim2.rondas[0].cruces.length && ganadores.every((s) => /GANÓ/i.test(s)), 'cada cruce jugado resalta al ganador con "Ganó"', ganadores);
    const esperados = sim2.rondas[0].cruces.map((c) => JUGADORES[c.gana]);
    esc.verificar(esperados.every((n, k) => ganadores[k] && ganadores[k].includes(n)), 'los ganadores de la ronda 1 son los del cálculo (incluida la corrección)', { web: ganadores, oraculo: esperados });
    const cajas = await panel.locator('.opc-pub-cruce').evaluateAll((els) => els.map((e) => e.innerText));
    esc.verificar(cajas.every((s) => !/(^|\s)[01](\s|$)/.test(s.replace(/Cruce \d+/gi, ''))), 'sin "1" ni "0" de marcador en los cruces', cajas.slice(0, 3));
    const directo = await panel.locator('[data-pasa-directo]').innerText().catch(() => '');
    const quien = JUGADORES[sim2.rondas[0].directo];
    esc.verificar(directo.includes(quien) && /pasa directo a la ronda 2/i.test(directo), `ronda 1: "${quien} pasa directo a la ronda 2"`, directo);
    const largo = await panel.getByText('JuanCarlosDeLosSantosPérezRodríguez').first().evaluate((e) => ({ cs: getComputedStyle(e).textOverflow, ancho: e.scrollWidth <= e.clientWidth + 1 })).catch(() => null);
    esc.verificar(largo && largo.cs !== 'ellipsis' && largo.ancho, 'el nombre largo sin espacios se parte, sin puntos suspensivos', largo);
    await esc.revisarPantalla(pub, 'publico-final-ronda1');
    await pub.getByRole('tab', { name: /^Ronda 2/ }).click();
    const viene = await pub.getByRole('tabpanel').getByText(/pasó directo de la ronda 1/).count();
    esc.verificar(viene === 1, 'ronda 2: el que pasó directo dice de dónde viene');
    await pub.getByRole('tab', { name: 'Cuadro completo' }).click();
    const pista = await pub.locator('.opc-pub-pista').innerText();
    esc.verificar(/Deslizá/.test(pista), 'el cuadro completo avisa que se desliza de costado', pista);
    await esc.revisarPantalla(pub, 'publico-final-cuadro');
    const tab = await abrirPublico(esc, 'publico-tableta', TABLETA, id);
    await esc.revisarPantalla(tab, 'publico-final-tableta');
  });
}

const ESCENARIOS = { 'opc-13-jugadores': opc13 };

module.exports = { ESCENARIOS, simular };
