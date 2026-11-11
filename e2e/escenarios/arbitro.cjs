// Recorrido 2: el árbitro desde el celular (390x844), contra la base falsa con las RPC de v35/v36.
const { ESCRITORIO, CELULAR, BASE } = require('../lib/harness.cjs');
const g = require('../lib/gestor.cjs');
const ar = require('../lib/arbitro.cjs');
const o = require('../lib/oraculo.cjs');
const { esperarEstado, cargarGrupos } = require('./gestor.cjs');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Secuencia determinista de rallies: ~62% gana el que saca (así el side out también termina).
function generador(semilla) {
  let s = semilla >>> 0;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) % 100 < 62 ? 'saca' : 'recibe'; };
}

// Prepara un torneo de 4 parejas (1 grupo) con el formato de llave y de árbitro pedidos, con el
// fixture armado y sincronizado. Todo desde la pantalla del gestor.
async function prepararTorneo(esc, admin, { nombre, formatoLlave = 'Semis y final', arbGrupos = 'Rally a 15 · un game', arbLlave = 'Saque a 11 · mejor de 3', parejas = 4 }) {
  let id; let fuerza; const nombres = o.parejasDePrueba(parejas, 3);
  await esc.paso('gestor: crear torneo con formato de árbitro por fase', async () => {
    await g.login(admin);
    id = await g.crearTorneo(admin, { nombre });
    await g.cargarParejas(admin, nombres);
    await esperarEstado(admin, id, (x) => x.parejas.length === parejas);
    await g.irAGrupos(admin);
    await g.sortear(admin);
    await esperarEstado(admin, id, (x) => x.grupos.length >= 1 && x.grupos.reduce((s, gr) => s + gr.parejaIds.length, 0) === parejas);
    await g.elegirFormatoEnAjustes(admin, formatoLlave);
    await ar.elegirArbitraje(admin, 'grupos', arbGrupos);
    await ar.elegirArbitraje(admin, 'llave', arbLlave);
    await g.cerrarAjustes(admin);
    await g.confirmarGrupos(admin);
    await g.esperarSincronizado(admin);
    const t = await g.torneoLocal(admin, id);
    const porId = new Map(t.parejas.map((p) => [p.id, nombres.indexOf(p.nombre)]));
    fuerza = (pid) => porId.get(pid);
    esc.verificar(!!esc.fake.torneo(id), 'el torneo está en la base antes de dar códigos (si no, arbitro_terminar no tiene dónde escribir)');
  });
  return { id, fuerza, nombres };
}

async function hojaCodigos(esc, admin, id, cuando) {
  return esc.paso(`gestor: generar códigos de árbitro (${cuando})`, async () => {
    const hoja = await ar.leerHojaCodigos(admin);
    esc.exigir(!hoja.error, 'la hoja de códigos se genera sin error', hoja.error);
    const codigos = hoja.filas.map((f) => f.codigo);
    esc.verificar(codigos.every((c) => /^\d{4}$/.test(c)), 'todos los códigos son de 4 dígitos', codigos);
    esc.verificar(new Set(codigos).size === codigos.length, 'no hay códigos repetidos', codigos);
    await esc.revisarPantalla(admin, `hoja-codigos-${cuando}`);
    await ar.cerrarHoja(admin);
    // mapa código → partido, con lo que tiene la base (la prueba lo usa para verificar)
    const t = await g.torneoLocal(admin, id);
    const filas = hoja.filas.map((f) => {
      const c = esc.fake.codigos(id).find((x) => x.codigo === f.codigo);
      return { ...f, partidoId: c ? c.partido_id : null };
    });
    esc.verificar(filas.every((f) => f.partidoId), 'cada código de la hoja existe en arbitraje_codigos');
    return { filas, t };
  });
}

// Juega un partido entero desde el celular comparando CADA punto con el oráculo.
async function jugarPartido(esc, cel, { formato, saca = 'A', semilla = 7, deshacer = true, tiempo = true, etiqueta, rapido = false }) {
  await ar.empezar(cel, { ...formato, saca });
  const proximo = generador(semilla);
  const historia = [];
  const oraculo = () => { const t = new ar.Tanteo(formato, saca); for (const h of historia) t.rally(h); return t; };
  let t = oraculo();
  const errores = [];
  let primeraLectura = await ar.leer(cel);
  const nombreA = primeraLectura.lados[0]?.nombre; const nombreB = primeraLectura.lados[1]?.nombre;
  esc.verificar(primeraLectura.canto === t.canto(), `${etiqueta}: canto inicial ${t.canto()}`, primeraLectura.canto);
  await esc.revisarPantalla(cel, `${etiqueta}-arranque`);
  const comparar = async (cuando) => {
    const esperado = { a: t.pA, b: t.pB, saca: t.saca, canto: t.canto() };
    let l;
    for (let i = 0; i < 20; i++) {
      l = await ar.leer(cel);
      if (t.terminado || (l.lados[0]?.puntos === esperado.a && l.lados[1]?.puntos === esperado.b && l.canto === esperado.canto && l.lados[esperado.saca === 'A' ? 0 : 1]?.saca)) return l;
      await esperar(50);
    }
    if (errores.length < 6) errores.push({ cuando, esperado, pantalla: { a: l.lados[0]?.puntos, b: l.lados[1]?.puntos, canto: l.canto, sacaA: l.lados[0]?.saca } });
    return l;
  };
  let clicks = 0; let vioCambioLado = false; let vioFinGame = false; let deshizo = false; let tomoTiempo = false;
  while (!t.terminado && clicks < 400) {
    const h = proximo();
    await ar.punto(cel, h);
    historia.push(h); clicks++;
    t = oraculo();
    const l = await comparar(`rally ${clicks} (${h})`);
    if (l.avisos.some((x) => /CAMBIO DE LADO/.test(x))) { vioCambioLado = true; if (!rapido) await esc.revisarPantalla(cel, `${etiqueta}-cambio-de-lado`); }
    if (l.avisos.some((x) => /FIN DEL GAME/.test(x))) { vioFinGame = true; if (!rapido) await esc.revisarPantalla(cel, `${etiqueta}-fin-de-game`); }
    if (deshacer && !deshizo && clicks === 5) {
      // un punto mal marcado y "Deshacer": vuelve exactamente al estado anterior
      await cel.getByRole('button', { name: '↶ Deshacer', exact: true }).click();
      historia.pop(); t = oraculo(); deshizo = true;
      await comparar('después de Deshacer');
    }
    if (tiempo && !tomoTiempo && clicks === 3) {
      const antes = (await ar.leer(cel)).tiempos;
      await cel.getByRole('button', { name: /^Tiempo / }).first().click();
      await esperar(100);
      const despues = (await ar.leer(cel)).tiempos;
      esc.verificar(antes[0] !== despues[0] && /\(1\)$/.test(despues[0]), `${etiqueta}: "Tiempo" descuenta uno al equipo`, { antes, despues });
      await esc.revisarPantalla(cel, `${etiqueta}-tiempo`);
      // deshacer el tiempo (el árbitro se equivocó de equipo): vuelve a 2
      await cel.getByRole('button', { name: '↶ Deshacer', exact: true }).click();
      await esperar(100);
      const otra = (await ar.leer(cel)).tiempos;
      esc.verificar(/\(2\)$/.test(otra[0]), `${etiqueta}: Deshacer devuelve el tiempo`, otra);
      // y los puntos no se movieron
      await comparar('después de deshacer el tiempo');
      tomoTiempo = true;
    }
  }
  esc.verificar(errores.length === 0, `${etiqueta}: cada punto, el saque y el canto coinciden con el oráculo (${clicks} rallies)`, errores);
  esc.exigir(t.terminado, `${etiqueta}: el partido terminó en menos de 400 rallies`);
  // cambio de lado: solo en el game decisivo (el único, o el 3º), cuando el primero llega a 6/8/11
  const decisivo = formato.mejorDe === 1 ? t.games[0] : t.games[2];
  const mitad = formato.a === 11 ? 6 : formato.a === 15 ? 8 : 11;
  if (decisivo && Math.max(decisivo.a, decisivo.b) >= mitad) esc.verificar(vioCambioLado, `${etiqueta}: aparece el aviso de CAMBIO DE LADO en el game decisivo`);
  else esc.verificar(!vioCambioLado, `${etiqueta}: no aparece CAMBIO DE LADO fuera del game decisivo`);
  if (formato.mejorDe === 3) esc.verificar(vioFinGame, `${etiqueta}: aparece el aviso de FIN DEL GAME entre games`);
  // Terminar → Confirmar con el resultado
  const ganadorTxt = await cel.getByText(/^Ganó /).innerText();
  const ganadorNombre = t.ganador === 'A' ? nombreA : nombreB;
  esc.verificar(ganadorTxt.toUpperCase().includes((ganadorNombre || '').toUpperCase()), `${etiqueta}: "Ganó …" nombra al ganador correcto`, { pantalla: ganadorTxt, esperado: ganadorNombre });
  await esc.revisarPantalla(cel, `${etiqueta}-terminado`);
  await cel.getByRole('button', { name: 'Terminar partido' }).click();
  const textoGames = t.games.map((gm) => `${gm.a}-${gm.b}`).join(' / ');
  const confirmar = cel.getByRole('button', { name: `Confirmar ${textoGames}` });
  esc.verificar(await confirmar.count() === 1, `${etiqueta}: el botón de confirmar muestra el resultado (${textoGames})`, await cel.locator('button').allInnerTexts());
  return { oraculo: t, confirmar, nombreA, nombreB, clicks };
}

async function confirmarYVerificar(esc, cel, partida, { torneoId, partidoId, codigo, etiqueta }) {
  await partida.confirmar.click();
  const ok = await cel.getByText('Resultado cargado ✓').waitFor({ timeout: 10000 }).then(() => true, () => false);
  esc.verificar(ok, `${etiqueta}: aparece "Resultado cargado ✓"`, ok ? undefined : (await ar.leer(cel)).texto);
  await esc.revisarPantalla(cel, `${etiqueta}-resultado-cargado`);
  const res = partida.oraculo.resultado();
  const t = esc.fake.torneo(torneoId);
  const p = [...t.partidosGrupo, ...(t.partidosLlave || [])].find((x) => x.id === partidoId);
  esc.verificar(p && p.puntosA === res.puntosA && p.puntosB === res.puntosB, `${etiqueta}: el resultado entró al cuadro en la base (rk_torneos)`, { base: p && [p.puntosA, p.puntosB, p.games], esperado: res });
  if (res.games) esc.verificar(JSON.stringify(p.games) === JSON.stringify(res.games), `${etiqueta}: el detalle de games quedó en el cuadro`, { base: p.games, esperado: res.games });
  const arb = esc.fake.partidoArbitrado(torneoId, partidoId);
  esc.verificar(arb && arb.estado === 'terminado', `${etiqueta}: arbitraje_partidos queda 'terminado'`, arb && arb.estado);
  esc.verificar(!esc.fake.codigos(torneoId).some((c) => c.codigo === codigo), `${etiqueta}: el código queda dado de baja`);
  return res;
}

async function refrescarGestor(admin) {
  await admin.getByRole('button', { name: /Refrescar desde el server/ }).click();
  await esperar(800);
}

// ─── Escenario principal ─────────────────────────────────────────────────────

async function flujoCompleto(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id, fuerza } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Árbitros' });
  let hoja = await hojaCodigos(esc, admin, id, 'grupos');
  esc.verificar(hoja.filas.length === 6, 'la hoja tiene los 6 partidos del grupo', hoja.filas.length);
  const cel = await esc.contexto('arbitro', CELULAR);
  const pub = await esc.contexto('publico-celular', CELULAR);

  // Partido 1: rally a 15, un game (el de la categoría), con Tiempo y Deshacer.
  const f1 = hoja.filas[0];
  await esc.paso('árbitro: partido 1 rally a 15 · un game, con Tiempo y Deshacer', async () => {
    await ar.entrar(cel, f1.codigo);
    await cel.getByText('¿Quién saca primero?').waitFor();
    const primero = await cel.locator('main').last().innerText();
    if (/Equipo A vs Equipo B/.test(primero)) esc.observaciones.push({ tipo: 'hallazgo.arbitro-nombres-tardan', ctx: 'arbitro', url: cel.url(), detalle: 'la pantalla de inicio aparece primero con "Equipo A vs Equipo B" (y sin el freno de "todavía no se sabe quién juega") hasta que llega leerTorneo()' });
    const ok = await cel.getByText(f1.a).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
    const txt = await cel.locator('main').last().innerText();
    esc.verificar(ok && txt.includes(f1.b), 'la pantalla de inicio muestra las dos parejas del código', txt.slice(0, 200));
    await esc.revisarPantalla(cel, 'p1-inicio');
    // la web pública, abierta en otro celular, para ver el marcador en vivo
    await pub.goto(`${BASE}/torneos/${id}`);
    const partida = await jugarPartido(esc, cel, { formato: { tipo: 'rally', a: 15, mejorDe: 1 }, saca: 'A', semilla: 11, etiqueta: 'p1' });
    const vivo = await pub.getByText('EN VIVO', { exact: true }).first().waitFor({ timeout: 25000 }).then(() => true, () => false);
    esc.verificar(vivo, 'la página pública del torneo muestra el partido EN VIVO mientras se arbitra');
    await esc.revisarPantalla(pub, 'publico-en-vivo-p1');
    await confirmarYVerificar(esc, cel, partida, { torneoId: id, partidoId: f1.partidoId, codigo: f1.codigo, etiqueta: 'p1' });
  });

  // Partido 2: el árbitro cambia a saque tradicional a 11.
  const f2 = hoja.filas[1];
  await esc.paso('árbitro: partido 2 el árbitro elige saque tradicional a 11', async () => {
    await cel.getByRole('button', { name: 'Otro partido' }).click();
    await ar.entrar(cel, f2.codigo, { navegar: false });
    const partida = await jugarPartido(esc, cel, { formato: { tipo: 'sideout', a: 11, mejorDe: 1 }, saca: 'B', semilla: 23, etiqueta: 'p2', tiempo: false });
    await confirmarYVerificar(esc, cel, partida, { torneoId: id, partidoId: f2.partidoId, codigo: f2.codigo, etiqueta: 'p2' });
  });

  await esc.paso('gestor: ver los resultados del árbitro', async () => {
    await esperar(2000);
    let t = await g.torneoLocal(admin, id);
    const visto = t.partidosGrupo.find((p) => p.id === f1.partidoId).puntosA !== null;
    // Hallazgo (no corta el recorrido feliz; la consecuencia grave la prueba arbitro-gestor-pisa-resultado)
    if (!visto) esc.observaciones.push({ tipo: 'hallazgo.gestor-no-se-actualiza', ctx: 'admin', url: admin.url(), detalle: 'el gestor abierto NO muestra el resultado que cargó el árbitro hasta tocar la píldora o recargar (no escucha Realtime ni relee la base)' });
    await refrescarGestor(admin);
    t = await esperarEstado(admin, id, (x) => x.partidosGrupo.find((p) => p.id === f2.partidoId).puntosA !== null);
    esc.verificar(t.partidosGrupo.find((p) => p.id === f1.partidoId).puntosA !== null && t.partidosGrupo.find((p) => p.id === f2.partidoId).puntosA !== null, 'después de refrescar, el gestor tiene los dos resultados del árbitro');
    await esc.revisarPantalla(admin, 'gestor-con-resultados-del-arbitro');
  });

  await esc.paso('gestor: cargar el resto del grupo y armar la llave', async () => {
    let t = await g.torneoLocal(admin, id);
    const nombre = (pid) => t.parejas.find((p) => p.id === pid).nombre;
    for (const p of t.partidosGrupo.filter((x) => x.puntosA === null)) {
      const r = o.resultado(fuerza(p.aId), fuerza(p.bId));
      await g.cargarResultadoGrupo(admin, p.ronda, nombre(p.aId), nombre(p.bId), r.a, r.b);
    }
    t = await esperarEstado(admin, id, (x) => x.partidosGrupo.every((p) => p.puntosA !== null));
    await admin.getByRole('button', { name: 'Armar llave' }).last().click();
    await admin.getByText('Así sale la llave').waitFor();
    await admin.getByRole('button', { name: 'Armar llave' }).last().click();
    await admin.getByRole('heading', { name: 'Llave', exact: true }).waitFor();
    await g.esperarSincronizado(admin);
    const nube = esc.fake.torneo(id);
    esc.verificar(nube.partidosGrupo.find((p) => p.id === f1.partidoId).puntosA !== null, 'después de que el gestor sube su versión, el resultado del árbitro sigue en la base');
  });

  hoja = await hojaCodigos(esc, admin, id, 'llave');
  const tLlave = await g.torneoLocal(admin, id);
  const semis = tLlave.partidosLlave.filter((p) => p.ronda === 1).sort((a, b) => a.posicion - b.posicion);
  const final = tLlave.partidosLlave.find((p) => p.ronda === 2);
  const fila = (pid) => hoja.filas.find((f) => f.partidoId === pid);
  esc.verificar(hoja.filas.length === 3 && fila(semis[0].id) && fila(semis[1].id) && fila(final.id), 'la hoja de la llave trae las 2 semis y la final', hoja.filas);
  esc.verificar(/A definir/.test(`${fila(final.id)?.a} ${fila(final.id)?.b}`), 'la final figura "A definir vs A definir"', fila(final.id));

  await esc.paso('árbitro: el código de la final antes de las semis', async () => {
    await cel.getByRole('button', { name: 'Otro partido' }).click();
    await ar.entrar(cel, fila(final.id).codigo, { navegar: false });
    const ok = await cel.getByText('Todavía no se sabe quién juega').waitFor({ timeout: 8000 }).then(() => true, () => false);
    esc.verificar(ok, 'con la final sin definir, el árbitro ve "Todavía no se sabe quién juega"');
    await esc.revisarPantalla(cel, 'final-sin-definir');
    await cel.getByRole('button', { name: 'Volver' }).click();
  });

  let ganadorSemi1;
  await esc.paso('árbitro: semi 1 saque a 11 al mejor de 3 (el formato de la llave)', async () => {
    const f = fila(semis[0].id);
    await ar.entrar(cel, f.codigo, { navegar: false });
    await cel.getByText('¿Quién saca primero?').waitFor();
    const activos = await cel.locator('button.bg-white').allInnerTexts();
    esc.verificar(activos.includes('Saque tradicional') && activos.includes('A 11') && activos.includes('Mejor de 3'), 'el inicio viene marcado con el formato de la llave (saque a 11, mejor de 3)', activos);
    const partida = await jugarPartido(esc, cel, { formato: { tipo: 'sideout', a: 11, mejorDe: 3 }, saca: 'A', semilla: 5, etiqueta: 'semi1', tiempo: false });
    await confirmarYVerificar(esc, cel, partida, { torneoId: id, partidoId: semis[0].id, codigo: f.codigo, etiqueta: 'semi1' });
    ganadorSemi1 = partida.oraculo.ganador === 'A' ? partida.nombreA : partida.nombreB;
  });

  await esc.paso('gestor: el ganador de la semi 1 aparece en la final', async () => {
    await refrescarGestor(admin);
    const t = await esperarEstado(admin, id, (x) => x.partidosLlave.find((p) => p.id === semis[0].id).puntosA !== null);
    const nube = esc.fake.torneo(id);
    const gan = require('./gestor.cjs').resolver({ tipo: 'ganadorDe', partidoId: semis[0].id }, nube.partidosLlave);
    const nom = gan && t.parejas.find((p) => p.id === gan).nombre;
    esc.verificar(nom && nom.toUpperCase() === (ganadorSemi1 || '').toUpperCase(), 'el ganador que marcó el árbitro es el que avanza', { cuadro: nom, arbitro: ganadorSemi1 });
    const enFinal = await admin.locator('.partido-llave').filter({ hasText: nom }).count();
    esc.verificar(enFinal >= 2, 'el gestor muestra al ganador de la semi 1 ya ubicado en la final');
    await esc.revisarPantalla(admin, 'gestor-semi1-avanza');
  });

  await esc.paso('árbitro: semi 2, el árbitro elige rally a 11 al mejor de 3', async () => {
    const f = fila(semis[1].id);
    await cel.getByRole('button', { name: 'Otro partido' }).click();
    await ar.entrar(cel, f.codigo, { navegar: false });
    const partida = await jugarPartido(esc, cel, { formato: { tipo: 'rally', a: 11, mejorDe: 3 }, saca: 'B', semilla: 99, etiqueta: 'semi2', tiempo: false, deshacer: false, rapido: true });
    await confirmarYVerificar(esc, cel, partida, { torneoId: id, partidoId: semis[1].id, codigo: f.codigo, etiqueta: 'semi2' });
  });

  let campeonArbitro;
  await esc.paso('árbitro: la final (saque a 11, mejor de 3)', async () => {
    const f = fila(final.id);
    await cel.getByRole('button', { name: 'Otro partido' }).click();
    await ar.entrar(cel, f.codigo, { navegar: false });
    await cel.getByText('¿Quién saca primero?').waitFor();
    const titulo = await cel.locator('main').last().innerText();
    esc.verificar(/FINAL/i.test(titulo), 'el título del partido dice Final', titulo.slice(0, 80));
    const partida = await jugarPartido(esc, cel, { formato: { tipo: 'sideout', a: 11, mejorDe: 3 }, saca: 'A', semilla: 314, etiqueta: 'final', tiempo: false, deshacer: false, rapido: true });
    await confirmarYVerificar(esc, cel, partida, { torneoId: id, partidoId: final.id, codigo: f.codigo, etiqueta: 'final' });
    campeonArbitro = partida.oraculo.ganador === 'A' ? partida.nombreA : partida.nombreB;
  });

  await esc.paso('gestor y web pública muestran al campeón que marcó el árbitro', async () => {
    await refrescarGestor(admin);
    await esperarEstado(admin, id, (x) => x.partidosLlave.every((p) => p.puntosA !== null));
    const card = admin.locator('div.rounded-2xl.bg-navy-700').filter({ hasText: 'Campeón' }).first();
    const ok = await card.waitFor({ timeout: 8000 }).then(() => true, () => false);
    const campeon = ok ? (await card.locator('h2').innerText()).trim() : null;
    esc.verificar(campeon && campeon.toUpperCase() === (campeonArbitro || '').toUpperCase(), 'el gestor muestra campeón al ganador de la final del árbitro', { gestor: campeon, arbitro: campeonArbitro });
    await esc.revisarPantalla(admin, 'gestor-campeon-por-arbitro');
    await pub.goto(`${BASE}/torneos/${id}`);
    const vis = await pub.getByText(new RegExp(campeonArbitro.split(' Y ')[0], 'i')).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
    esc.verificar(vis, 'la web pública muestra al campeón');
    await esc.revisarPantalla(pub, 'publico-campeon-por-arbitro');
  });
}

// ─── Escenarios de robustez ──────────────────────────────────────────────────

async function codigoInvalido(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Códigos' });
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const cel = await esc.contexto('arbitro-1', CELULAR);
  await esc.paso('código inexistente', async () => {
    let malo = '0000'; while (hoja.filas.some((f) => f.codigo === malo)) malo = String(Number(malo) + 1).padStart(4, '0');
    await ar.entrar(cel, malo);
    const msg = await cel.getByRole('alert').innerText().catch(() => null);
    esc.verificar(msg === 'Código incorrecto o el partido ya terminó.', 'un código que no existe muestra "Código incorrecto…"', msg);
    await esc.revisarPantalla(cel, 'codigo-incorrecto');
  });
  await esc.paso('la caja solo acepta 4 números', async () => {
    const caja = cel.getByLabel('Código del partido');
    await caja.fill('');
    await caja.pressSequentially('12a3456');
    esc.verificar(await caja.inputValue() === '1234', 'letras afuera y máximo 4 dígitos', await caja.inputValue());
    await caja.fill('12');
    esc.verificar(await cel.getByRole('button', { name: 'Entrar' }).isDisabled(), 'con menos de 4 dígitos el botón Entrar está deshabilitado');
  });
  await esc.paso('10 códigos mal en 10 minutos frenan al que prueba números (y a todo el wifi del club)', async () => {
    for (let i = 0; i < 10; i++) {
      let c = String(9000 + i); if (hoja.filas.some((f) => f.codigo === c)) c = String(8000 + i);
      await ar.entrar(cel, c, { navegar: false });
      await cel.getByRole('alert').waitFor();
    }
    await ar.entrar(cel, hoja.filas[0].codigo, { navegar: false });
    const msg = await cel.getByRole('alert').innerText().catch(() => null);
    esc.verificar(/Demasiados códigos incorrectos/.test(msg || ''), 'después de 10 errores, hasta el código correcto queda frenado', msg);
    // otro árbitro, otro celular, MISMA IP pública (el wifi del club): también queda frenado
    const cel2 = await esc.contexto('arbitro-2', CELULAR);
    await ar.entrar(cel2, hoja.filas[1].codigo);
    const msg2 = await cel2.getByRole('alert').innerText({ timeout: 8000 }).catch(() => null);
    esc.verificar(!/Demasiados/.test(msg2 || ''), 'un árbitro que no se equivocó (otro celular en el mismo wifi) puede entrar', `queda frenado: "${msg2}" — el freno es por IP (x-forwarded-for) y en el club todos salen por la misma`);
    await esc.revisarPantalla(cel2, 'otro-arbitro-frenado');
  });
}

async function recargarAMitad(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Recarga' });
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const f = hoja.filas[0];
  const cel = await esc.contexto('arbitro', CELULAR);
  const formato = { tipo: 'rally', a: 15, mejorDe: 1 };
  const historia = ['saca', 'saca', 'recibe', 'saca', 'recibe', 'recibe', 'saca'];
  await esc.paso('marcar 7 rallies y recargar el celular', async () => {
    await ar.entrar(cel, f.codigo);
    await ar.empezar(cel, { ...formato, saca: 'A' });
    for (const h of historia) await ar.punto(cel, h);
    await esperar(1200);
    const antes = await ar.leer(cel);
    await cel.reload();
    const caja = cel.getByLabel('Código del partido');
    await caja.waitFor();
    esc.verificar(true, 'al recargar vuelve a pedir el código (no lo recuerda)');
    await ar.entrar(cel, f.codigo, { navegar: false });
    await cel.getByRole('button', { name: 'Ganó el que saca' }).waitFor({ timeout: 10000 });
    const despues = await ar.leer(cel);
    const t = new ar.Tanteo(formato, 'A'); for (const h of historia) t.rally(h);
    esc.verificar(despues.lados[0].puntos === t.pA && despues.lados[1].puntos === t.pB && despues.canto === t.canto(), 'después de recargar sigue en el mismo tanteo', { antes: antes.canto, despues: despues.canto, esperado: t.canto() });
    await esc.revisarPantalla(cel, 'despues-de-recargar');
  });
  await esc.paso('recargar con puntos SIN subir (sin señal) y volver', async () => {
    await esc.red(cel, false);
    for (const h of ['saca', 'saca', 'recibe']) await ar.punto(cel, h);
    historia.push('saca', 'saca', 'recibe');
    await esperar(300);
    const l = await ar.leer(cel);
    esc.verificar(/Sin señal/.test(l.texto), 'sin red avisa "Sin señal: lo marcado queda guardado…"');
    await esc.red(cel, true);
    // recargar justo cuando vuelve la señal, antes del reintento de 5 s
    await cel.reload();
    await ar.entrar(cel, f.codigo, { navegar: false });
    await cel.getByRole('button', { name: 'Ganó el que saca' }).waitFor({ timeout: 10000 });
    const t = new ar.Tanteo(formato, 'A'); for (const h of historia) t.rally(h);
    const d = await ar.leer(cel);
    esc.verificar(d.canto === t.canto() && d.lados[0].puntos === t.pA, 'los puntos marcados sin señal no se pierden al recargar', { pantalla: d.canto, esperado: t.canto() });
    await esperar(6500);
    const arb = esc.fake.partidoArbitrado(id, f.partidoId);
    esc.verificar(arb.jugadas.length === historia.length + 1, 'y se suben solos al volver la señal', { servidor: arb.jugadas.length, telefono: historia.length + 1 });
  });
}

async function cortarRed(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Sin señal' });
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const f = hoja.filas[0];
  const cel = await esc.contexto('arbitro', CELULAR);
  const tv = await esc.contexto('publico-celular', CELULAR);
  const formato = { tipo: 'rally', a: 15, mejorDe: 1 };
  const t = new ar.Tanteo(formato, 'A');
  await esc.paso('marcar con señal, cortar la red y seguir marcando', async () => {
    await ar.entrar(cel, f.codigo);
    await ar.empezar(cel, { ...formato, saca: 'A' });
    await tv.goto(`${BASE}/torneos/${id}`);
    for (const h of ['saca', 'saca', 'saca']) { await ar.punto(cel, h); t.rally(h); }
    await esperar(800);
    await esc.red(cel, false);
    for (let i = 0; i < 6; i++) { await ar.punto(cel, 'saca'); t.rally('saca'); }
    await esperar(500);
    const l = await ar.leer(cel);
    esc.verificar(/Sin señal/.test(l.texto), 'avisa "Sin señal" y deja seguir marcando', l.texto.slice(0, 200));
    esc.verificar(l.lados[0].puntos === t.pA, 'el tanteo local sigue al día sin red');
    await esc.revisarPantalla(cel, 'sin-senal');
    const cola = await cel.evaluate((c) => JSON.parse(localStorage.getItem(`volea_arbitro_${c}`) || 'null'), f.codigo);
    esc.verificar(cola && cola.pendiente && cola.jugadas.length === 10, 'la cola offline quedó guardada en el teléfono', cola && { pendiente: cola.pendiente, jugadas: cola.jugadas.length });
    const arb = esc.fake.partidoArbitrado(id, f.partidoId);
    esc.verificar(arb.jugadas.length === 4, 'el servidor quedó en lo último con señal (inicio + 3)', arb.jugadas.length);
  });
  await esc.paso('vuelve la señal: se sube solo y el marcador público se pone al día', async () => {
    await esc.red(cel, true);
    await esperar(6500);
    const arb = esc.fake.partidoArbitrado(id, f.partidoId);
    esc.verificar(arb.jugadas.length === 10, 'al volver la señal la cola se sube sola (≤ 5 s)', arb.jugadas.length);
    const l = await ar.leer(cel);
    esc.verificar(!/Sin señal/.test(l.texto), 'desaparece el aviso de "Sin señal"');
    const vivo = await tv.getByText(`${t.pA}-${t.pB}`).first().waitFor({ timeout: 25000 }).then(() => true, () => false);
    esc.verificar(vivo, `la página pública muestra el marcador al día (${t.pA}-${t.pB})`);
    await esc.revisarPantalla(tv, 'publico-al-dia');
  });
  await esc.paso('terminar sin señal y reintentar', async () => {
    while (!t.terminado) { await ar.punto(cel, 'saca'); t.rally('saca'); }
    await esperar(800);
    await esc.red(cel, false);
    await cel.getByRole('button', { name: 'Terminar partido' }).click();
    await cel.getByRole('button', { name: /^Confirmar/ }).click();
    const aviso = await cel.getByRole('alert').innerText({ timeout: 5000 }).catch(() => null);
    esc.verificar(/Sin señal: probá de nuevo/.test(aviso || ''), 'confirmar sin señal avisa "Sin señal: probá de nuevo"', aviso);
    await esc.revisarPantalla(cel, 'terminar-sin-senal');
    await esc.red(cel, true);
    await cel.getByRole('button', { name: /^Confirmar/ }).click();
    const ok = await cel.getByText('Resultado cargado ✓').waitFor({ timeout: 10000 }).then(() => true, () => false);
    esc.verificar(ok, 'con señal, el mismo botón Confirmar carga el resultado');
    const tt = esc.fake.torneo(id);
    const p = tt.partidosGrupo.find((x) => x.id === f.partidoId);
    esc.verificar(p.puntosA === t.pA && p.puntosB === t.pB, 'el resultado del cuadro es el del partido', { base: [p.puntosA, p.puntosB], esperado: [t.pA, t.pB] });
  });
}

async function redLenta(esc) {
  // Árbitro rápido con 3G lenta: marca dos rallies seguidos antes de que responda el primero.
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Red lenta' });
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const f = hoja.filas[0];
  const cel = await esc.contexto('arbitro', CELULAR);
  await esc.paso('dos toques seguidos con la red lenta (800 ms)', async () => {
    await ar.entrar(cel, f.codigo);
    await ar.empezar(cel, { tipo: 'rally', a: 15, mejorDe: 1, saca: 'A' });
    await esperar(500);
    esc.fake.demoraMs = 800;
    await ar.punto(cel, 'saca');
    await esperar(150);
    await ar.punto(cel, 'saca');
    await esperar(150);
    await ar.punto(cel, 'recibe');
    esc.fake.demoraMs = 0;
    await esperar(7000); // más que el reintento de 5 s
    const arb = esc.fake.partidoArbitrado(id, f.partidoId);
    const l = await ar.leer(cel);
    esc.verificar(arb.jugadas.length === 4, 'pasado el apuro, el servidor tiene los 3 rallies (el marcador de la TV queda al día)', { servidor: arb.jugadas.length, telefono: 4, marcadorServidor: arb.marcador && arb.marcador.canto, pantalla: l.canto });
  });
}

async function terminarDosVeces(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Doble cierre' });
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const f = hoja.filas[0];
  const cel = await esc.contexto('arbitro', CELULAR);
  const cel2 = await esc.contexto('arbitro-suplente', CELULAR);
  const formato = { tipo: 'rally', a: 15, mejorDe: 1 };
  await esc.paso('dos celulares con el mismo código', async () => {
    await ar.entrar(cel, f.codigo);
    await ar.empezar(cel, { ...formato, saca: 'A' });
    for (let i = 0; i < 3; i++) await ar.punto(cel, 'saca');
    await esperar(600);
    await ar.entrar(cel2, f.codigo);
    await cel2.getByRole('button', { name: 'Ganó el que saca' }).waitFor({ timeout: 10000 });
    const l2 = await ar.leer(cel2);
    esc.verificar(l2.canto === '3-0', 'el segundo celular entra en el mismo tanteo', l2.canto);
    // el primero sigue marcando; el segundo marca algo viejo → "Otro dispositivo cambió…"
    await ar.punto(cel, 'saca');
    await esperar(600);
    await ar.punto(cel2, 'recibe');
    const aviso = await cel2.getByRole('alert').innerText({ timeout: 5000 }).catch(() => null);
    esc.verificar(/Otro dispositivo cambió este partido/.test(aviso || ''), 'el celular desfasado avisa y se pone al día', aviso);
    const l2b = await ar.leer(cel2);
    esc.verificar(l2b.canto === '4-0', 'el segundo celular queda en 4-0 (lo del servidor)', l2b.canto);
    await esc.revisarPantalla(cel2, 'otro-dispositivo');
  });
  await esc.paso('tocar Confirmar dos veces seguidas', async () => {
    while (!(await cel.getByRole('button', { name: 'Terminar partido' }).count())) await ar.punto(cel, 'saca');
    await esperar(800);
    await cel.getByRole('button', { name: 'Terminar partido' }).click();
    const b = cel.getByRole('button', { name: /^Confirmar/ });
    await b.dblclick();
    const ok = await cel.getByText('Resultado cargado ✓').waitFor({ timeout: 10000 }).then(() => true, () => false);
    esc.verificar(ok, 'con doble toque igual termina en "Resultado cargado ✓"');
    const llamadas = esc.fake.log.filter((x) => /arbitro_terminar/.test(x.ruta)).length;
    esc.verificar(llamadas >= 1, `arbitro_terminar se llamó ${llamadas} vez/veces`);
    const tt = esc.fake.torneo(id);
    const p = tt.partidosGrupo.find((x) => x.id === f.partidoId);
    esc.verificar(p.puntosA === 15 && p.puntosB === 0, 'el cuadro tiene 15-0 una sola vez', [p.puntosA, p.puntosB]);
  });
  await esc.paso('el otro celular intenta terminar después', async () => {
    await esperar(300);
    // el suplente tiene la pantalla en 4-0: marca y queda desfasado; el código ya no vale
    await ar.punto(cel2, 'saca');
    await esperar(1200);
    const l = await ar.leer(cel2);
    esc.verificar(/ya no es válido|terminó|Resultado cargado/i.test(l.texto), 'el segundo celular se entera de que el partido terminó', l.texto.slice(0, 300));
    await esc.revisarPantalla(cel2, 'suplente-despues-de-terminar');
    await ar.entrar(cel2, f.codigo);
    const msg = await cel2.getByRole('alert').innerText().catch(() => null);
    esc.verificar(msg === 'Código incorrecto o el partido ya terminó.', 'entrar de nuevo con el código usado: "…el partido ya terminó"', msg);
  });
}

async function gestorPisaArbitro(esc) {
  // Brian tiene el gestor abierto (sin refrescar) mientras un árbitro termina un partido, y
  // carga a mano OTRO resultado del mismo torneo.
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id, fuerza } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Concurrencia' });
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const f = hoja.filas[0];
  const cel = await esc.contexto('arbitro', CELULAR);
  await esc.paso('el árbitro termina el partido 1', async () => {
    await ar.entrar(cel, f.codigo);
    await ar.empezar(cel, { tipo: 'rally', a: 15, mejorDe: 1, saca: 'A' });
    for (let i = 0; i < 15; i++) await ar.punto(cel, 'saca');
    await cel.getByRole('button', { name: 'Terminar partido' }).click();
    await cel.getByRole('button', { name: /^Confirmar/ }).click();
    await cel.getByText('Resultado cargado ✓').waitFor();
    esc.verificar(esc.fake.torneo(id).partidosGrupo.find((p) => p.id === f.partidoId).puntosA === 15, 'el resultado del árbitro está en la base');
  });
  await esc.paso('Brian carga a mano otro partido en el gestor (sin refrescar)', async () => {
    const t = await g.torneoLocal(admin, id);
    const otro = t.partidosGrupo.find((p) => p.id !== f.partidoId);
    const nombre = (pid) => t.parejas.find((p) => p.id === pid).nombre;
    const r = o.resultado(fuerza(otro.aId), fuerza(otro.bId));
    await g.cargarResultadoGrupo(admin, otro.ronda, nombre(otro.aId), nombre(otro.bId), r.a, r.b);
    await esperar(2500);
    await g.esperarSincronizado(admin).catch(() => {});
    const pill = await admin.getByRole('button', { name: /Refrescar desde el server/ }).innerText();
    const nube = esc.fake.torneo(id);
    const p1 = nube.partidosGrupo.find((p) => p.id === f.partidoId);
    esc.verificar(p1.puntosA === 15, 'el resultado del árbitro sobrevive a que el gestor suba su versión', { enLaBase: [p1.puntosA, p1.puntosB], pildora: pill });
    await esc.revisarPantalla(admin, 'gestor-despues-de-subir');
    const arb = esc.fake.partidoArbitrado(id, f.partidoId);
    const codigoVigente = esc.fake.codigos(id).some((c) => c.partido_id === f.partidoId);
    esc.verificar(p1.puntosA === 15 || codigoVigente, 'si se perdió el resultado, al menos el árbitro puede volver a cargarlo', { arbitraje: arb.estado, codigoVigente });
  });
}

const ESCENARIOS = {
  'arbitro-flujo-completo': flujoCompleto,
  'arbitro-codigo-invalido': codigoInvalido,
  'arbitro-recargar': recargarAMitad,
  'arbitro-sin-red': cortarRed,
  'arbitro-red-lenta': redLenta,
  'arbitro-terminar-dos-veces': terminarDosVeces,
  'arbitro-gestor-pisa-resultado': gestorPisaArbitro,
};

module.exports = { ESCENARIOS, prepararTorneo, hojaCodigos, jugarPartido, confirmarYVerificar, generador };

// Final de un torneo OCULTO con las semis sin jugar: el árbitro no puede leer los nombres.
async function finalSinDefinirOculto(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id, fuerza } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Oculto' });
  await esc.paso('gestor: grupos completos, llave armada y torneo oculto', async () => {
    await require('./gestor.cjs').cargarGrupos(esc, admin, id, fuerza);
    await admin.getByRole('button', { name: 'Armar llave' }).last().click();
    await admin.getByText('Así sale la llave').waitFor();
    await admin.getByRole('button', { name: 'Armar llave' }).last().click();
    await admin.getByRole('heading', { name: 'Llave', exact: true }).waitFor();
    await g.abrirAjustes(admin);
    await admin.getByRole('switch', { name: /Visible al público/ }).click();
    await g.cerrarAjustes(admin);
    await g.esperarSincronizado(admin);
  });
  const hoja = await hojaCodigos(esc, admin, id, 'llave-oculta');
  const t = await g.torneoLocal(admin, id);
  const final = t.partidosLlave.find((p) => p.ronda === 2);
  const f = hoja.filas.find((x) => x.partidoId === final.id);
  const cel = await esc.contexto('arbitro', CELULAR);
  await esc.paso('árbitro entra a la final sin semis jugadas', async () => {
    await ar.entrar(cel, f.codigo);
    const frenado = await cel.getByText('Todavía no se sabe quién juega').waitFor({ timeout: 8000 }).then(() => true, () => false);
    esc.verificar(frenado, 'la final sin rivales definidos NO se puede empezar', 'en un torneo oculto leerTorneo() devuelve null (RLS) y la pantalla deja empezar con "Equipo A vs Equipo B"');
    await esc.revisarPantalla(cel, 'final-oculta-inicio');
    if (frenado) return;
    await ar.empezar(cel, { tipo: 'sideout', a: 11, mejorDe: 3, saca: 'A' });
    while (!(await cel.getByRole('button', { name: 'Terminar partido' }).count())) await ar.punto(cel, 'saca');
    await cel.getByRole('button', { name: 'Terminar partido' }).click();
    await cel.getByRole('button', { name: /^Confirmar/ }).click();
    await esperar(1500);
    await esc.revisarPantalla(cel, 'final-oculta-terminada');
    const nube = esc.fake.torneo(id);
    const fin = nube.partidosLlave.find((p) => p.id === final.id);
    esc.verificar(fin.puntosA === null, 'la base NO acepta un resultado para la final con las semis sin jugar', { finalEnLaBase: [fin.puntosA, fin.puntosB], semis: nube.partidosLlave.filter((p) => p.ronda === 1).map((p) => [p.puntosA, p.puntosB]) });
  });
}
ESCENARIOS['arbitro-final-sin-rivales-oculto'] = finalSinDefinirOculto;
