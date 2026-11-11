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

// ─── "No se presentó" ───────────────────────────────────────────────────────────────────────
// El organizador marca ausentes desde la pantalla de control: Ana en la ronda 1 (pasa su rival
// solo), Diego y después JuanCarlos (los dos del cruce 2: JuanCarlos ya había pasado por el W.O.
// de Diego, así que pierde su cruce de la ronda 2 apenas se sabe el rival). Se juega hasta la
// final, se marca ausente a un finalista (campeón por W.O.), se desmarca a Diego (con la cascada
// que borra cruces jugados: primero se cancela, después se confirma), se vuelve a jugar hasta el
// campeón y se mira la vista pública.

/** Como simular(), con jugadores que no se presentaron (índices): pierden todo cruce; si son los dos, pasa el de arriba. */
function simularConAusentes(n, ausentes) {
  let pool = Array.from({ length: n }, (_, i) => i);
  const rondas = [];
  let ronda = 1;
  while (pool.length > 1) {
    const cruces = [];
    let k = 0;
    for (; k + 1 < pool.length; k += 2) {
      const [a, b] = [pool[k], pool[k + 1]];
      const wo = ausentes.has(a) || ausentes.has(b);
      const gana = !wo ? ganaRegla(a, b) : !ausentes.has(a) || ausentes.has(b) ? a : b;
      cruces.push({ a, b, gana, wo });
    }
    const directo = k < pool.length ? pool[k] : null;
    rondas.push({ ronda, cruces, directo });
    pool = directo !== null ? [directo, ...cruces.map((c) => c.gana)] : cruces.map((c) => c.gana);
    ronda += 1;
  }
  return { rondas, final: rondas[rondas.length - 1].cruces[0] };
}

const resueltos = (t) => t.partidosLlave.filter((p) => p.puntosA !== null).length;

/** Un toque sobre el ganador (regla del oráculo). Puede resolver además W.O. que quedaron listos. */
async function tocarGanadorAus(esc, page, id, idx) {
  await irAlProximo(page);
  const c = await cruceEnPantalla(page);
  esc.exigir(c.nombres.length === 2, 'el cruce en pantalla tiene a los dos jugadores definidos', c);
  const [i, j] = c.nombres.map(idx);
  const antes = resueltos(await g.torneoLocal(page, id));
  await page.locator('section[aria-label="Cruce"]').getByRole('button', { name: `Ganó ${JUGADORES[ganaRegla(i, j)]}`, exact: true }).click();
  const t = await esperarEstado(page, id, (x) => resueltos(x) > antes, 5000);
  esc.exigir(resueltos(t) > antes, `el toque en ${c.ronda} · ${c.titulo} guardó un resultado`, c);
  await esperar(900);
}

/** El gesto: "¿No se presentó alguien?" → "No se presentó: X" → confirmar. */
async function marcarAusente(esc, page, nombre, { captura } = {}) {
  const sec = page.locator('section[aria-label="Cruce"]');
  await sec.getByRole('button', { name: '¿No se presentó alguien?' }).click();
  await sec.getByRole('button', { name: `No se presentó: ${nombre}` }).click();
  const d = page.getByRole('dialog');
  await d.waitFor();
  const msg = await d.innerText();
  esc.verificar(msg.includes(nombre) && /no se presentó/i.test(msg), `la confirmación nombra a ${nombre}`, msg.slice(0, 200));
  if (captura) await esc.captura(page, captura, { fullPage: false });
  await d.getByRole('button', { name: 'No se presentó', exact: true }).click();
  await d.waitFor({ state: 'detached' });
}

async function abrirCruceDesdeRonda(page, nombreRonda, numero) {
  await page.getByRole('radio', { name: 'Ronda', exact: true }).click();
  const sec = page.locator('section[aria-label="Ronda"]');
  await sec.getByRole('radio', { name: new RegExp(`^${nombreRonda}`) }).click();
  await sec.locator(`li[data-cruce="${numero}"]`).getByRole('button', { name: /Ver grande/ }).click();
  await page.locator('section[aria-label="Cruce"]').waitFor();
}

/** Revisa la llave guardada: nunca un cruce listo con un ausente y los W.O. a favor del presente. */
function revisarLlave(esc, t, idDe, nombreDe, etiqueta) {
  const aus = new Set(t.ausentes || []);
  const ps = t.partidosLlave;
  const porId = new Map(ps.map((p) => [p.id, p]));
  const slot = (s) => {
    if (!s) return null;
    if (s.tipo === 'seed') return s.parejaId;
    const p = porId.get(s.partidoId);
    return p ? ganador(p) : null;
  };
  function ganador(p) {
    const a = slot(p.a); const b = slot(p.b);
    if (a === null || b === null || p.puntosA === null || p.puntosB === null) return null;
    return p.puntosA > p.puntosB ? a : b;
  }
  const malos = [];
  for (const p of ps) {
    const a = slot(p.a); const b = slot(p.b);
    if (a === null || b === null) continue;
    const conAus = aus.has(a) || aus.has(b);
    if (conAus && p.puntosA === null) malos.push(`listo con ausente: ${nombreDe(a)} vs ${nombreDe(b)}`);
    if (p.wo && aus.has(a) !== aus.has(b) && aus.has(ganador(p))) malos.push(`W.O. a favor del ausente: ${nombreDe(a)} vs ${nombreDe(b)}`);
  }
  esc.verificar(malos.length === 0, `${etiqueta}: ningún cruce listo con un ausente y cada W.O. a favor del que vino`, malos);
  return { ganador, slot };
}

async function opcAusentes(esc) {
  const page = await esc.contexto('admin-celular', CELULAR);
  const nombre = 'One Point Challenge · Ausentes';
  const idx = (n) => JUGADORES.indexOf(n);
  let id;
  let t;
  const [ANA, BRUNO, JC, DIEGO] = JUGADORES;
  let idDe = () => null;
  let nombreDe = () => '?';

  await esc.paso('login, crear el OPC de 13 y armar la llave', async () => {
    await g.login(page);
    id = await crearOpc(page, nombre);
    await page.getByRole('button', { name: /Pegar lista de jugadores/ }).click();
    await page.getByLabel('Lista de jugadores, uno por línea').fill(JUGADORES.join('\n'));
    await page.getByRole('button', { name: 'Agregar jugadores' }).click();
    await esperarEstado(page, id, (x) => x.parejas.length === 13);
    await page.getByRole('button', { name: 'Seguir: Llave' }).click();
    await page.getByRole('button', { name: 'Armar llave', exact: true }).click();
    t = await esperarEstado(page, id, (x) => Array.isArray(x.partidosLlave) && x.partidosLlave.length === 12);
    esc.exigir(t.partidosLlave.length === 12, '13 jugadores = 12 cruces');
    const porNombre = new Map(t.parejas.map((p) => [p.nombre, p.id]));
    const porId = new Map(t.parejas.map((p) => [p.id, p.nombre]));
    idDe = (n) => porNombre.get(n);
    nombreDe = (i) => porId.get(i) || '?';
    const c = await cruceEnPantalla(page);
    esc.exigir(c.nombres.join() === [ANA, BRUNO].join(), 'el primer cruce es Ana vs Bruno', c);
  });

  await esc.paso('Ana no se presentó (ronda 1): Bruno pasa solo, por W.O., y la pantalla sigue al próximo', async () => {
    await marcarAusente(esc, page, ANA, { captura: 'control-confirmar-ausente' });
    t = await esperarEstado(page, id, (x) => resueltos(x) === 1, 5000);
    const r1c1 = t.partidosLlave.find((p) => p.ronda === 1 && p.posicion === 0);
    esc.exigir(JSON.stringify(t.ausentes) === JSON.stringify([idDe(ANA)]), 'Ana queda en la lista de ausentes', t.ausentes);
    esc.verificar(r1c1.wo === true && r1c1.puntosA === 0 && r1c1.puntosB === 1, 'el cruce 1 quedó 0-1 por W.O. (pasa Bruno)', r1c1);
    esc.verificar(!('cargadoEl' in r1c1), 'el W.O. no tiene hora de carga (no es un resultado jugado)', r1c1);
    const aviso = await page.locator('[data-opc-aviso]').innerText().catch(() => '');
    esc.verificar(/Bruno Benítez pasa por W\.O\./.test(aviso) && /Ana Acosta no se presentó/.test(aviso), 'el aviso de abajo dice quién pasa y quién no vino', aviso);
    await esc.captura(page, 'control-ana-wo-aviso', { fullPage: false });
    await esperar(1200);
    const c = await cruceEnPantalla(page);
    esc.verificar(c.nombres.join() === [JC, DIEGO].join(), 'pasó solo al cruce 2 (el del W.O. no frena el avance)', c);
    const barra = await page.locator('.opc-barra').innerText();
    esc.verificar(/faltan 11 cruces/.test(barra), 'la barra cuenta el W.O. como resuelto: faltan 11', barra);
    // volver a mirar el cruce del W.O.
    await page.locator('section[aria-label="Cruce"]').getByRole('button', { name: /Anterior/ }).click();
    const wo = await page.locator('[data-opc-wo]').innerText();
    esc.verificar(/Bruno Benítez pasa por W\.O\.: Ana Acosta no se presentó/.test(wo), 'el cruce dice "Bruno pasa por W.O.: Ana no se presentó"', wo);
    const ana = page.locator('section[aria-label="Cruce"] [data-ausente]');
    esc.verificar((await ana.count()) === 1 && /No se presentó/i.test(await ana.innerText()), 'Ana se ve tachada con "No se presentó"');
    const sigue = await page.locator('section[aria-label="Cruce"]').getByRole('button', { name: /^Para jugar|^Sigue/ }).innerText().catch(() => '');
    esc.verificar(!sigue.includes(ANA), 'el atajo al próximo no propone a Ana', sigue);
    await esc.revisarPantalla(page, 'control-cruce-wo');
  });

  await esc.paso('los dos del cruce 2: Diego no vino (pasa JuanCarlos) y JuanCarlos tampoco (pierde su cruce de la ronda 2)', async () => {
    await page.locator('section[aria-label="Cruce"]').getByRole('button', { name: /Siguiente/ }).click();
    await marcarAusente(esc, page, DIEGO);
    t = await esperarEstado(page, id, (x) => resueltos(x) === 2, 5000);
    await esperar(1000);
    // JuanCarlos está en el cruce 2 de la ronda 2, esperando al ganador del cruce 3
    await abrirCruceDesdeRonda(page, 'Ronda 2', 2);
    const c = await cruceEnPantalla(page);
    esc.verificar(c.nombres.includes(JC), 'el cruce 2 de la ronda 2 tiene a JuanCarlos (y espera al otro)', c);
    await marcarAusente(esc, page, JC);
    t = await esperarEstado(page, id, (x) => (x.ausentes || []).length === 3, 5000);
    esc.verificar((t.ausentes || []).length === 3, 'quedan 3 ausentes', t.ausentes);
    const r2c2 = t.partidosLlave.find((p) => p.ronda === 2 && p.posicion === 1);
    esc.verificar(r2c2.puntosA === null, 'el cruce de JuanCarlos todavía no se resuelve (falta saber el rival)', r2c2);
    const txt = await page.locator('section[aria-label="Cruce"]').innerText();
    esc.verificar(/no se presentó: pierde este cruce por W\.O\. apenas se sepa el rival/.test(txt), 'el cruce en espera avisa que JuanCarlos lo pierde por W.O.', txt.slice(0, 400));
    await esc.revisarPantalla(page, 'control-ausente-esperando');
    // vista Ronda 1: los W.O. abajo con los jugados, marcados
    await page.getByRole('radio', { name: 'Ronda', exact: true }).click();
    await page.locator('section[aria-label="Ronda"]').getByRole('radio', { name: /^Ronda 1/ }).click();
    const wos = await page.locator('section[aria-label="Ronda"] li[data-wo]').count();
    esc.verificar(wos === 2, 'en la vista Ronda los dos W.O. se distinguen', wos);
    const sep = await page.locator('section[aria-label="Ronda"]').getByRole('separator').innerText();
    esc.verificar(/2 por W\.O\./i.test(sep), 'el separador dice cuántos fueron por W.O.', sep);
    const panel = await page.locator('section[aria-label="No se presentaron"]').innerText();
    esc.verificar([ANA, DIEGO, JC].every((n) => panel.includes(n)), 'el panel "No se presentaron" lista a los tres con "Llegó"', panel);
    await esc.revisarPantalla(page, 'control-ronda-con-wo');
    await page.getByRole('radio', { name: 'Cuadro', exact: true }).click();
    await esc.revisarPantalla(page, 'control-cuadro-con-wo');
    await page.getByRole('radio', { name: 'Cruce', exact: true }).click();
  });

  await esc.paso('público a mitad: "X pasa — Y no se presentó" y el próximo nunca es un ausente', async () => {
    await g.esperarSincronizado(page).catch(() => {});
    const pub = await abrirPublico(esc, 'publico-ausentes-vivo', CELULAR, id);
    const resumen = await pub.locator('.opc-pub-resumen').innerText();
    esc.verificar(![ANA, DIEGO, JC].some((n) => resumen.includes(n)), 'el "Próximo" del público no es un ausente', resumen);
    await pub.getByRole('tab', { name: /^Ronda 1/ }).click();
    const c1 = await pub.locator('.opc-pub-cruce[data-cruce="1"]').innerText();
    esc.verificar(c1.includes(`${BRUNO} pasa — ${ANA} no se presentó`), 'cruce 1: "Bruno pasa — Ana no se presentó"', c1);
    esc.verificar(!/GANÓ/i.test(c1), 'sin "Ganó" en un cruce que no se jugó', c1);
    await esc.revisarPantalla(pub, 'publico-ausentes-vivo');
  });

  let campeonWo;
  await esc.paso('jugar hasta la final; un finalista no se presenta: campeón por W.O.', async () => {
    const sim = simularConAusentes(13, new Set([ANA, DIEGO, JC].map(idx)));
    const esFinal = (p, x) => p.ronda === Math.max(...x.partidosLlave.map((q) => q.ronda));
    for (let vuelta = 0; vuelta < 20; vuelta++) {
      t = await g.torneoLocal(page, id);
      if (t.partidosLlave.filter((p) => !esFinal(p, t)).every((p) => p.puntosA !== null)) break;
      await tocarGanadorAus(esc, page, id, idx);
    }
    t = await g.torneoLocal(page, id);
    const { slot } = revisarLlave(esc, t, idDe, nombreDe, 'antes de la final');
    const final = t.partidosLlave.find((p) => esFinal(p, t));
    const finalistas = [slot(final.a), slot(final.b)].map(nombreDe);
    const esperados = [JUGADORES[sim.final.a], JUGADORES[sim.final.b]];
    esc.exigir(finalistas.join() === esperados.join(), 'los finalistas son los del cálculo independiente (con los ausentes)', { app: finalistas, oraculo: esperados });
    const wosApp = t.partidosLlave.filter((p) => p.wo).length;
    const wosSim = sim.rondas.flatMap((r) => r.cruces).filter((c) => c.wo && c !== sim.final).length;
    esc.verificar(wosApp === wosSim, 'los W.O. son los del cálculo', { app: wosApp, oraculo: wosSim });
    // el que ganaría la final no se presenta
    const noVino = JUGADORES[ganaRegla(sim.final.a, sim.final.b)];
    campeonWo = finalistas.find((n) => n !== noVino);
    await irAlProximo(page);
    const c = await cruceEnPantalla(page);
    esc.exigir(c.ronda.toUpperCase() === 'FINAL', 'la pantalla está en la final', c);
    await marcarAusente(esc, page, noVino);
    await page.locator('section[aria-label="Podio"]').first().waitFor();
    const podio = await page.locator('section[aria-label="Podio"]').first().innerText();
    esc.verificar(podio.toUpperCase().includes(campeonWo.toUpperCase()), 'campeón: el otro finalista', { podio, campeonWo });
    esc.verificar(/Campeón por W\.O\./.test(podio) && podio.includes(`${noVino} no se presentó a la final`), 'el podio dice que la final fue por W.O.', podio);
    await esc.revisarPantalla(page, 'control-campeon-por-wo');
  });

  await esc.paso('Llegó Diego (tarde): avisa qué cruces jugados se borran; cancelar no cambia nada; confirmar deshace', async () => {
    const antes = await g.torneoLocal(page, id);
    const panel = page.locator('section[aria-label="No se presentaron"]');
    await panel.getByRole('button', { name: new RegExp(`^Llegó ${DIEGO}`) }).click();
    let d = page.getByRole('dialog');
    await d.waitFor();
    const msg = await d.innerText();
    esc.verificar(/BORRA \d+ resultados? jugados?/.test(msg), 'avisa cuántos resultados jugados de verdad se borran', msg.slice(0, 400));
    await esc.captura(page, 'control-desmarcar-cascada', { fullPage: false });
    await d.getByRole('button', { name: 'Cancelar' }).click();
    await d.waitFor({ state: 'detached' });
    await esperar(400);
    const igual = await g.torneoLocal(page, id);
    esc.verificar(JSON.stringify(igual.partidosLlave) === JSON.stringify(antes.partidosLlave) && (igual.ausentes || []).includes(idDe(DIEGO)), 'Cancelar no toca nada (Diego sigue ausente)');
    await panel.getByRole('button', { name: new RegExp(`^Llegó ${DIEGO}`) }).click();
    d = page.getByRole('dialog');
    await d.waitFor();
    await d.getByRole('button', { name: 'Desmarcar y borrar' }).click();
    t = await esperarEstado(page, id, (x) => !(x.ausentes || []).includes(idDe(DIEGO)), 5000);
    esc.exigir(!(t.ausentes || []).includes(idDe(DIEGO)), 'Diego ya no está ausente', t.ausentes);
    const { ganador } = revisarLlave(esc, t, idDe, nombreDe, 'después de desmarcar');
    const r1c2 = t.partidosLlave.find((p) => p.ronda === 1 && p.posicion === 1);
    esc.verificar(r1c2.wo === true && nombreDe(ganador(r1c2)) === DIEGO, 'el cruce 2 ahora lo pasa Diego por W.O. (JuanCarlos sigue ausente)', r1c2);
    esc.verificar(resueltos(t) < 12, 'se borraron los cruces que dependían del W.O. de Diego', resueltos(t));
    await esc.revisarPantalla(page, 'control-despues-de-desmarcar');
  });

  await esc.paso('volver a jugar lo borrado hasta el campeón y dar por terminado', async () => {
    await page.getByRole('radio', { name: 'Cruce', exact: true }).click();
    for (let vuelta = 0; vuelta < 20; vuelta++) {
      t = await g.torneoLocal(page, id);
      if (t.partidosLlave.every((p) => p.puntosA !== null)) break;
      await tocarGanadorAus(esc, page, id, idx);
    }
    t = await g.torneoLocal(page, id);
    esc.verificar(t.partidosLlave.every((p) => p.puntosA !== null), 'los 12 cruces quedaron resueltos (jugados o por W.O.)');
    revisarLlave(esc, t, idDe, nombreDe, 'al final');
    await page.locator('section[aria-label="Podio"]').first().waitFor();
    campeonWo = (await page.locator('section[aria-label="Podio"] h2').innerText()).trim();
    esc.verificar(![ANA, JC].some((n) => n.toUpperCase() === campeonWo.toUpperCase()), 'el campeón no es un ausente', campeonWo);
    await page.getByRole('button', { name: 'Dar por terminado el torneo' }).click();
    await esperarEstado(page, id, (x) => x.fase === 'terminado', 5000);
    await g.esperarSincronizado(page).catch(() => {});
    await esc.revisarPantalla(page, 'control-ausentes-terminado');
  });

  await esc.paso('vista pública al final: W.O. sin "Ganó", ausentes marcados y campeón', async () => {
    const pub = await abrirPublico(esc, 'publico-ausentes-final', CELULAR, id);
    const campeon = (await pub.locator('[data-campeon]').innerText()).trim();
    esc.verificar(campeon.toUpperCase() === campeonWo.toUpperCase(), 'la web muestra el mismo campeón', { web: campeon, control: campeonWo });
    const finalWo = await pub.locator('[data-final-wo]').count();
    const tt = await g.torneoLocal(page, id);
    const fin = tt.partidosLlave.reduce((m, p) => (p.ronda > m.ronda ? p : m));
    esc.verificar(finalWo === (fin.wo ? 1 : 0), 'si la final fue por W.O., el podio lo dice', { finalWo, wo: !!fin.wo });
    await esc.revisarPantalla(pub, 'publico-ausentes-final');
    await pub.getByRole('tab', { name: /^Ronda 1/ }).click();
    const panel = pub.getByRole('tabpanel');
    const c1 = await panel.locator('.opc-pub-cruce[data-cruce="1"]').innerText();
    esc.verificar(c1.includes(`${BRUNO} pasa — ${ANA} no se presentó`), 'cruce 1: "Bruno pasa — Ana no se presentó"', c1);
    const c2 = await panel.locator('.opc-pub-cruce[data-cruce="2"]').innerText();
    esc.verificar(c2.includes(`${DIEGO} pasa — ${JC} no se presentó`), 'cruce 2 (después de desmarcar): "Diego pasa — JuanCarlos no se presentó"', c2);
    const ganoEnWo = await panel.locator('[data-wo] [data-gano]').count();
    esc.verificar(ganoEnWo === 0, 'ningún "Ganó" en cruces por W.O.', ganoEnWo);
    const jugados = await panel.locator('.opc-pub-cruce:not([data-wo]) [data-gano]').count();
    esc.verificar(jugados === 4, 'los 4 cruces jugados de la ronda 1 sí dicen "Ganó"', jugados);
    await esc.revisarPantalla(pub, 'publico-ausentes-ronda1');
    await pub.getByRole('tab', { name: 'Cuadro completo' }).click();
    await esc.revisarPantalla(pub, 'publico-ausentes-cuadro');
  });
}

const ESCENARIOS = { 'opc-13-jugadores': opc13, 'opc-ausentes': opcAusentes };

module.exports = { ESCENARIOS, simular, simularConAusentes };
