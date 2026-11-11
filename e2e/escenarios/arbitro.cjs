// Recorrido 2: el árbitro desde el celular (390x844), contra la base falsa. Se corre con las RPC de
// la v36 (E2E_ARBITRAJE=v36: lo que hay en producción entre el deploy de la web y la migración) o con
// las de la v37 (por defecto). Donde la base cambia el comportamiento, la verificación dice cuál.
const { ESCRITORIO, CELULAR, BASE } = require('../lib/harness.cjs');
const g = require('../lib/gestor.cjs');
const ar = require('../lib/arbitro.cjs');
const o = require('../lib/oraculo.cjs');
const { esperarEstado, cargarGrupos } = require('./gestor.cjs');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const v37 = (esc) => esc.fake.modo === 'v37';
const base = (esc) => `base ${esc.fake.modo}`;

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
    const largo = v37(esc) ? 6 : 4; // v37: códigos nuevos de 6 cifras
    esc.verificar(codigos.every((c) => new RegExp(`^\\d{${largo}}$`).test(c)), `todos los códigos son de ${largo} dígitos (${base(esc)})`, codigos);
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
async function jugarPartido(esc, cel, { formato, saca = 'A', semilla = 7, deshacer = true, tiempo = true, etiqueta, rapido = false, formatoOrganizacion }) {
  const alLlegar = await ar.empezar(cel, { ...formato, saca });
  if (formatoOrganizacion) {
    esc.verificar(alLlegar && alLlegar.rotulo.toLowerCase() === 'formato que puso la organización' && alLlegar.texto === ar.textoFormato(formatoOrganizacion),
      `${etiqueta}: la pantalla de inicio muestra el formato que puso la organización (${ar.textoFormato(formatoOrganizacion)})`, alLlegar);
  }
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
      // Tiempo pide confirmación: el primer toque NO descuenta.
      await cel.getByRole('button', { name: /^Tiempo / }).first().click();
      const pregunta = await cel.getByText(/^¿Tiempo para /).isVisible().catch(() => false);
      esc.verificar(pregunta, `${etiqueta}: "Tiempo" pregunta antes de descontar`);
      await cel.getByRole('button', { name: 'Sí, tiempo' }).click();
      await esperar(100);
      const despues = (await ar.leer(cel)).tiempos;
      esc.verificar(antes[0] !== despues[0] && /\(1\)$/.test(despues[0]), `${etiqueta}: "Tiempo" (confirmado) descuenta uno al equipo`, { antes, despues });
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
  // Terminar → confirmación con el resultado, en otro lugar y que no se dispara con un doble toque
  const ganadorTxt = await cel.getByText(/^Ganó /).innerText();
  const ganadorNombre = t.ganador === 'A' ? nombreA : nombreB;
  esc.verificar(ganadorTxt.toUpperCase().includes((ganadorNombre || '').toUpperCase()), `${etiqueta}: "Ganó …" nombra al ganador correcto`, { pantalla: ganadorTxt, esperado: ganadorNombre });
  await esc.revisarPantalla(cel, `${etiqueta}-terminado`);
  const textoGames = t.games.map((gm) => `${gm.a}-${gm.b}`).join(' / ');
  const conf = await ar.terminar(cel);
  esc.verificar((conf.pregunta || '').includes(textoGames), `${etiqueta}: la confirmación muestra el resultado (${textoGames})`, conf.pregunta);
  esc.verificar(!ar.sePisan(conf.cajaTerminar, conf.cajaSi), `${etiqueta}: el "Sí, cargar resultado" no queda donde estaba "Terminar partido"`, conf);
  esc.verificar(!conf.habilitadoAlAparecer, `${etiqueta}: el "Sí" aparece deshabilitado un instante (un doble toque no cierra)`);
  if (!rapido) await esc.revisarPantalla(cel, `${etiqueta}-confirmar`);
  return { oraculo: t, confirmar: () => ar.confirmar(cel), nombreA, nombreB, clicks };
}

async function confirmarYVerificar(esc, cel, partida, { torneoId, partidoId, codigo, etiqueta }) {
  await partida.confirmar();
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
  if (v37(esc)) {
    // v37: el código queda (2 días) para que reintentar/volver a entrar respondan "terminado"; la fila
    // queda cerrada por el árbitro y el marcador guardado es el que calculó la base.
    esc.verificar(arb && arb.cierre === 'arbitro' && arb.marcador && arb.marcador.terminado === true, `${etiqueta}: la fila queda cerrada por el árbitro con el marcador final de la base`, arb && { cierre: arb.cierre, marcador: arb.marcador });
    esc.verificar(esc.fake.codigos(torneoId).some((c) => c.codigo === codigo), `${etiqueta}: el código sigue reconocido (terminar es idempotente)`);
  } else {
    esc.verificar(!esc.fake.codigos(torneoId).some((c) => c.codigo === codigo), `${etiqueta}: el código queda dado de baja (${base(esc)})`);
  }
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
    const partida = await jugarPartido(esc, cel, { formato: { tipo: 'rally', a: 15, mejorDe: 1 }, saca: 'A', semilla: 11, etiqueta: 'p1', formatoOrganizacion: { tipo: 'rally', a: 15, mejorDe: 1 } });
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
    const ocultas = await cel.getByRole('button', { name: 'Mejor de 3', exact: true }).count();
    esc.verificar(ocultas === 0 && await cel.getByRole('button', { name: 'Cambiar formato…' }).count() === 1, 'las opciones de formato están escondidas detrás de "Cambiar formato…" (gesto deliberado)');
    const partida = await jugarPartido(esc, cel, { formato: { tipo: 'sideout', a: 11, mejorDe: 3 }, saca: 'A', semilla: 5, etiqueta: 'semi1', tiempo: false, formatoOrganizacion: { tipo: 'sideout', a: 11, mejorDe: 3 } });
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

/** Entra con un código y espera la RESPUESTA de arbitro_entrar (el aviso anterior queda en pantalla). */
async function entrarYEsperar(esc, page, codigo, opciones) {
  const etiqueta = page.context().__etiquetaFake;
  const antes = esc.fake.llamadas('arbitro_entrar', etiqueta);
  await ar.entrar(page, codigo, opciones);
  for (let i = 0; i < 100 && esc.fake.llamadas('arbitro_entrar', etiqueta) === antes; i++) await esperar(50);
  await esperar(150);
  const alerta = page.getByRole('alert');
  return (await alerta.count()) ? alerta.first().innerText().catch(() => null) : null;
}

/** Un código que no existe (con el largo que usa la base). */
function codigoMalo(esc, hoja, i = 0) {
  const largo = v37(esc) ? 6 : 4;
  const usados = new Set([...hoja.filas.map((f) => f.codigo), ...esc.fake.codigos().map((c) => c.codigo)]);
  let n = 3000 + i * 7;
  let c;
  do { c = String(n++).padStart(largo, '9'); } while (usados.has(c));
  return c;
}

async function codigoInvalido(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Códigos' });
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const cel = await esc.contexto('arbitro-1', CELULAR);
  await esc.paso('código inexistente', async () => {
    const antes = esc.fake.intentos().length;
    const msg = await entrarYEsperar(esc, cel, codigoMalo(esc, hoja));
    const esperado = v37(esc) ? 'Código incorrecto. Revisalo o pedilo en la mesa de control.' : 'Código incorrecto o el partido ya terminó.';
    esc.verificar(msg === esperado, `un código que no existe muestra "${esperado}" (${base(esc)})`, msg);
    esc.verificar(esc.fake.intentos().length === antes + 1, 'el intento fallido queda anotado para el freno');
    await esc.revisarPantalla(cel, 'codigo-incorrecto');
  });
  await esc.paso('la caja acepta 4 a 6 números y no manda nada incompleto', async () => {
    const caja = cel.getByLabel('Código del partido');
    await caja.fill('');
    await caja.pressSequentially('12a34567');
    esc.verificar(await caja.inputValue() === '123456', 'letras afuera y máximo 6 dígitos', await caja.inputValue());
    esc.verificar(await caja.getAttribute('placeholder') === 'Código', 'la caja tiene un texto de ejemplo ("Código")');
    esc.verificar(await cel.getByText('Pedí el código en la mesa de control.').isVisible(), 'hay una línea de ayuda');
    for (const corto of ['12', '12345']) {
      await caja.fill(corto);
      const boton = cel.getByRole('button', { name: 'Entrar' });
      esc.verificar(await boton.isEnabled(), `con ${corto.length} dígitos el botón Entrar no aparece roto (habilitado)`);
      const antes = esc.fake.llamadas('arbitro_entrar');
      await boton.click();
      await esperar(300);
      const msg = await cel.getByRole('alert').innerText().catch(() => null);
      esc.verificar(/tiene 6 números/.test(msg || '') && esc.fake.llamadas('arbitro_entrar') === antes, `con ${corto.length} dígitos explica el largo y NO consulta la base (no gasta un intento)`, { msg, llamadas: esc.fake.llamadas('arbitro_entrar') - antes });
    }
  });
  await esc.paso('errores de tipeo en el wifi del club no frenan a los demás; probar números al azar sí se frena', async () => {
    // 10 errores (todos los celulares salen por la misma IP, como en el club)
    for (let i = 0; i < 9; i++) await entrarYEsperar(esc, cel, codigoMalo(esc, hoja, i + 1), { navegar: false });
    const cel2 = await esc.contexto('arbitro-2', CELULAR);
    await ar.entrar(cel2, hoja.filas[1].codigo);
    const entro = await cel2.getByText('¿Quién saca primero?').waitFor({ timeout: 8000 }).then(() => true, () => false);
    const msg2 = entro ? null : await cel2.getByRole('alert').innerText().catch(() => null);
    esc.verificar(entro, 'después de 10 errores en el wifi del club, otro árbitro (mismo wifi) entra igual', `queda frenado: "${msg2}" — ${base(esc)}: el freno es 10 fallos por IP y en el club todos salen por la misma`);
    await esc.revisarPantalla(cel2, 'otro-arbitro-despues-de-10-errores');
    if (!v37(esc)) return;
    // v37: a los 30 fallos en 15 min el origen se frena, y frenado ni el código correcto pasa (no hay oráculo)
    for (let i = 10; i < 30; i++) await entrarYEsperar(esc, cel, codigoMalo(esc, hoja, i + 1), { navegar: false });
    const msg = await entrarYEsperar(esc, cel, hoja.filas[0].codigo, { navegar: false });
    esc.verificar(/Demasiados códigos incorrectos/.test(msg || ''), 'después de 30 errores en 15 minutos, hasta el código correcto queda frenado', msg);
    esc.verificar(esc.fake.intentos().length === 30, 'los pedidos frenados no se anotan (el freno se levanta solo)', esc.fake.intentos().length);
    await esc.revisarPantalla(cel, 'frenado');
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
    const entradas = esc.fake.llamadas('arbitro_entrar', 'arbitro');
    await cel.reload();
    const sigue = await cel.getByRole('button', { name: /^Ganó el que saca/ }).waitFor({ timeout: 10000 }).then(() => true, () => false);
    esc.verificar(sigue && await cel.getByLabel('Código del partido').count() === 0, 'al recargar sigue en el partido sin volver a pedir el código');
    const despues = await ar.leer(cel);
    const t = new ar.Tanteo(formato, 'A'); for (const h of historia) t.rally(h);
    esc.verificar(despues.lados[0].puntos === t.pA && despues.lados[1].puntos === t.pB && despues.canto === t.canto(), 'después de recargar sigue en el mismo tanteo', { antes: antes.canto, despues: despues.canto, esperado: t.canto() });
    await esperar(800);
    esc.verificar(esc.fake.llamadas('arbitro_entrar', 'arbitro') === entradas + 1, 'y le pregunta a la base cómo está el partido (una vez)', esc.fake.llamadas('arbitro_entrar', 'arbitro') - entradas);
    await esc.revisarPantalla(cel, 'despues-de-recargar');
  });
  await esc.paso('recargar con puntos SIN subir (sin señal) apenas vuelve la señal', async () => {
    await esc.red(cel, false);
    for (const h of ['saca', 'saca', 'recibe']) await ar.punto(cel, h);
    historia.push('saca', 'saca', 'recibe');
    await esperar(300);
    const l = await ar.leer(cel);
    esc.verificar(/SIN SEÑAL/.test(l.senal || ''), 'sin red avisa "SIN SEÑAL · lo marcado queda guardado…"', l.texto.slice(0, 200));
    await esc.red(cel, true);
    // recargar justo cuando vuelve la señal, antes del reintento
    await cel.reload();
    await cel.getByRole('button', { name: /^Ganó el que saca/ }).waitFor({ timeout: 10000 });
    const t = new ar.Tanteo(formato, 'A'); for (const h of historia) t.rally(h);
    const d = await ar.leer(cel);
    esc.verificar(d.canto === t.canto() && d.lados[0].puntos === t.pA, 'los puntos marcados sin señal no se pierden al recargar', { pantalla: d.canto, esperado: t.canto() });
    await esperar(6500);
    const arb = esc.fake.partidoArbitrado(id, f.partidoId);
    esc.verificar(arb.jugadas.length === historia.length + 1, 'y se suben solos al volver la señal', { servidor: arb.jugadas.length, telefono: historia.length + 1 });
  });
}

// Recargar con la base inalcanzable (la página carga, Supabase no): sigue con lo del teléfono.
async function recargarSinSenal(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Recarga sin señal' });
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const f = hoja.filas[0];
  const cel = await esc.contexto('arbitro', CELULAR);
  const formato = { tipo: 'rally', a: 15, mejorDe: 1 };
  const historia = [];
  const marcar = async (lista) => { for (const h of lista) { await ar.punto(cel, h); historia.push(h); } };
  await esc.paso('marcar con señal, quedarse sin base, marcar y RECARGAR sin señal', async () => {
    await ar.entrar(cel, f.codigo);
    await ar.empezar(cel, { ...formato, saca: 'A' });
    await marcar(['saca', 'saca', 'recibe']);
    await esperar(1000);
    esc.fake.cortados.add('arbitro'); // la página sigue cargando (Vite) pero Supabase no responde
    await marcar(['saca', 'recibe']);
    await cel.reload();
    const sigue = await cel.getByRole('button', { name: /^Ganó el que saca/ }).waitFor({ timeout: 10000 }).then(() => true, () => false);
    esc.exigir(sigue, 'recargar sin señal deja seguir en el partido (no pide el código ni la red)');
    const t = new ar.Tanteo(formato, 'A'); for (const h of historia) t.rally(h);
    const d = await ar.leer(cel);
    esc.verificar(d.canto === t.canto() && d.lados[0].puntos === t.pA && d.lados[1].puntos === t.pB, 'muestra el tanteo guardado en el teléfono', { pantalla: d.canto, esperado: t.canto() });
    const nombres = d.lados.map((x) => x.nombre);
    esc.verificar((nombres[0] || '').toUpperCase() === f.a.toUpperCase(), 'y con los nombres de las parejas (guardados en el teléfono)', { nombres, hoja: [f.a, f.b] });
    await esperar(1500);
    const l = await ar.leer(cel);
    esc.verificar(/SIN SEÑAL/.test(l.senal || ''), 'avisa SIN SEÑAL bien visible', l.texto.slice(0, 200));
    await esc.revisarPantalla(cel, 'recargado-sin-senal');
    await marcar(['saca', 'saca']);
    const t2 = new ar.Tanteo(formato, 'A'); for (const h of historia) t2.rally(h);
    const d2 = await ar.leer(cel);
    esc.verificar(d2.canto === t2.canto(), 'sigue marcando sin señal después de recargar', { pantalla: d2.canto, esperado: t2.canto() });
    esc.verificar(esc.fake.partidoArbitrado(id, f.partidoId).jugadas.length === 4, 'el servidor sigue en lo último con señal (inicio + 3)');
  });
  await esc.paso('vuelve la señal: se pone al día solo', async () => {
    esc.fake.cortados.delete('arbitro');
    let arb;
    for (let i = 0; i < 40; i++) { await esperar(250); arb = esc.fake.partidoArbitrado(id, f.partidoId); if (arb.jugadas.length === historia.length + 1) break; }
    esc.verificar(arb.jugadas.length === historia.length + 1, 'en menos de 10 s el servidor tiene todo lo marcado', { servidor: arb.jugadas.length, telefono: historia.length + 1 });
    const t = new ar.Tanteo(formato, 'A'); for (const h of historia) t.rally(h);
    esc.verificar(arb.marcador && arb.marcador.canto === t.canto(), 'y el marcador de la TV es el del oráculo', arb.marcador && arb.marcador.canto);
    await esperar(500);
    const l = await ar.leer(cel);
    esc.verificar(!l.senal && !l.alerta, 'se va el aviso de sin señal y no queda ningún aviso raro', { senal: l.senal, alerta: l.alerta });
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
    esc.verificar(/SIN SEÑAL/.test(l.senal || ''), 'avisa "SIN SEÑAL" arriba y deja seguir marcando', l.texto.slice(0, 200));
    esc.verificar(l.lados[0].puntos === t.pA, 'el tanteo local sigue al día sin red');
    await esc.revisarPantalla(cel, 'sin-senal');
    const g2 = await cel.evaluate((c) => JSON.parse(localStorage.getItem(`volea_arbitro_${c}`) || 'null'), f.codigo);
    esc.verificar(g2 && g2.cola && g2.cola.jugadas.length === 10 && g2.cola.subido.length === 4, 'la cola offline quedó guardada en el teléfono (10 marcadas, 4 confirmadas por la base)', g2 && g2.cola && { jugadas: g2.cola.jugadas.length, subido: g2.cola.subido.length });
    const arb = esc.fake.partidoArbitrado(id, f.partidoId);
    esc.verificar(arb.jugadas.length === 4, 'el servidor quedó en lo último con señal (inicio + 3)', arb.jugadas.length);
  });
  await esc.paso('vuelve la señal: se sube solo y el marcador público se pone al día', async () => {
    await esc.red(cel, true);
    await esperar(6500);
    const arb = esc.fake.partidoArbitrado(id, f.partidoId);
    esc.verificar(arb.jugadas.length === 10, 'al volver la señal la cola se sube sola (≤ 5 s)', arb.jugadas.length);
    const l = await ar.leer(cel);
    esc.verificar(!l.senal, 'desaparece el aviso de "SIN SEÑAL"');
    const vivo = await tv.getByText(`${t.pA}-${t.pB}`).first().waitFor({ timeout: 25000 }).then(() => true, () => false);
    esc.verificar(vivo, `la página pública muestra el marcador al día (${t.pA}-${t.pB})`);
    await esc.revisarPantalla(tv, 'publico-al-dia');
  });
  await esc.paso('terminar sin señal: se carga solo cuando vuelve', async () => {
    while (!t.terminado) { await ar.punto(cel, 'saca'); t.rally('saca'); }
    await esperar(800);
    await esc.red(cel, false);
    await ar.terminar(cel);
    await ar.confirmar(cel);
    const aviso = await cel.getByText('Sin señal: el resultado se carga solo apenas vuelva.').waitFor({ timeout: 15000 }).then(() => true, () => false);
    esc.verificar(aviso, 'confirmar sin señal avisa que el resultado se carga solo apenas vuelva la señal');
    await esc.revisarPantalla(cel, 'terminar-sin-senal');
    await esc.red(cel, true);
    // sin tocar nada
    const ok = await cel.getByText('Resultado cargado ✓').waitFor({ timeout: 12000 }).then(() => true, () => false);
    esc.verificar(ok, 'al volver la señal el resultado se carga solo (sin volver a tocar)');
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
    await cel2.getByRole('button', { name: /^Ganó el que saca/ }).waitFor({ timeout: 10000 });
    const l2 = await ar.leer(cel2);
    esc.verificar(l2.canto === '3-0', 'el segundo celular entra en el mismo tanteo', l2.canto);
    // el primero sigue marcando; el segundo marca algo viejo → aviso entendible y queda al día
    await ar.punto(cel, 'saca');
    await esperar(600);
    await ar.punto(cel2, 'recibe');
    const aviso = await cel2.getByRole('alert').innerText({ timeout: 5000 }).catch(() => null);
    esc.verificar(/también se marcó desde otro teléfono/.test(aviso || '') && /1 jugada de este teléfono/.test(aviso || '') && !/desfasad/i.test(aviso || ''),
      'el celular que quedó atrás avisa en criollo cuántas jugadas suyas quedaron afuera', aviso);
    const l2b = await ar.leer(cel2);
    esc.verificar(l2b.canto === '4-0', 'el segundo celular queda en 4-0 (lo del servidor)', l2b.canto);
    esc.verificar(await cel2.getByRole('button', { name: 'Usar lo de este teléfono' }).count() === 1, 'y ofrece recuperar lo suyo con un toque');
    await esc.revisarPantalla(cel2, 'otro-dispositivo');
    await cel2.getByRole('button', { name: 'Entendido' }).click();
  });
  await esc.paso('tocar el "Sí, cargar resultado" dos veces seguidas', async () => {
    while (!(await cel.getByRole('button', { name: 'Terminar partido' }).count())) await ar.punto(cel, 'saca');
    await esperar(800);
    await ar.terminar(cel);
    const si = cel.getByRole('button', { name: 'Sí, cargar resultado' });
    for (let i = 0; i < 30 && !(await si.isEnabled()); i++) await esperar(100);
    await si.dblclick();
    const ok = await cel.getByText('Resultado cargado ✓').waitFor({ timeout: 10000 }).then(() => true, () => false);
    esc.verificar(ok, 'con doble toque igual termina en "Resultado cargado ✓"');
    const llamadas = esc.fake.llamadas('arbitro_terminar', 'arbitro');
    esc.verificar(llamadas === 1, `el doble toque llama a arbitro_terminar una sola vez (${llamadas})`);
    const tt = esc.fake.torneo(id);
    const p = tt.partidosGrupo.find((x) => x.id === f.partidoId);
    esc.verificar(p.puntosA === 15 && p.puntosB === 0, 'el cuadro tiene 15-0 una sola vez', [p.puntosA, p.puntosB]);
  });
  await esc.paso('el otro celular sigue marcando después de que terminó', async () => {
    await esperar(300);
    const intentos = esc.fake.intentos().length;
    await ar.punto(cel2, 'saca');
    await esperar(1500);
    const l = await ar.leer(cel2);
    if (v37(esc)) {
      esc.verificar(/Resultado cargado ✓/.test(l.texto) && /15-0/.test(l.texto), 'el segundo celular se entera de que el partido terminó y ve 15-0', l.texto.slice(0, 300));
    } else {
      esc.verificar(/ya no sirve para marcar/.test(l.alerta || ''), `el segundo celular avisa que el código ya no sirve (${base(esc)}: terminar borra el código)`, l.texto.slice(0, 300));
    }
    await esc.revisarPantalla(cel2, 'suplente-despues-de-terminar');
    if (!v37(esc)) {
      // la sesión con el código muerto no puede quedar atrapada: se sale desde el aviso
      const salir = cel2.getByRole('button', { name: 'Salir / otro código' });
      esc.verificar(await salir.count() === 1, 'con el código muerto se puede salir desde el aviso');
      if (await salir.count()) await salir.click();
    }
    const msg = await entrarYEsperar(esc, cel2, f.codigo);
    if (v37(esc)) {
      const pantalla = await cel2.locator('main').last().innerText();
      esc.verificar(/Resultado cargado ✓/.test(pantalla) && /15-0/.test(pantalla), 'volver a entrar con el código usado muestra el resultado ya cargado (15-0)', pantalla.slice(0, 200));
      esc.verificar(esc.fake.intentos().length === intentos, 'nada de esto cuenta como intento fallido', esc.fake.intentos().length - intentos);
    } else {
      esc.verificar(msg === 'Código incorrecto o el partido ya terminó.', `entrar de nuevo con el código usado: "…el partido ya terminó" (${base(esc)})`, msg);
    }
  });
}

// Si la respuesta de Terminar se pierde, el árbitro reintenta y se entera de que entró.
async function terminarRespuestaPerdida(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Respuesta perdida' });
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const f = hoja.filas[0];
  const cel = await esc.contexto('arbitro', CELULAR);
  await esc.paso('el pedido de Terminar llega a la base pero la respuesta se pierde', async () => {
    await ar.entrar(cel, f.codigo);
    await ar.empezar(cel, { tipo: 'rally', a: 15, mejorDe: 1, saca: 'A' });
    for (let i = 0; i < 15; i++) await ar.punto(cel, 'saca');
    await esperar(800);
    esc.fake.perderRespuesta = 'arbitro_terminar';
    await ar.terminar(cel);
    await ar.confirmar(cel);
    const ok = await cel.getByText('Resultado cargado ✓').waitFor({ timeout: 20000 }).then(() => true, () => false);
    esc.verificar(ok, 'el reintento automático termina en "Resultado cargado ✓"', (await ar.leer(cel)).texto.slice(0, 200));
    const p = esc.fake.torneo(id).partidosGrupo.find((x) => x.id === f.partidoId);
    esc.verificar(p.puntosA === 15 && p.puntosB === 0, 'el resultado quedó una sola vez en el cuadro', [p.puntosA, p.puntosB]);
    esc.verificar(esc.fake.intentos().length === 0, 'el reintento no cuenta como intento fallido');
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
    await ar.terminar(cel);
    await ar.confirmar(cel);
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

// Dos teléfonos con el mismo código marcan cosas distintas: aviso entendible y "Usar lo de este teléfono".
async function dosTelefonos(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Dos teléfonos' });
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const f = hoja.filas[0];
  const a = await esc.contexto('arbitro', CELULAR);
  const b = await esc.contexto('arbitro-2', CELULAR);
  const formato = { tipo: 'rally', a: 15, mejorDe: 1 };
  const servidor = () => esc.fake.partidoArbitrado(id, f.partidoId);
  await esc.paso('A marca 3, B entra; A marca 2 más; B marca uno distinto', async () => {
    await ar.entrar(a, f.codigo);
    await ar.empezar(a, { ...formato, saca: 'A' });
    for (const h of ['saca', 'saca', 'saca']) await ar.punto(a, h);
    await esperar(700);
    await ar.entrar(b, f.codigo);
    await b.getByRole('button', { name: /^Ganó el que saca/ }).waitFor({ timeout: 10000 });
    for (const h of ['saca', 'recibe']) await ar.punto(a, h); // A: 4-1, saca B
    await esperar(700);
    await ar.punto(b, 'recibe'); // B (en 3-0) marca 3-1
    const aviso = await b.getByRole('alert').innerText({ timeout: 5000 }).catch(() => null);
    esc.verificar(/también se marcó desde otro teléfono/.test(aviso || '') && /1 jugada de este teléfono/.test(aviso || ''), 'B avisa en criollo que se dejó de lado 1 jugada suya', aviso);
    esc.verificar(!/desfasad|error|null|undefined/i.test(aviso || ''), 'sin textos técnicos', aviso);
    const lb = await ar.leer(b);
    esc.verificar(lb.lados[0].puntos === 4 && lb.lados[1].puntos === 1, 'B queda en lo del servidor (4-1)', lb.canto);
    await esc.revisarPantalla(b, 'aviso-dos-telefonos');
  });
  await esc.paso('B toca "Usar lo de este teléfono": manda lo suyo y A se entera', async () => {
    await b.getByRole('button', { name: 'Usar lo de este teléfono' }).click();
    await esperar(1500);
    const lb = await ar.leer(b);
    esc.verificar(lb.lados[0].puntos === 3 && lb.lados[1].puntos === 1 && !lb.alerta, 'B vuelve a su 3-1 sin avisos', { canto: lb.canto, alerta: lb.alerta });
    esc.verificar(servidor().jugadas.length === 5 && servidor().marcador.puntos.a === 3 && servidor().marcador.puntos.b === 1, 'la base (y la TV) quedan con lo de B: 3-1', servidor().marcador);
    await ar.punto(a, 'saca'); // A todavía cree 4-1
    const aviso = await a.getByRole('alert').innerText({ timeout: 5000 }).catch(() => null);
    esc.verificar(/también se marcó desde otro teléfono/.test(aviso || '') && /3 jugadas de este teléfono/.test(aviso || ''), 'A avisa que se dejaron de lado 3 jugadas suyas', aviso);
    const la = await ar.leer(a);
    esc.verificar(la.lados[0].puntos === 3 && la.lados[1].puntos === 1, 'A queda igual que la base (3-1)', la.canto);
    await esc.revisarPantalla(a, 'aviso-a-recibe');
  });
}

// Doble toque en "Terminar partido": no puede cerrar el partido.
async function dobleToqueTerminar(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Doble toque' });
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const f = hoja.filas[0];
  const cel = await esc.contexto('arbitro', CELULAR);
  await esc.paso('doble toque en "Terminar partido"', async () => {
    await ar.entrar(cel, f.codigo);
    await ar.empezar(cel, { tipo: 'rally', a: 15, mejorDe: 1, saca: 'A' });
    for (let i = 0; i < 14; i++) await ar.punto(cel, 'saca');
    await ar.punto(cel, 'recibe');
    await ar.punto(cel, 'recibe'); // 15-1
    await esperar(600);
    await cel.getByRole('button', { name: 'Terminar partido' }).dblclick();
    await esperar(1500);
    esc.verificar(esc.fake.llamadas('arbitro_terminar') === 0, 'no se llamó a arbitro_terminar');
    esc.verificar(await cel.getByText('Resultado cargado ✓').count() === 0, 'el partido NO se cerró');
    const p = esc.fake.torneo(id).partidosGrupo.find((x) => x.id === f.partidoId);
    esc.verificar(p.puntosA === null, 'el cuadro sigue sin resultado', [p.puntosA, p.puntosB]);
    await esc.revisarPantalla(cel, 'despues-de-doble-toque');
  });
  await esc.paso('triple toque rápido sobre la confirmación tampoco', async () => {
    if (await cel.getByRole('button', { name: 'No, seguir marcando' }).count()) await cel.getByRole('button', { name: 'No, seguir marcando' }).click();
    await cel.getByRole('button', { name: 'Terminar partido' }).click();
    await cel.getByRole('button', { name: 'Sí, cargar resultado' }).click({ force: true, clickCount: 3, timeout: 2000 }).catch(() => {});
    await esperar(400);
    esc.verificar(esc.fake.llamadas('arbitro_terminar') === 0, 'apenas aparece, el "Sí" no responde (evita el toque de más)');
    await cel.getByRole('button', { name: 'No, seguir marcando' }).click();
    await cel.getByRole('button', { name: '↶ Deshacer último punto' }).click();
    const l = await ar.leer(cel);
    esc.verificar(!/Terminar partido/.test(l.texto) && l.lados[0].puntos === 14, '"No, seguir marcando" y Deshacer reabren el partido (14-1)', l.canto);
  });
  await esc.paso('terminar como corresponde', async () => {
    await ar.punto(cel, 'recibe');
    await ar.terminar(cel);
    await ar.confirmar(cel);
    const ok = await cel.getByText('Resultado cargado ✓').waitFor({ timeout: 10000 }).then(() => true, () => false);
    const p = esc.fake.torneo(id).partidosGrupo.find((x) => x.id === f.partidoId);
    esc.verificar(ok && p.puntosA === 15 && p.puntosB === 1 && esc.fake.llamadas('arbitro_terminar') === 1, 'con la confirmación, entra 15-1 una sola vez', [p.puntosA, p.puntosB]);
  });
}

// La mesa de control carga el resultado a mano mientras el árbitro marca.
async function cargadoEnMesa(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Mesa' });
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const f = hoja.filas[0];
  const cel = await esc.contexto('arbitro', CELULAR);
  const pub = await esc.contexto('publico-celular', CELULAR);
  await esc.paso('el árbitro marca y la mesa carga 15-9 a mano', async () => {
    await ar.entrar(cel, f.codigo);
    await ar.empezar(cel, { tipo: 'rally', a: 15, mejorDe: 1, saca: 'A' });
    for (const h of ['saca', 'saca', 'recibe', 'saca']) await ar.punto(cel, h);
    await esperar(800);
    esc.fake.cargarEnMesa(id, f.partidoId, 15, 9);
    await ar.punto(cel, 'saca');
    const fin = await cel.getByText('Resultado cargado en la mesa').waitFor({ timeout: 8000 }).then(() => true, () => false);
    esc.verificar(fin, 'en el próximo toque el árbitro ve "Resultado cargado en la mesa"', (await cel.locator('main').last().innerText()).slice(0, 200));
    const txt = await cel.locator('main').last().innerText();
    esc.verificar(/15-9/.test(txt) && /No hace falta hacer nada más/.test(txt), 'con el resultado de la mesa y qué hacer', txt.slice(0, 300));
    await esc.revisarPantalla(cel, 'cargado-en-mesa');
    const arb = esc.fake.partidoArbitrado(id, f.partidoId);
    esc.verificar(arb.estado === 'terminado', `la fila del árbitro se cierra (se acaba el EN VIVO) — ${base(esc)}`, arb.estado);
    const p = esc.fake.torneo(id).partidosGrupo.find((x) => x.id === f.partidoId);
    esc.verificar(p.puntosA === 15 && p.puntosB === 9, 'el resultado de la mesa no se pisa', [p.puntosA, p.puntosB]);
  });
  await esc.paso('la web pública no queda "EN VIVO" para siempre', async () => {
    await pub.goto(`${BASE}/torneos/${id}`);
    await esperar(3000);
    esc.verificar(await pub.getByText('EN VIVO', { exact: true }).count() === 0, 'no aparece EN VIVO para un partido ya cargado');
  });
}

// Parejas cuyo nombre no se puede separar en dos jugadores ("LOS TIGRES") o con "e" ("João e Maria").
async function parejaSinSeparar(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Nombres' });
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const f = hoja.filas[0];
  await esc.paso('la mesa renombra las dos parejas del partido 1', async () => {
    const fila = esc.fake.filas('rk_torneos').find((x) => x.id === id);
    const data = JSON.parse(JSON.stringify(fila.data));
    const p = data.partidosGrupo.find((x) => x.id === f.partidoId);
    data.parejas.find((x) => x.id === p.aId).nombre = 'LOS TIGRES DEL NORTE';
    data.parejas.find((x) => x.id === p.bId).nombre = 'João Silva e Maria Souza';
    fila.data = data;
  });
  const cel = await esc.contexto('arbitro', CELULAR);
  await esc.paso('inicio y saque con nombres que no se separan', async () => {
    await ar.entrar(cel, f.codigo);
    await cel.getByText('¿Quién saca primero?').waitFor({ timeout: 10000 });
    const txt = await cel.locator('main').last().innerText();
    esc.verificar(/Jugador 1/.test(txt) && /Jugador 2/.test(txt), 'para LOS TIGRES ofrece "Jugador 1 / Jugador 2" a la derecha', txt.slice(0, 400));
    esc.verificar(/João Silva/.test(txt) && /Maria Souza/.test(txt), '"João Silva e Maria Souza" se separa en dos jugadores', txt.slice(0, 400));
    await esc.revisarPantalla(cel, 'inicio-nombres-raros');
    await ar.empezar(cel, { tipo: 'sideout', a: 11, mejorDe: 1, saca: 'A' });
    let l = await ar.leer(cel);
    esc.verificar(l.lados[0].quienSaca === 'Saca Jugador 1', 'saca LOS TIGRES: "Saca Jugador 1" (nunca "Saca " vacío)', l.lados.map((x) => x.quienSaca));
    const botones = await cel.getByRole('button', { name: /^Ganó el que/ }).allInnerTexts();
    esc.verificar(botones.some((b) => /LOS TIGRES DEL NORTE/.test(b)) && botones.some((b) => /João Silva e Maria Souza/i.test(b)), 'los botones dicen el nombre de cada equipo', botones);
    await ar.punto(cel, 'recibe'); // servidor 2 de LOS TIGRES pierde → side out
    l = await ar.leer(cel);
    esc.verificar(l.lados[1].quienSaca === 'Saca João Silva' || l.lados[1].quienSaca === 'Saca Maria Souza', 'después del side out saca un jugador con nombre', l.lados.map((x) => x.quienSaca));
    await esc.revisarPantalla(cel, 'marcando-nombres-raros');
  });
}

// Las pantallas del árbitro a 390x844: capturas, desbordes y tamaños de toque medidos de verdad.
async function pantallas(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  const { id } = await prepararTorneo(esc, admin, { nombre: 'Sudamericano 2026 · Pantallas del árbitro con nombre largo' });
  const hoja = await hojaCodigos(esc, admin, id, 'grupos');
  const f = hoja.filas[0];
  const cel = await esc.contexto('arbitro', CELULAR);
  const sinDesborde = async (nombre) => {
    const r = await esc.revisarPantalla(cel, nombre);
    esc.verificar(r.desbordeDoc <= 1, `${nombre}: sin scroll horizontal a 390 px`, r.salidos);
    esc.verificar(r.cortados.length === 0, `${nombre}: ningún texto cortado`, r.cortados);
  };
  const tamano = async (loc, etiqueta) => {
    const c = await loc.boundingBox();
    esc.verificar(c && c.height >= 44 && c.width >= 44, `${etiqueta}: área de toque ≥ 44 px`, c);
  };
  await esc.paso('código', async () => {
    await cel.goto(`${BASE}/arbitro`);
    await cel.getByLabel('Código del partido').waitFor();
    await sinDesborde('pantalla-codigo');
    await tamano(cel.getByRole('button', { name: 'Entrar' }), 'Entrar');
    await entrarYEsperar(esc, cel, codigoMalo(esc, hoja), { navegar: false });
    await sinDesborde('pantalla-codigo-error');
  });
  await esc.paso('inicio', async () => {
    await ar.entrar(cel, f.codigo, { navegar: false });
    await cel.getByText('¿Quién saca primero?').waitFor();
    await sinDesborde('pantalla-inicio');
    await cel.getByRole('button', { name: 'Cambiar formato…' }).click();
    await sinDesborde('pantalla-inicio-cambiar-formato');
    await cel.getByRole('button', { name: 'Volver al de la organización' }).click();
  });
  await esc.paso('marcando', async () => {
    await ar.empezar(cel, { tipo: 'sideout', a: 11, mejorDe: 1, saca: 'A' });
    for (const h of ['saca', 'recibe', 'saca']) await ar.punto(cel, h);
    await sinDesborde('pantalla-marcando');
    await tamano(cel.getByRole('button', { name: '↶ Deshacer' }), 'Deshacer');
    for (const b of await cel.getByRole('button', { name: /^Tiempo / }).all()) await tamano(b, 'Tiempo');
    const ganar = await cel.getByRole('button', { name: /^Ganó el que saca/ }).boundingBox();
    esc.verificar(ganar && ganar.height >= 80, 'los botones de punto son grandes (≥ 80 px de alto)', ganar);
    const vivo = (await ar.leer(cel)).vivo;
    esc.verificar(/Saca/.test(vivo || '') && /Canto/.test(vivo || ''), 'el marcador está en una región aria-live con texto para lector de pantalla', vivo);
    await cel.getByRole('button', { name: /^Tiempo / }).first().click();
    await sinDesborde('pantalla-confirmar-tiempo');
    await cel.getByRole('button', { name: 'No', exact: true }).click();
  });
  await esc.paso('sin señal', async () => {
    await esc.red(cel, false);
    await ar.punto(cel, 'saca');
    await esperar(400);
    await sinDesborde('pantalla-sin-senal');
    const banner = cel.getByRole('status').filter({ hasText: 'SIN SEÑAL' });
    const c = await banner.boundingBox();
    esc.verificar(c && c.y < 60 && c.width >= 380, 'el aviso SIN SEÑAL está arriba de todo y de lado a lado', c);
    await esc.red(cel, true);
    await esperar(5000);
  });
  await esc.paso('confirmar y terminado', async () => {
    while (!(await cel.getByRole('button', { name: 'Terminar partido' }).count())) await ar.punto(cel, 'saca');
    await sinDesborde('pantalla-partido-terminado');
    await ar.terminar(cel);
    await sinDesborde('pantalla-confirmar');
    await ar.confirmar(cel);
    await cel.getByText('Resultado cargado ✓').waitFor({ timeout: 10000 });
    await sinDesborde('pantalla-resultado-cargado');
  });
}

const ESCENARIOS = {
  'arbitro-flujo-completo': flujoCompleto,
  'arbitro-codigo-invalido': codigoInvalido,
  'arbitro-recargar': recargarAMitad,
  'arbitro-recargar-sin-senal': recargarSinSenal,
  'arbitro-sin-red': cortarRed,
  'arbitro-red-lenta': redLenta,
  'arbitro-terminar-dos-veces': terminarDosVeces,
  'arbitro-terminar-respuesta-perdida': terminarRespuestaPerdida,
  'arbitro-dos-telefonos': dosTelefonos,
  'arbitro-doble-toque-terminar': dobleToqueTerminar,
  'arbitro-cargado-en-mesa': cargadoEnMesa,
  'arbitro-pareja-sin-separar': parejaSinSeparar,
  'arbitro-pantallas': pantallas,
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
    const sinRivales = cel.getByText('Todavía no se sabe quién juega');
    const sinCuadro = cel.getByText('No se pudo leer el cuadro del torneo');
    await sinRivales.or(sinCuadro).first().waitFor({ timeout: 8000 }).catch(() => {});
    const frenado = await cel.getByRole('button', { name: 'Empezar partido' }).count() === 0 && (await sinRivales.count() + await sinCuadro.count()) > 0;
    esc.verificar(frenado, 'la final sin rivales definidos NO se puede empezar', (await cel.locator('main').last().innerText()).slice(0, 200));
    if (v37(esc)) esc.verificar(await sinRivales.count() === 1, 'y dice por qué: "Todavía no se sabe quién juega" (la base lo sabe aunque el torneo esté oculto)');
    await esc.revisarPantalla(cel, 'final-oculta-inicio');
    if (frenado) return;
    await ar.empezar(cel, { tipo: 'sideout', a: 11, mejorDe: 3, saca: 'A' });
    while (!(await cel.getByRole('button', { name: 'Terminar partido' }).count())) await ar.punto(cel, 'saca');
    await ar.terminar(cel);
    await ar.confirmar(cel);
    await esperar(1500);
    await esc.revisarPantalla(cel, 'final-oculta-terminada');
    const nube = esc.fake.torneo(id);
    const fin = nube.partidosLlave.find((p) => p.id === final.id);
    esc.verificar(fin.puntosA === null, 'la base NO acepta un resultado para la final con las semis sin jugar', { finalEnLaBase: [fin.puntosA, fin.puntosB], semis: nube.partidosLlave.filter((p) => p.ronda === 1).map((p) => [p.puntosA, p.puntosB]) });
  });
}
ESCENARIOS['arbitro-final-sin-rivales-oculto'] = finalSinDefinirOculto;
