// "Sin Supabase la app cae a localStorage" (.env.example): se corta TODO acceso a la base desde el
// arranque y se mira qué queda en pie de la parte de torneos.
const { ESCRITORIO, CELULAR, BASE } = require('../lib/harness.cjs');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function sinBase(esc) {
  const admin = await esc.contexto('admin', ESCRITORIO);
  esc.fake.cortados.add('admin');
  await esc.paso('admin sin base: ¿se puede entrar al gestor?', async () => {
    await admin.goto(`${BASE}/admin?tab=torneos`);
    await admin.getByRole('heading', { name: /entrar/i }).waitFor({ timeout: 30000 });
    await esperar(1000);
    const txt = await admin.locator('body').innerText();
    await esc.revisarPantalla(admin, 'admin-sin-base');
    const clave = admin.locator('input[type=password]');
    if (await clave.count()) {
      await clave.first().fill('cualquier-cosa');
      await admin.getByRole('button', { name: /Entrar al panel/ }).click();
      await esperar(800);
    }
    const gestor = await admin.getByRole('heading', { name: 'Gestor de torneos' }).count();
    esc.verificar(gestor > 0, 'sin base el gestor de torneos se puede usar en modo local', `no: el login sin Supabase acepta solo login() que siempre devuelve false (src/App.tsx:723). Pantalla: ${txt.slice(0, 160).replace(/\n/g, ' | ')}`);
    await esc.revisarPantalla(admin, 'admin-sin-base-login');
  });
  const pub = await esc.contexto('publico', CELULAR);
  esc.fake.cortados.add('publico');
  await esc.paso('público sin base: /torneos', async () => {
    await pub.goto(`${BASE}/torneos`);
    await esperar(20000);
    const txt = await pub.locator('body').innerText();
    esc.verificar(/No se pudo conectar|Reintentar/i.test(txt), '/torneos sin base muestra un error con "Reintentar" (no un cargando eterno)', txt.slice(0, 200));
    await esc.revisarPantalla(pub, 'torneos-sin-base');
  });
  const cel = await esc.contexto('arbitro', CELULAR);
  esc.fake.cortados.add('arbitro');
  await esc.paso('árbitro sin base', async () => {
    await cel.goto(`${BASE}/arbitro`);
    await cel.getByLabel('Código del partido').fill('1234');
    await cel.getByRole('button', { name: 'Entrar' }).click();
    const msg = await cel.getByRole('alert').innerText({ timeout: 20000 }).catch(() => null);
    esc.verificar(/No se pudo conectar|Sin conexión/.test(msg || ''), 'el árbitro sin base ve "No se pudo conectar"', msg);
    await esc.revisarPantalla(cel, 'arbitro-sin-base');
  });
}

module.exports = { ESCENARIOS: { 'sin-base-local': sinBase } };
