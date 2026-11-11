// Recorrido 3: vistas públicas (/torneos, /torneos/:id, /programacion, TV) con el torneo en curso y un
// partido arbitrado en vivo, en celular (390x844) y escritorio (1440x900).
const { ESCRITORIO, CELULAR, BASE } = require('../lib/harness.cjs');
const g = require('../lib/gestor.cjs');
const ar = require('../lib/arbitro.cjs');
const o = require('../lib/oraculo.cjs');
const { esperarEstado } = require('./gestor.cjs');
const { hojaCodigos } = require('./arbitro.cjs');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Torneo en curso: 8 parejas, 2 grupos, semis cruzadas; la mitad de los partidos de grupo cargados
// y un partido con árbitro en juego.
async function torneoEnCurso(esc, admin, nombre, evento) {
  let id; let fuerza; let t;
  const nombres = o.parejasDePrueba(8, 1);
  await esc.paso('gestor: torneo en curso (8 parejas, 2 grupos, mitad de los partidos cargados)', async () => {
    await g.login(admin);
    id = await g.crearTorneo(admin, { nombre });
    if (evento) {
      await g.abrirAjustes(admin);
      await admin.getByLabel('Evento').fill(evento);
      await g.cerrarAjustes(admin);
    }
    await g.cargarParejas(admin, nombres);
    await esperarEstado(admin, id, (x) => x.parejas.length === 8);
    await g.irAGrupos(admin);
    await g.elegirCantidadGrupos(admin, 2);
    await g.sortear(admin);
    await esperarEstado(admin, id, (x) => x.grupos.length === 2 && x.grupos.every((gr) => gr.parejaIds.length === 4));
    await g.elegirFormatoEnAjustes(admin, 'Semis cruzadas');
    await g.cerrarAjustes(admin);
    await g.confirmarGrupos(admin);
    t = await g.torneoLocal(admin, id);
    const porId = new Map(t.parejas.map((p) => [p.id, nombres.indexOf(p.nombre)]));
    fuerza = (pid) => porId.get(pid);
    const nombre2 = (pid) => t.parejas.find((p) => p.id === pid).nombre;
    for (const p of t.partidosGrupo.filter((x) => x.ronda === 1)) {
      const r = o.resultado(fuerza(p.aId), fuerza(p.bId));
      await g.cargarResultadoGrupo(admin, p.ronda, nombre2(p.aId), nombre2(p.bId), r.a, r.b);
    }
    t = await esperarEstado(admin, id, (x) => x.partidosGrupo.filter((p) => p.ronda === 1).every((p) => p.puntosA !== null));
    await g.esperarSincronizado(admin);
  });
  return { id, fuerza, t };
}

async function revisarVistas(esc, page, etiqueta, id) {
  // /torneos
  await page.goto(`${BASE}/torneos`);
  const lista = await page.getByText(/Sudamericano|Aniversario/).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  esc.verificar(lista, `${etiqueta}: /torneos lista el torneo en curso`);
  const enVivo = await page.getByText(/en vivo/i).first().count();
  esc.verificar(enVivo > 0, `${etiqueta}: /torneos marca el torneo "en vivo"`);
  await esc.revisarPantalla(page, `${etiqueta}-torneos`);
  // /torneos/:id
  await page.goto(`${BASE}/torneos/${id}`);
  await page.getByText(/Grupo A/i).first().waitFor({ timeout: 15000 });
  const vivo = await page.getByText('EN VIVO').first().waitFor({ timeout: 25000 }).then(() => true, () => false);
  esc.verificar(vivo, `${etiqueta}: /torneos/:id muestra el marcador EN VIVO del partido con árbitro`);
  await esc.revisarPantalla(page, `${etiqueta}-torneo-detalle`);
}

async function enVivo(esc, { nombre, evento, programacionEsperada }) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id, t } = await torneoEnCurso(esc, admin, nombre, evento);
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const pendiente = hoja.filas.find((f) => t.partidosGrupo.find((p) => p.id === f.partidoId && p.puntosA === null));
  const cel = await esc.contexto('arbitro', CELULAR);
  await esc.paso('árbitro: arranca un partido y marca 5 rallies', async () => {
    await ar.entrar(cel, pendiente.codigo);
    await ar.empezar(cel, { tipo: 'rally', a: 15, mejorDe: 1, saca: 'A' });
    for (const h of ['saca', 'saca', 'recibe', 'saca', 'saca']) await ar.punto(cel, h);
    await esperar(1000);
  });
  const movil = await esc.contexto('publico-celular', CELULAR);
  const compu = await esc.contexto('publico-escritorio', ESCRITORIO);
  await esc.paso('celular: /torneos y /torneos/:id', () => revisarVistas(esc, movil, 'celular', id));
  await esc.paso('escritorio: /torneos y /torneos/:id', () => revisarVistas(esc, compu, 'escritorio', id));

  await esc.paso('el marcador público se mueve solo (Realtime) cuando el árbitro marca', async () => {
    const leerVivo = (p) => p.locator('span', { hasText: /^EN VIVO$/ }).first().locator('xpath=following-sibling::span[1]').innerText().catch(() => null);
    const antes = await leerVivo(movil);
    await ar.punto(cel, 'saca');
    await ar.punto(cel, 'saca');
    const t0 = Date.now();
    let despues = antes;
    while (Date.now() - t0 < 8000 && despues === antes) { await esperar(250); despues = await leerVivo(movil); }
    esc.verificar(despues !== antes, 'el celular del público ve el punto nuevo sin recargar (< 8 s)', { antes, despues, ms: Date.now() - t0 });
    esc.verificar(/6-1|1-6/.test(despues || ''), 'el marcador público es el del árbitro (6-1)', despues);
  });

  for (const [pagina, etiqueta] of [[movil, 'celular'], [compu, 'escritorio']]) {
    await esc.paso(`${etiqueta}: /programacion`, async () => {
      await pagina.goto(`${BASE}/programacion`);
      await pagina.waitForLoadState('networkidle').catch(() => {});
      await esperar(2500);
      const texto = await pagina.locator('body').innerText();
      const aparece = texto.includes(t.parejas[0].nombre) || /Sudamericano|Damas/i.test(texto);
      if (programacionEsperada) esc.verificar(aparece, `${etiqueta}: /programacion muestra los partidos del torneo en curso`, texto.slice(0, 300));
      else esc.verificar(aparece, `${etiqueta}: /programacion muestra el torneo en curso (Sudamericano)`, `no aparece: la página está atada al evento "Aniversario Pickleball City" (src/torneos/publico/programa.ts PROGRAMA.esDelEvento) — muestra: ${texto.slice(0, 200).replace(/\n/g, ' | ')}`);
      const conArbitro = /Con árbitro/i.test(texto) && /EN VIVO/.test(texto);
      esc.verificar(conArbitro, `${etiqueta}: /programacion muestra el partido con árbitro EN VIVO`);
      await esc.revisarPantalla(pagina, `${etiqueta}-programacion`);
    });
  }
  const tv = await esc.contexto('tv', { width: 1920, height: 1080 });
  await esc.paso('TV del club (/programacion?tv, 1920x1080)', async () => {
    await tv.goto(`${BASE}/programacion?tv`);
    await esperar(3500);
    const texto = await tv.locator('body').innerText();
    esc.verificar(/EN VIVO/.test(texto), 'la TV muestra el marcador EN VIVO del partido con árbitro', texto.slice(0, 300));
    if (programacionEsperada) esc.verificar(texto.includes('Próximo') || texto.includes('PRÓXIMO') || /vs/i.test(texto), 'la TV muestra próximos partidos');
    await esc.revisarPantalla(tv, 'tv-1920', { captura: true });
    await tv.setViewportSize(ESCRITORIO);
    await esperar(500);
    await esc.revisarPantalla(tv, 'tv-1440');
  });
  await esc.paso('al terminar el partido el marcador en vivo desaparece y queda el resultado', async () => {
    while (!(await cel.getByRole('button', { name: 'Terminar partido' }).count())) await ar.punto(cel, 'saca');
    await cel.getByRole('button', { name: 'Terminar partido' }).click();
    await cel.getByRole('button', { name: /^Confirmar/ }).click();
    await cel.getByText('Resultado cargado ✓').waitFor();
    const t0 = Date.now();
    let sigue = true;
    while (Date.now() - t0 < 10000 && sigue) { await esperar(400); sigue = (await movil.getByText('EN VIVO').count()) > 0; }
    esc.verificar(!sigue, 'el EN VIVO desaparece de /torneos/:id al terminar', { ms: Date.now() - t0 });
    const r = await movil.getByText(/15 – \d+|\d+ – 15/).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
    esc.verificar(r, 'y aparece el resultado final en el cuadro público sin recargar');
    await esc.revisarPantalla(movil, 'celular-resultado-final');
  });
}

async function torneoOculto(esc) {
  // "Visible al público" apagado: la web no lo muestra, pero el árbitro necesita los nombres.
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id } = await torneoEnCurso(esc, admin, 'Sudamericano 2026 · Prueba oculta');
  await esc.paso('apagar "Visible al público"', async () => {
    await g.abrirAjustes(admin);
    await admin.getByRole('switch', { name: /Visible al público/ }).click();
    await g.cerrarAjustes(admin);
    await g.esperarSincronizado(admin);
  });
  const hoja = await hojaCodigos(esc, admin, id, 'oculto');
  const cel = await esc.contexto('arbitro', CELULAR);
  const pub = await esc.contexto('publico', CELULAR);
  await esc.paso('la web no lo muestra', async () => {
    await pub.goto(`${BASE}/torneos/${id}`);
    await esperar(2500);
    const txt = await pub.locator('body').innerText();
    esc.verificar(!txt.includes(hoja.filas[0].a), 'la página pública del torneo oculto no muestra las parejas');
    await esc.revisarPantalla(pub, 'oculto-publico');
  });
  await esc.paso('el árbitro de un torneo oculto ve los nombres', async () => {
    await ar.entrar(cel, hoja.filas[0].codigo);
    await cel.getByText('¿Quién saca primero?').waitFor({ timeout: 10000 });
    const txt = await cel.locator('main').last().innerText();
    esc.verificar(txt.toUpperCase().includes(hoja.filas[0].a.toUpperCase()), 'la pantalla del árbitro nombra a las parejas', `muestra: ${txt.slice(0, 160).replace(/\n/g, ' | ')} — leerTorneo() lee rk_torneos como anónimo y RLS esconde los torneos ocultos`);
    await esc.revisarPantalla(cel, 'oculto-arbitro');
  });
}

const ESCENARIOS = {
  'publico-en-vivo-sudamericano': (esc) => enVivo(esc, { nombre: 'Sudamericano 2026 · Damas A', evento: 'Sudamericano', programacionEsperada: false }),
  'publico-en-vivo-aniversario': (esc) => enVivo(esc, { nombre: 'Aniversario Pickleball City · Dobles A', programacionEsperada: true }),
  'publico-torneo-oculto': torneoOculto,
};

module.exports = { ESCENARIOS };
