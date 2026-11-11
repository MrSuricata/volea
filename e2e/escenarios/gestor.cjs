// Recorrido 1: el gestor de punta a punta para cada formato de llave, a una rueda y a ida y vuelta.
const { ESCRITORIO, BASE } = require('../lib/harness.cjs');
const g = require('../lib/gestor.cjs');
const o = require('../lib/oraculo.cjs');

// Formatos: id → configuración del cuadro.
const FORMATOS = {
  final: { titulo: 'Final directa', parejas: 4, grupos: 1, etiqueta: 'Final 1° vs 2°', tipo: 'fijo', formato: 'final' },
  semis: { titulo: 'Semis y final', parejas: 5, grupos: 1, etiqueta: 'Semis y final', tipo: 'fijo', formato: 'semis' },
  cruces2: { titulo: 'Semis cruzadas 2 grupos', parejas: 8, grupos: 2, etiqueta: 'Semis cruzadas', tipo: 'fijo', formato: 'cruces' },
  cruces4: { titulo: 'Cuartos cruzados 4 grupos', parejas: 12, grupos: 4, etiqueta: 'Cuartos cruzados', tipo: 'fijo', formato: 'cruces' },
  seis: { titulo: 'Llave de 6', parejas: 11, grupos: 3, etiqueta: 'Llave de 6', tipo: 'fijo', formato: 'seis' },
  copas: { titulo: 'Copas Oro y Plata', parejas: 8, grupos: 2, etiqueta: 'Copa de Oro y Copa de Plata', tipo: 'copas' },
  tabla: { titulo: 'Americano', parejas: 5, grupos: 1, etiqueta: 'Sin llave: gana la tabla', tipo: 'tabla' },
  auto: { titulo: 'Mejores terceros', parejas: 12, grupos: 3, etiqueta: 'Elegir al armar', tipo: 'auto', opcion: /2 mejores terceros/, tercerPuesto: true },
};

function idsDeEscenarios() {
  const ids = [];
  for (const f of Object.keys(FORMATOS)) for (const r of ['1r', 'iv']) ids.push(`gestor-${f}-${r}`);
  return ids;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarEstado(page, id, cond, timeout = 8000) {
  const t0 = Date.now();
  for (;;) {
    const t = await g.torneoLocal(page, id);
    if (t && cond(t)) return t;
    if (Date.now() - t0 > timeout) return t;
    await esperar(150);
  }
}

// Carga todos los resultados de grupo desde la pantalla, en el orden del fixture.
async function cargarGrupos(esc, page, id, fuerza) {
  let t = await g.torneoLocal(page, id);
  const veces = new Map();
  const nombre = (pid) => t.parejas.find((p) => p.id === pid).nombre;
  const orden = [...t.partidosGrupo].sort((a, b) => a.ronda - b.ronda);
  for (const p of orden) {
    const clave = [p.aId, p.bId].sort().join('|');
    const vuelta = veces.get(clave) ?? 0;
    veces.set(clave, vuelta + 1);
    const r = o.resultado(fuerza(p.aId), fuerza(p.bId), vuelta);
    await g.cargarResultadoGrupo(page, p.ronda, nombre(p.aId), nombre(p.bId), r.a, r.b);
  }
  t = await esperarEstado(page, id, (x) => x.partidosGrupo.every((p) => p.puntosA !== null && p.puntosB !== null));
  const faltan = t.partidosGrupo.filter((p) => p.puntosA === null || p.puntosB === null).length;
  esc.exigir(faltan === 0, 'todos los resultados de grupo quedaron cargados', { faltan });
  // y que coincidan con lo tipeado
  const mal = [];
  const veces2 = new Map();
  for (const p of [...t.partidosGrupo].sort((a, b) => a.ronda - b.ronda)) {
    const clave = [p.aId, p.bId].sort().join('|');
    const vuelta = veces2.get(clave) ?? 0; veces2.set(clave, vuelta + 1);
    const r = o.resultado(fuerza(p.aId), fuerza(p.bId), vuelta);
    if (p.puntosA !== r.a || p.puntosB !== r.b) mal.push({ ronda: p.ronda, esperado: r, guardado: [p.puntosA, p.puntosB] });
  }
  esc.verificar(mal.length === 0, 'cada resultado guardado es el que se tipeó', mal.slice(0, 5));
  return t;
}

// Lee la tabla de cada grupo de la vista "Por grupo" y la compara con el oráculo.
async function verificarTablas(esc, page, t) {
  await page.getByRole('radio', { name: 'Por grupo' }).click();
  const esperadas = o.tablasDe(t);
  for (const { grupo, filas } of esperadas) {
    const bloque = page.locator('div.rounded-xl', { has: page.getByRole('heading', { name: `Grupo ${grupo.nombre}`, exact: true }) }).last();
    const rows = await bloque.locator('table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())));
    const nombre = (pid) => t.parejas.find((p) => p.id === pid).nombre;
    const esperado = filas.map((f) => [String(f.posicion), nombre(f.parejaId), String(f.pj), String(f.pg), String(f.pp), String(f.pf), String(f.pc), f.dif > 0 ? `+${f.dif}` : String(f.dif)]);
    esc.verificar(JSON.stringify(rows) === JSON.stringify(esperado), `tabla del grupo ${grupo.nombre} = oráculo (orden, PJ/PG/PP/PF/PC/Dif)`, { pantalla: rows, esperado });
  }
  await esc.revisarPantalla(page, 'tablas-de-grupo');
  await page.getByRole('radio', { name: 'Por rondas' }).click();
}

// Carga la llave entera desde la pantalla: mientras haya un cruce definido sin resultado, lo juega.
async function cargarLlave(esc, page, id, fuerza) {
  for (let vuelta = 0; vuelta < 40; vuelta++) {
    const t = await g.torneoLocal(page, id);
    const llave = t.partidosLlave;
    const sim = new Map();
    const quien = (slot) => resolver(slot, llave);
    const pendiente = llave.find((p) => p.a !== null && p.b !== null && p.puntosA === null && quien(p.a) && quien(p.b));
    if (!pendiente) return t;
    const a = quien(pendiente.a); const b = quien(pendiente.b);
    const r = o.resultado(fuerza(a), fuerza(b));
    const nombre = (pid) => t.parejas.find((p) => p.id === pid).nombre;
    const caja = page.locator('.partido-llave').filter({ has: page.getByLabel(`Puntos de ${nombre(a)}`, { exact: true }) }).filter({ has: page.getByLabel(`Puntos de ${nombre(b)}`, { exact: true }) });
    if (!(await caja.count())) {
      // en el celular la llave se ve de a una ronda: no debería pasar en escritorio
      esc.exigir(false, 'el cruce de la llave está en pantalla para cargarlo', { a: nombre(a), b: nombre(b) });
    }
    await caja.first().getByLabel(`Puntos de ${nombre(a)}`, { exact: true }).fill(String(r.a));
    const cb = caja.first().getByLabel(`Puntos de ${nombre(b)}`, { exact: true });
    await cb.fill(String(r.b));
    await cb.press('Enter');
    await esperarEstado(page, id, (x) => (x.partidosLlave.find((p) => p.id === pendiente.id) || {}).puntosA !== null, 5000);
    void sim;
  }
  esc.exigir(false, 'la llave se terminó de cargar en menos de 40 partidos');
  return null;
}

function resolver(slot, llave) {
  if (!slot) return null;
  if (slot.tipo === 'seed') return slot.parejaId;
  const p = llave.find((x) => x.id === slot.partidoId);
  if (!p) return null;
  const a = resolver(p.a, llave); const b = resolver(p.b, llave);
  let gan = null;
  if (p.a === null) gan = b; else if (p.b === null) gan = a;
  else if (a && b && p.puntosA !== null && p.puntosB !== null && p.puntosA !== p.puntosB) gan = p.puntosA > p.puntosB ? a : b;
  if (!gan) return null;
  if (slot.tipo === 'ganadorDe') return gan;
  return gan === a ? b : a;
}

// Lee la tarjeta "Campeón" del gestor.
async function leerPodio(page) {
  const card = page.locator('div.rounded-2xl.bg-navy-700').filter({ hasText: 'Campeón' }).first();
  await card.waitFor({ timeout: 8000 });
  const campeon = (await card.locator('h2').innerText()).trim();
  const medallas = await card.locator('span.inline-flex').allInnerTexts();
  return { campeon, medallas: medallas.map((s) => s.trim()) };
}

function mayus(s) { return s.toLocaleUpperCase('es'); }

async function verificarPodio(esc, page, t, esperado, cuando) {
  const nombre = (pid) => (pid ? t.parejas.find((p) => p.id === pid).nombre : null);
  const pod = await leerPodio(page);
  // el h2 va en mayúsculas por CSS (uppercase): innerText devuelve el texto transformado
  esc.verificar(mayus(pod.campeon) === mayus(nombre(esperado.campeon)), `${cuando}: el campeón en pantalla es el que corresponde`, { pantalla: pod.campeon, esperado: nombre(esperado.campeon) });
  if (esperado.subcampeon) esc.verificar(pod.medallas[0] === nombre(esperado.subcampeon), `${cuando}: el subcampeón en pantalla es el que corresponde`, { pantalla: pod.medallas, esperado: nombre(esperado.subcampeon) });
  if (esperado.tercero) esc.verificar(pod.medallas.includes(nombre(esperado.tercero)), `${cuando}: el 3er puesto en pantalla es el que corresponde`, { pantalla: pod.medallas, esperado: nombre(esperado.tercero) });
  return pod;
}

async function verificarNube(esc, t, cuando) {
  const nube = esc.fake.torneo(t.id);
  esc.verificar(!!nube, `${cuando}: el torneo llegó a la base (rk_torneos)`);
  if (!nube) return;
  const resumen = (x) => JSON.stringify({ fase: x.fase, g: x.partidosGrupo.map((p) => [p.id, p.puntosA, p.puntosB]), l: (x.partidosLlave || []).map((p) => [p.id, p.puntosA, p.puntosB]) });
  esc.verificar(resumen(nube) === resumen(t), `${cuando}: la base tiene exactamente lo mismo que el gestor`, { nube: resumen(nube).slice(0, 300), local: resumen(t).slice(0, 300) });
}

async function terminarYVerificar(esc, page, t, fuerza, cuando) {
  const esperado = o.simularLlave(t.partidosLlave, fuerza);
  await verificarPodio(esc, page, t, esperado, cuando);
  await esc.revisarPantalla(page, `campeon-${cuando.replace(/\W+/g, '-')}`);
  const boton = page.getByRole('button', { name: 'Dar por terminado el torneo' });
  if (await boton.count()) await boton.click();
  const fin = await esperarEstado(page, t.id, (x) => x.fase === 'terminado');
  esc.verificar(fin.fase === 'terminado', `${cuando}: el torneo queda terminado`);
  await g.esperarSincronizado(page).catch(() => esc.verificar(false, `${cuando}: la píldora llega a "Sincronizado"`));
  await verificarNube(esc, fin, cuando);
  return { esperado, fin };
}

async function verificarPublico(esc, browserPage, t, esperadoCampeon, cuando) {
  const page = browserPage;
  await page.goto(`${BASE}/torneos/${t.id}`);
  const nombre = t.parejas.find((p) => p.id === esperadoCampeon).nombre;
  const ok = await page.getByText(nombre).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  esc.verificar(ok, `${cuando}: la página pública del torneo muestra al campeón`, { esperado: nombre });
  await esc.revisarPantalla(page, `publico-${cuando.replace(/\W+/g, '-')}`);
}

async function flujoGestor(esc, formatoId, idaYVuelta) {
  const cfg = FORMATOS[formatoId];
  const page = await esc.contexto('admin', ESCRITORIO);
  const nombres = o.parejasDePrueba(cfg.parejas, formatoId.length);
  const nombreTorneo = `Sudamericano 2026 · ${cfg.titulo}${idaYVuelta ? ' (ida y vuelta)' : ''}`;
  let id;
  let fuerza;

  await esc.paso('login del admin', () => g.login(page));
  await esc.paso('crear torneo', async () => {
    id = await g.crearTorneo(page, { nombre: nombreTorneo, categoria: 'A' });
  });
  await esc.paso(`cargar ${cfg.parejas} parejas`, async () => {
    await g.cargarParejas(page, nombres);
    const t = await esperarEstado(page, id, (x) => x.parejas.length === cfg.parejas);
    esc.exigir(t.parejas.length === cfg.parejas, 'quedaron cargadas todas las parejas', { hay: t.parejas.length });
    esc.verificar(JSON.stringify(t.parejas.map((p) => p.nombre)) === JSON.stringify(nombres), 'las parejas quedan con el nombre y el orden de la lista', t.parejas.map((p) => p.nombre));
    const porId = new Map(t.parejas.map((p) => [p.id, nombres.indexOf(p.nombre)]));
    fuerza = (pid) => porId.get(pid);
    await esc.revisarPantalla(page, 'parejas');
  });
  await esc.paso(`armar ${cfg.grupos} grupo(s)${idaYVuelta ? ' a ida y vuelta' : ''}`, async () => {
    await g.irAGrupos(page);
    await g.elegirCantidadGrupos(page, cfg.grupos);
    if (idaYVuelta) await g.idaYVuelta(page, true);
    await g.sortear(page);
    const t = await esperarEstado(page, id, (x) => x.grupos.length === cfg.grupos && x.grupos.every((gr) => gr.parejaIds.length > 0) && x.grupos.reduce((s, gr) => s + gr.parejaIds.length, 0) === cfg.parejas);
    esc.exigir(t.grupos.length === cfg.grupos, `quedan ${cfg.grupos} grupos`, t.grupos.map((gr) => gr.parejaIds.length));
    if (cfg.etiqueta !== 'Elegir al armar') {
      await g.elegirFormatoEnAjustes(page, cfg.etiqueta);
      await esperarEstado(page, id, (x) => !!(x.formatoLlave || x.copas || x.llave6 || x.sinLlave));
    }
    await esc.revisarPantalla(page, 'grupos-sorteados');
    await g.cerrarAjustes(page);
    await g.confirmarGrupos(page);
    const t2 = await g.torneoLocal(page, id);
    const esperados = t2.grupos.reduce((s, gr) => s + (gr.parejaIds.length * (gr.parejaIds.length - 1)) / 2, 0) * (idaYVuelta ? 2 : 1);
    esc.verificar(t2.partidosGrupo.length === esperados, 'el fixture tiene la cantidad de partidos correcta', { hay: t2.partidosGrupo.length, esperados });
    esc.verificar(!!t2.idaYVuelta === idaYVuelta, 'el torneo guarda si es a ida y vuelta');
    await esc.revisarPantalla(page, 'fixture');
  });
  let t;
  await esc.paso('cargar todos los resultados de grupo', async () => {
    t = await cargarGrupos(esc, page, id, fuerza);
    await page.getByText(/todos cargados/).waitFor({ timeout: 5000 }).catch(() => esc.verificar(false, 'la barra dice "todos cargados"'));
    await esc.revisarPantalla(page, 'grupos-cargados');
  });
  await esc.paso('verificar tablas de grupo contra el oráculo', () => verificarTablas(esc, page, t));

  if (cfg.tipo === 'fijo') {
    await esc.paso('armar la llave con el formato fijo', async () => {
      await page.getByRole('button', { name: 'Armar llave' }).last().click();
      await page.getByText('Así sale la llave').waitFor();
      const items = await page.locator('section ol li').filter({ hasText: 'vs' }).allInnerTexts();
      const nombre = (pid) => t.parejas.find((p) => p.id === pid).nombre;
      const esp = o.crucesFijos(t, cfg.formato);
      const pares = Array.isArray(esp) ? esp : esp.cuartos;
      for (const [a, b] of pares) {
        const hay = items.some((txt) => txt.includes(`${nombre(a)}\nvs\n${nombre(b)}`) || txt.includes(`${nombre(a)} vs ${nombre(b)}`));
        esc.verificar(hay, `cruce esperado en "Así sale la llave": ${nombre(a)} vs ${nombre(b)}`, items);
      }
      if (!Array.isArray(esp)) {
        for (const pid of esp.esperanEnSemis) esc.verificar(items.some((txt) => txt.includes(nombre(pid))), `en semis espera ${nombre(pid)}`, items);
      }
      await esc.revisarPantalla(page, 'asi-sale-la-llave');
      await page.getByRole('button', { name: 'Armar llave' }).last().click();
      await page.getByRole('heading', { name: 'Llave', exact: true }).waitFor();
    });
    await esc.paso('cargar la llave hasta el campeón', async () => {
      t = await cargarLlave(esc, page, id, fuerza);
      await esc.revisarPantalla(page, 'llave-completa');
    });
    let esperado;
    await esc.paso('verificar campeón, terminar y sincronizar', async () => {
      ({ esperado } = await terminarYVerificar(esc, page, t, fuerza, 'llave'));
      esc.verificar(esperado.campeon === t.parejas[nombres.indexOf(nombres[0])]?.id || fuerza(esperado.campeon) === 0, 'el campeón es la pareja más fuerte (sanity del oráculo)');
    });
    const pub = await esc.contexto('publico-escritorio', ESCRITORIO);
    await esc.paso('la web pública muestra el campeón', () => verificarPublico(esc, pub, t, esperado.campeon, 'publico'));
  } else if (cfg.tipo === 'auto') {
    await esc.paso('elegir "2 primeros + 2 mejores terceros" y 3er puesto', async () => {
      await page.getByRole('button', { name: 'Armar llave' }).last().click();
      await page.getByText('¿Cómo se arma la llave?').waitFor();
      await page.locator('label', { hasText: cfg.opcion }).first().click();
      const sw = page.getByRole('switch', { name: /3er puesto/ });
      if (cfg.tercerPuesto && (await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
      const esp = o.clasificados(t, 2, 2);
      esc.verificar(!esp.empateEnCorte, 'el oráculo no tiene empate en el corte de mejores terceros (si lo tuviera la prueba no sería concluyente)');
      const lista = await page.locator('section', { has: page.getByText('Así entran (orden de seed)') }).locator('ol li').allInnerTexts();
      const nombre = (pid) => t.parejas.find((p) => p.id === pid).nombre;
      const esperadoTxt = esp.lista.map((c, i) => `${i + 1} ${nombre(c.parejaId)} ${c.puesto}º del grupo ${c.grupo}`);
      const pantallaTxt = lista.map((s) => s.replace(/\s+/g, ' ').replace(/(\S)(\d)º del grupo/, '$1 $2º del grupo').trim());
      esc.verificar(JSON.stringify(pantallaTxt) === JSON.stringify(esperadoTxt), 'clasificados y orden de seed = oráculo (incluye los 2 mejores terceros)', { pantalla: pantallaTxt, esperado: esperadoTxt });
      await esc.revisarPantalla(page, 'configurar-llave-terceros');
      await page.getByRole('button', { name: 'Armar llave', exact: true }).last().click();
      await page.getByRole('heading', { name: 'Llave', exact: true }).waitFor();
      const t2 = await g.torneoLocal(page, id);
      esc.verificar(t2.partidosLlave.some((p) => p.esTercerPuesto), 'la llave tiene partido por el 3er puesto');
      const seeds = new Set(t2.partidosLlave.filter((p) => p.ronda === 1).flatMap((p) => [p.a, p.b]).filter((s) => s && s.tipo === 'seed').map((s) => s.parejaId));
      esc.verificar(seeds.size === esp.lista.length && esp.lista.every((c) => seeds.has(c.parejaId)), 'la ronda 1 de la llave tiene exactamente a los clasificados');
    });
    await esc.paso('cargar la llave (con 3er puesto) hasta el campeón', async () => {
      t = await cargarLlave(esc, page, id, fuerza);
      await esc.revisarPantalla(page, 'llave-completa');
    });
    let esperado;
    await esc.paso('verificar podio (campeón, subcampeón y 3º), terminar y sincronizar', async () => {
      ({ esperado } = await terminarYVerificar(esc, page, t, fuerza, 'llave'));
    });
    const pub = await esc.contexto('publico-escritorio', ESCRITORIO);
    await esc.paso('la web pública muestra el campeón', () => verificarPublico(esc, pub, t, esperado.campeon, 'publico'));
  } else if (cfg.tipo === 'tabla') {
    await esc.paso('terminar sin llave: campeón el 1º de la tabla', async () => {
      await page.getByRole('button', { name: 'Terminar', exact: true }).last().click();
      await page.getByRole('button', { name: 'Terminar: campeón el 1º' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Terminar' }).click();
      const fin = await esperarEstado(page, id, (x) => x.fase === 'terminado');
      esc.verificar(fin.fase === 'terminado', 'el torneo queda terminado');
      const tabla = o.tablasDe(fin)[0].filas;
      const esperado = { campeon: tabla[0].parejaId, subcampeon: tabla[1].parejaId, tercero: tabla[2].parejaId };
      await verificarPodio(esc, page, fin, esperado, 'americano');
      await esc.revisarPantalla(page, 'campeon-americano');
      await g.esperarSincronizado(page).catch(() => esc.verificar(false, 'la píldora llega a "Sincronizado"'));
      await verificarNube(esc, fin, 'americano');
      t = fin;
    });
    const pub = await esc.contexto('publico-escritorio', ESCRITORIO);
    await esc.paso('la web pública muestra el campeón', () => verificarPublico(esc, pub, t, o.tablasDe(t)[0].filas[0].parejaId, 'publico'));
  } else if (cfg.tipo === 'copas') {
    let oroId; let plataId;
    await esc.paso('armar Copa de Oro y Copa de Plata', async () => {
      await page.getByRole('button', { name: 'Armar copas' }).last().click();
      await page.getByText('Copas de Oro y Plata').first().waitFor();
      const gen = o.tablaGeneral(t);
      const oro = t.copas ? t.copas.oro : Math.ceil(t.parejas.length / 2);
      const nombre = (pid) => t.parejas.find((p) => p.id === pid).nombre;
      const filas = await page.locator('section', { has: page.getByText('Copas de Oro y Plata') }).locator('ol li').allInnerTexts();
      const pantalla = filas.map((s) => s.split('\n').map((x) => x.trim()).filter(Boolean)[1]);
      esc.verificar(JSON.stringify(pantalla) === JSON.stringify(gen.map((f) => nombre(f.parejaId))), 'la tabla general mostrada = oráculo', { pantalla, esperado: gen.map((f) => nombre(f.parejaId)) });
      await esc.revisarPantalla(page, 'tabla-general-copas');
      await page.getByRole('button', { name: 'Armar COPA DE ORO + PLATA' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Armar copas' }).click();
      const fin = await esperarEstado(page, id, (x) => x.fase === 'terminado');
      esc.verificar(fin.fase === 'terminado', 'el cuadro de grupos queda terminado');
      const c = await g.estado(page);
      const oroT = c.estado.torneos.find((x) => x.copaDe === id && /ORO/.test(x.nombre));
      const plataT = c.estado.torneos.find((x) => x.copaDe === id && /PLATA/.test(x.nombre));
      esc.exigir(oroT && plataT, 'se crearon los cuadros de Copa de Oro y Copa de Plata');
      oroId = oroT.id; plataId = plataT.id;
      const oroEsp = new Set(gen.slice(0, oro).map((f) => f.parejaId));
      esc.verificar(oroT.parejas.length === oro && oroT.parejas.every((p) => oroEsp.has(p.id)), `la Copa de Oro tiene a las ${oro} mejores de la tabla general`, oroT.parejas.map((p) => p.nombre));
      esc.verificar(plataT.parejas.length === t.parejas.length - oro && plataT.parejas.every((p) => !oroEsp.has(p.id)), 'la Copa de Plata tiene al resto', plataT.parejas.map((p) => p.nombre));
    });
    for (const [copaId, cual] of [[() => oroId, 'oro'], [() => plataId, 'plata']]) {
      await esc.paso(`jugar la Copa de ${cual} hasta el campeón`, async () => {
        await page.locator('main.contenedor').getByRole('button', { name: 'Torneos', exact: true }).first().click();
        await page.getByRole('heading', { name: 'Gestor de torneos' }).waitFor();
        const tc = await g.torneoLocal(page, copaId());
        await page.getByRole('button', { name: new RegExp(`^${g.escapar(tc.nombre)}`) }).first().click();
        await page.getByRole('heading', { name: 'Llave', exact: true }).waitFor();
        await esc.revisarPantalla(page, `copa-${cual}-armada`);
        const llena = await cargarLlave(esc, page, copaId(), fuerza);
        await terminarYVerificar(esc, page, llena, fuerza, `copa ${cual}`);
      });
    }
    const pub = await esc.contexto('publico-escritorio', ESCRITORIO);
    await esc.paso('la web pública muestra la campeona de la Copa de Oro', async () => {
      const oroT = esc.fake.torneo(oroId);
      const esperado = o.simularLlave(oroT.partidosLlave, fuerza);
      await verificarPublico(esc, pub, oroT, esperado.campeon, 'publico-oro');
    });
  }
}

module.exports = { FORMATOS, idsDeEscenarios, flujoGestor, esperarEstado, cargarGrupos, cargarLlave, resolver };
