// Dos organizadores con el gestor abierto en dos tablets (caso del One Point Challenge): cargan a
// la vez resultados DISTINTOS de la misma llave. Antes el segundo push (upsert del torneo entero)
// borraba lo del primero sin aviso. Al final la base tiene todos y ninguno ve conflicto.
const { ESCRITORIO } = require('../lib/harness.cjs');
const g = require('../lib/gestor.cjs');
const o = require('../lib/oraculo.cjs');
const { esperarEstado, cargarGrupos, resolver } = require('./gestor.cjs');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function cargarCruce(page, t, a, b, pa, pb) {
  const nombre = (pid) => t.parejas.find((p) => p.id === pid).nombre;
  const caja = page.locator('.partido-llave')
    .filter({ has: page.getByLabel(`Puntos de ${nombre(a)}`, { exact: true }) })
    .filter({ has: page.getByLabel(`Puntos de ${nombre(b)}`, { exact: true }) });
  await caja.first().getByLabel(`Puntos de ${nombre(a)}`, { exact: true }).fill(String(pa));
  const cb = caja.first().getByLabel(`Puntos de ${nombre(b)}`, { exact: true });
  await cb.fill(String(pb));
  await cb.press('Enter');
}

async function esperarNube(esc, id, cond, timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    const t = esc.fake.torneo(id);
    if (t && cond(t)) return t;
    if (Date.now() - t0 > timeout) return t;
    await esperar(200);
  }
}

async function sinConflicto(page) {
  const banner = await page.getByRole('button', { name: 'Mi versión' }).count();
  const pildora = await page.getByRole('button', { name: /Refrescar desde el server/ }).innerText();
  return { banner, pildora, ok: banner === 0 && !/elegí versión/.test(pildora) };
}

async function dosTabletsMismaLlave(esc) {
  const A = await esc.contexto('tablet-a', ESCRITORIO);
  const nombres = o.parejasDePrueba(12, 9);
  const nombreTorneo = 'One Point Challenge · Dos tablets';
  let id; let fuerza;

  await esc.paso('tablet A: torneo de 12 parejas, 4 grupos, cuartos cruzados', async () => {
    await g.login(A);
    id = await g.crearTorneo(A, { nombre: nombreTorneo });
    await g.cargarParejas(A, nombres);
    const t = await esperarEstado(A, id, (x) => x.parejas.length === 12);
    const porId = new Map(t.parejas.map((p) => [p.id, nombres.indexOf(p.nombre)]));
    fuerza = (pid) => porId.get(pid);
    await g.irAGrupos(A);
    await g.elegirCantidadGrupos(A, 4);
    await g.sortear(A);
    await esperarEstado(A, id, (x) => x.grupos.length === 4 && x.grupos.reduce((s, gr) => s + gr.parejaIds.length, 0) === 12);
    await g.elegirFormatoEnAjustes(A, 'Cuartos cruzados');
    await g.cerrarAjustes(A);
    await g.confirmarGrupos(A);
    await cargarGrupos(esc, A, id, fuerza);
    await A.getByRole('button', { name: 'Armar llave' }).last().click();
    await A.getByText('Así sale la llave').waitFor();
    await A.getByRole('button', { name: 'Armar llave' }).last().click();
    await A.getByRole('heading', { name: 'Llave', exact: true }).waitFor();
    await g.esperarSincronizado(A);
    esc.exigir((esc.fake.torneo(id)?.partidosLlave || []).length >= 7, 'la llave armada está en la base');
  });

  const B = await esc.contexto('tablet-b', ESCRITORIO);
  await esc.paso('tablet B: el otro organizador abre el mismo torneo', async () => {
    await g.login(B);
    await g.abrirTorneo(B, nombreTorneo);
    await B.getByRole('heading', { name: 'Llave', exact: true }).waitFor();
    await g.esperarSincronizado(B);
  });

  const t0 = await g.torneoLocal(A, id);
  const cuartos = t0.partidosLlave.filter((p) => p.ronda === 1).sort((x, y) => x.posicion - y.posicion);
  esc.exigir(cuartos.length === 4, 'la llave tiene 4 cuartos', cuartos.length);
  // rivales y resultado esperado (gana la más fuerte) de un cruce, según el cuadro `llave`
  const cruce = (p, llave) => {
    const pa = resolver(p.a, llave); const pb = resolver(p.b, llave);
    const res = pa && pb ? o.resultado(fuerza(pa), fuerza(pb)) : null;
    return { id: p.id, pa, pb, puntosA: res && res.a, puntosB: res && res.b };
  };
  const cargar = (page, t, c) => cargarCruce(page, t, c.pa, c.pb, c.puntosA, c.puntosB);

  await esc.paso('las dos tablets cargan cuartos distintos AL MISMO TIEMPO (A: 1 y 2; B: 3 y 4)', async () => {
    const [q1, q2, q3, q4] = cuartos.map((c) => cruce(c, t0.partidosLlave));
    await Promise.all([cargar(A, t0, q1), cargar(B, t0, q3)]);
    await Promise.all([cargar(A, t0, q2), cargar(B, t0, q4)]);
    const nube = await esperarNube(esc, id, (x) => cuartos.every((c) => x.partidosLlave.find((p) => p.id === c.id).puntosA !== null));
    for (const [i, q] of [q1, q2, q3, q4].entries()) {
      const p = nube.partidosLlave.find((x) => x.id === q.id);
      esc.verificar(p.puntosA === q.puntosA && p.puntosB === q.puntosB, `cuarto ${i + 1} (${i < 2 ? 'tablet A' : 'tablet B'}): en la base está el resultado que se tipeó`, { base: [p.puntosA, p.puntosB], tipeado: [q.puntosA, q.puntosB] });
    }
  });

  await esc.paso('cada tablet se entera sola de lo que cargó la otra, sin conflicto', async () => {
    await g.esperarSincronizado(A).catch(() => {});
    await g.esperarSincronizado(B).catch(() => {});
    const lleno = (x) => cuartos.every((c) => x.partidosLlave.find((p) => p.id === c.id).puntosA !== null);
    const ta = await esperarEstado(A, id, lleno, 25000);
    const tb = await esperarEstado(B, id, lleno, 25000);
    esc.verificar(lleno(ta), 'la tablet A ve los cuartos que cargó B (sin tocar la píldora)');
    esc.verificar(lleno(tb), 'la tablet B ve los cuartos que cargó A (sin tocar la píldora)');
    const ca = await sinConflicto(A); const cb = await sinConflicto(B);
    esc.verificar(ca.ok, 'la tablet A no ve conflicto', ca);
    esc.verificar(cb.ok, 'la tablet B no ve conflicto', cb);
    await esc.revisarPantalla(A, 'tablet-a-cuartos');
    await esc.revisarPantalla(B, 'tablet-b-cuartos');
  });

  await esc.paso('semis a la vez (A la 1, B la 2) y la final desde B', async () => {
    const t1 = await g.torneoLocal(A, id);
    const semis = t1.partidosLlave.filter((p) => p.ronda === 2).sort((x, y) => x.posicion - y.posicion);
    esc.exigir(semis.length === 2, 'hay 2 semis', semis.length);
    const [s1, s2] = semis.map((p) => cruce(p, t1.partidosLlave));
    esc.exigir(s1.pa && s1.pb && s2.pa && s2.pb, 'las semis tienen rivales definidos');
    // los dos resultados se tipean desde la MISMA base (ninguna tablet vio todavía el otro)
    await Promise.all([cargar(A, t1, s1), cargar(B, t1, s2)]);
    const nube = await esperarNube(esc, id, (x) => semis.every((s) => x.partidosLlave.find((p) => p.id === s.id).puntosA !== null));
    esc.verificar(semis.every((s) => nube.partidosLlave.find((p) => p.id === s.id).puntosA !== null), 'la base tiene las dos semis');
    // la final la carga B apenas ve la semi de A
    const tb = await esperarEstado(B, id, (x) => semis.every((s) => x.partidosLlave.find((p) => p.id === s.id).puntosA !== null), 25000);
    const fin = cruce(tb.partidosLlave.find((p) => p.ronda === 3 && !p.esTercerPuesto), tb.partidosLlave);
    esc.exigir(fin.pa && fin.pb, 'la tablet B tiene la final definida');
    await cargar(B, tb, fin);
    const nube2 = await esperarNube(esc, id, (x) => x.partidosLlave.find((p) => p.id === fin.id).puntosA !== null);
    esc.verificar(nube2.partidosLlave.find((p) => p.id === fin.id).puntosA === fin.puntosA, 'la final de B llegó a la base');
  });

  await esc.paso('al final: base, tablet A y tablet B tienen exactamente lo mismo, y nadie vio conflicto', async () => {
    const lleno = (x) => x.partidosLlave.every((p) => p.puntosA !== null);
    const ta = await esperarEstado(A, id, lleno, 25000);
    const tb = await esperarEstado(B, id, lleno, 25000);
    await g.esperarSincronizado(A).catch(() => {});
    await g.esperarSincronizado(B).catch(() => {});
    const nube = esc.fake.torneo(id);
    const resumen = (x) => JSON.stringify(x.partidosLlave.map((p) => [p.id, p.puntosA, p.puntosB]));
    esc.verificar(lleno(nube), 'la base tiene la llave completa', resumen(nube));
    esc.verificar(resumen(ta) === resumen(nube), 'la tablet A tiene lo mismo que la base', { a: resumen(ta), base: resumen(nube) });
    esc.verificar(resumen(tb) === resumen(nube), 'la tablet B tiene lo mismo que la base', { b: resumen(tb), base: resumen(nube) });
    const ca = await sinConflicto(A); const cb = await sinConflicto(B);
    esc.verificar(ca.ok && cb.ok, 'ninguna de las dos tablets ve conflicto', { ca, cb });
    await esc.revisarPantalla(A, 'tablet-a-final');
    await esc.revisarPantalla(B, 'tablet-b-final');
  });
}

// Conflicto DE VERDAD: las dos tablets cargan el MISMO partido con resultados distintos. Una gana
// la escritura; la otra no pisa: ve un aviso que nombra el partido y los dos resultados, elige
// "Mi versión" y la base queda con lo suyo (y la primera tablet se entera sola, sin conflicto).
async function dosTabletsMismoPartido(esc) {
  const A = await esc.contexto('tablet-a', ESCRITORIO);
  const nombres = o.parejasDePrueba(4, 5);
  const nombreTorneo = 'One Point Challenge · Mismo partido';
  let id;
  await esc.paso('tablet A: torneo de 4 parejas en un grupo', async () => {
    await g.login(A);
    id = await g.crearTorneo(A, { nombre: nombreTorneo });
    await g.cargarParejas(A, nombres);
    await esperarEstado(A, id, (x) => x.parejas.length === 4);
    await g.irAGrupos(A);
    await g.sortear(A);
    await esperarEstado(A, id, (x) => x.grupos.length === 1 && x.grupos[0].parejaIds.length === 4);
    await g.confirmarGrupos(A);
    await g.esperarSincronizado(A);
  });
  const B = await esc.contexto('tablet-b', ESCRITORIO);
  await esc.paso('tablet B abre el mismo torneo', async () => {
    await g.login(B);
    await g.abrirTorneo(B, nombreTorneo);
    await B.getByText(/de \d+ jugados/).waitFor();
    await g.esperarSincronizado(B);
  });
  const t = await g.torneoLocal(A, id);
  const p = t.partidosGrupo.find((x) => x.ronda === 1);
  const nombre = (pid) => t.parejas.find((x) => x.id === pid).nombre;
  let perdedora; let ganadora; let resPerdedora;
  await esc.paso('las dos cargan el MISMO partido con resultados distintos a la vez', async () => {
    await Promise.all([
      g.cargarResultadoGrupo(A, p.ronda, nombre(p.aId), nombre(p.bId), 11, 5),
      g.cargarResultadoGrupo(B, p.ronda, nombre(p.aId), nombre(p.bId), 6, 11),
    ]);
    const aviso = (page) => page.getByRole('button', { name: 'Mi versión' }).waitFor({ timeout: 25000 }).then(() => page, () => null);
    const quien = await Promise.race([aviso(A), aviso(B)]);
    esc.exigir(quien, 'una de las dos tablets ve el aviso de conflicto');
    await esperar(2500);
    const enA = await A.getByRole('button', { name: 'Mi versión' }).count();
    const enB = await B.getByRole('button', { name: 'Mi versión' }).count();
    esc.verificar(enA + enB === 1, 'solo la tablet que llegó segunda ve el conflicto', { enA, enB });
    perdedora = enA ? A : B; ganadora = enA ? B : A; resPerdedora = enA ? [11, 5] : [6, 11];
    const resGanadora = enA ? [6, 11] : [11, 5];
    const enBase = esc.fake.torneo(id).partidosGrupo.find((x) => x.id === p.id);
    esc.verificar(enBase.puntosA === resGanadora[0] && enBase.puntosB === resGanadora[1], 'la base tiene el resultado de la que llegó primero (la segunda no lo pisó)', { base: [enBase.puntosA, enBase.puntosB] });
    const texto = await perdedora.getByRole('alert').filter({ hasText: 'Mi versión' }).innerText();
    esc.verificar(texto.includes(`${nombre(p.aId)} vs ${nombre(p.bId)}`), 'el aviso nombra el partido que choca', texto);
    esc.verificar(texto.includes(`acá ${resPerdedora[0]}-${resPerdedora[1]}`) && texto.includes(`en el otro dispositivo ${resGanadora[0]}-${resGanadora[1]}`), 'el aviso muestra los dos resultados', texto);
    esc.verificar(/La del server/.test(texto), 'el aviso ofrece las dos opciones', texto);
    const pildora = await perdedora.getByRole('button', { name: /Refrescar desde el server/ }).innerText();
    esc.verificar(/elegí versión/.test(pildora), 'la píldora dice que hay que elegir versión', pildora);
    await esc.revisarPantalla(perdedora, 'aviso-de-conflicto');
  });
  await esc.paso('la segunda elige "Mi versión": la base queda con lo suyo y la otra tablet se entera sin conflicto', async () => {
    await perdedora.getByRole('button', { name: 'Mi versión' }).click();
    await g.esperarSincronizado(perdedora);
    const enBase = esc.fake.torneo(id).partidosGrupo.find((x) => x.id === p.id);
    esc.verificar(enBase.puntosA === resPerdedora[0] && enBase.puntosB === resPerdedora[1], 'la base tiene el resultado elegido', { base: [enBase.puntosA, enBase.puntosB] });
    const tg = await esperarEstado(ganadora, id, (x) => x.partidosGrupo.find((y) => y.id === p.id).puntosA === resPerdedora[0], 25000);
    esc.verificar(tg.partidosGrupo.find((y) => y.id === p.id).puntosA === resPerdedora[0], 'la otra tablet se actualiza sola');
    esc.verificar((await ganadora.getByRole('button', { name: 'Mi versión' }).count()) === 0, 'la otra tablet no ve conflicto');
    esc.verificar((await perdedora.getByRole('button', { name: 'Mi versión' }).count()) === 0, 'el aviso desaparece');
  });
}

module.exports = { ESCENARIOS: { 'gestor-dos-tablets-misma-llave': dosTabletsMismaLlave, 'gestor-dos-tablets-mismo-partido': dosTabletsMismoPartido } };
