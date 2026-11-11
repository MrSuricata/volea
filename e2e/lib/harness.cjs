// Arnés común: navegador, contextos con la base falsa, registro de consola/red, chequeos de
// desborde y textos cortados, capturas y reporte por escenario.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { FakeSupabase } = require('./fakeSupabase.cjs');

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5311';
const CAPTURAS = process.env.E2E_CAPTURAS || '/tmp/claude-0/-home-user-volea/b13a4c87-1c86-58a4-8869-dd2cde7bd2c7/scratchpad/e2e';
const CELULAR = { width: 390, height: 844 };
const ESCRITORIO = { width: 1440, height: 900 };

class FalloVerificacion extends Error {}

class Escenario {
  constructor(id, opciones = {}) {
    this.id = id;
    this.fake = new FakeSupabase(opciones.fake);
    this.dir = path.join(CAPTURAS, id);
    fs.mkdirSync(this.dir, { recursive: true });
    this.pasos = [];
    this.verificaciones = [];
    this.observaciones = []; // problemas de UI/consola/red encontrados (no cortan el escenario)
    this.capturas = [];
    this.contextos = [];
    this.nCaptura = 0;
  }

  async abrir() {
    this.browser = await chromium.launch();
  }

  async contexto(nombre, viewport = ESCRITORIO, extra = {}) {
    const ctx = await this.browser.newContext({
      viewport, deviceScaleFactor: 1, locale: 'es-UY', timezoneId: 'America/Montevideo',
      isMobile: viewport.width < 600, hasTouch: viewport.width < 600, ...extra,
    });
    await this.fake.instalar(ctx, nombre);
    ctx.on('page', (p) => this.instrumentar(p, nombre));
    this.contextos.push(ctx);
    const page = await ctx.newPage();
    page.__nombre = nombre;
    return page;
  }

  // Corta o devuelve la red de un contexto: eventos offline/online del navegador + pedidos que fallan.
  async red(page, conSenal) {
    const ctx = page.context();
    const etiqueta = ctx.__etiquetaFake;
    if (conSenal) this.fake.cortados.delete(etiqueta); else this.fake.cortados.add(etiqueta);
    await ctx.setOffline(!conSenal);
  }

  instrumentar(page, nombre) {
    page.__consola = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') {
        const texto = m.text();
        if (/Download the React DevTools|\[vite\]/.test(texto)) return;
        page.__consola.push({ tipo: m.type(), texto: texto.slice(0, 400), url: page.url() });
        this.observaciones.push({ tipo: `consola.${m.type()}`, ctx: nombre, url: page.url(), detalle: texto.slice(0, 400) });
      }
    });
    page.on('pageerror', (e) => this.observaciones.push({ tipo: 'pageerror', ctx: nombre, url: page.url(), detalle: String(e && e.stack || e).slice(0, 600) }));
    page.on('requestfailed', (r) => {
      const f = r.failure();
      const err = f ? f.errorText : '';
      if (/blockedbyclient/i.test(err) && !/supabase\.co/.test(r.url())) {
        this.observaciones.push({ tipo: 'red.externa-bloqueada', ctx: nombre, url: page.url(), detalle: r.url().slice(0, 200) });
        return;
      }
      this.observaciones.push({ tipo: 'red.fallida', ctx: nombre, url: page.url(), detalle: `${r.method()} ${r.url().slice(0, 200)} :: ${err}` });
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && /supabase\.co/.test(r.url())) {
        this.observaciones.push({ tipo: `red.http${r.status()}`, ctx: nombre, url: page.url(), detalle: `${r.request().method()} ${r.url().replace(/^https:\/\/[^/]+/, '').slice(0, 200)}` });
      }
    });
  }

  async paso(nombre, fn) {
    const t0 = Date.now();
    try {
      const r = await fn();
      this.pasos.push({ nombre, ok: true, ms: Date.now() - t0 });
      return r;
    } catch (e) {
      this.pasos.push({ nombre, ok: false, ms: Date.now() - t0, error: String(e && e.message || e).slice(0, 1500) });
      throw e;
    }
  }

  // Verificación "blanda": anota y sigue (el escenario termina como FALLA si alguna no se cumplió).
  verificar(cond, mensaje, detalle) {
    this.verificaciones.push({ ok: !!cond, mensaje, detalle: cond ? undefined : detalle });
    return !!cond;
  }

  // Verificación "dura": si falla, corta el escenario (lo que sigue no tiene sentido).
  exigir(cond, mensaje, detalle) {
    if (!this.verificar(cond, mensaje, detalle)) throw new FalloVerificacion(`${mensaje}${detalle ? ` :: ${JSON.stringify(detalle).slice(0, 600)}` : ''}`);
  }

  async captura(page, nombre, opciones = {}) {
    this.nCaptura += 1;
    const archivo = path.join(this.dir, `${String(this.nCaptura).padStart(2, '0')}-${nombre}.png`);
    try {
      await page.screenshot({ path: archivo, fullPage: opciones.fullPage !== false, animations: 'disabled' });
      this.capturas.push(archivo);
    } catch (e) {
      this.observaciones.push({ tipo: 'captura.fallida', ctx: page.__nombre, url: page.url(), detalle: String(e.message).slice(0, 200) });
    }
    return archivo;
  }

  // Desborde horizontal y textos cortados por overflow/ellipsis en la pantalla actual.
  async revisarPantalla(page, nombre, { captura = true } = {}) {
    const r = await page.evaluate(() => {
      const vw = window.innerWidth;
      const doc = document.documentElement;
      const desbordeDoc = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0) - vw;
      const dentroDeScroll = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (['auto', 'scroll', 'hidden', 'clip'].includes(cs.overflowX)) return true;
        }
        return false;
      };
      const desc = (el) => {
        const id = el.id ? `#${el.id}` : '';
        const cls = typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
        return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 90);
      };
      const salidos = [];
      const cortados = [];
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (b.right > vw + 1 && !dentroDeScroll(el) && salidos.length < 12) {
          salidos.push({ el: desc(el), derecha: Math.round(b.right), texto: (el.innerText || '').trim().slice(0, 60) });
        }
        if (!el.classList.contains('sr-only') && (cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && (el.innerText || '').trim() && cortados.length < 12) {
          cortados.push({ el: desc(el), texto: (el.innerText || '').trim().slice(0, 80), visible: el.clientWidth, necesita: el.scrollWidth });
        }
      }
      return { vw, desbordeDoc, salidos, cortados };
    });
    if (r.desbordeDoc > 1) this.observaciones.push({ tipo: 'ui.desborde-horizontal', ctx: page.__nombre, url: page.url(), pantalla: nombre, detalle: `la página es ${r.desbordeDoc}px más ancha que la pantalla (${r.vw}px)`, elementos: r.salidos });
    if (r.cortados.length) this.observaciones.push({ tipo: 'ui.texto-cortado', ctx: page.__nombre, url: page.url(), pantalla: nombre, detalle: `${r.cortados.length} texto(s) recortados`, elementos: r.cortados });
    if (captura) await this.captura(page, nombre);
    return r;
  }

  async cerrar() {
    for (const c of this.contextos) await c.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
  }

  reporte(estado, error) {
    const fallidas = this.verificaciones.filter((v) => !v.ok);
    const obs = {};
    for (const o of this.observaciones) obs[o.tipo] = (obs[o.tipo] ?? 0) + 1;
    const r = {
      escenario: this.id,
      estado: estado === 'error' ? 'ERROR' : fallidas.length ? 'FALLA' : 'PASA',
      error: error ? String(error.message || error).slice(0, 2000) : undefined,
      pasos: this.pasos,
      verificaciones: { total: this.verificaciones.length, fallidas },
      observacionesPorTipo: obs,
      observaciones: dedup(this.observaciones),
      capturas: this.capturas,
      baseFalsa: { requests: this.fake.log.length, sinImplementar: Object.fromEntries(this.fake.sinImplementar) },
    };
    fs.writeFileSync(path.join(this.dir, 'reporte.json'), JSON.stringify(r, null, 2));
    fs.writeFileSync(path.join(this.dir, 'red.json'), JSON.stringify(this.fake.log, null, 1));
    return r;
  }
}

function dedup(lista) {
  const vistos = new Map();
  for (const o of lista) {
    const k = `${o.tipo}|${o.ctx}|${o.pantalla ?? ''}|${o.detalle}`;
    if (vistos.has(k)) vistos.get(k).veces += 1;
    else vistos.set(k, { ...o, veces: 1 });
  }
  return [...vistos.values()];
}

async function correrEscenario(id, fn, opciones) {
  const esc = new Escenario(id, opciones);
  let estado = 'ok';
  let error;
  try {
    await esc.abrir();
    await fn(esc);
  } catch (e) {
    estado = 'error';
    error = e;
    // captura del estado en que quedó cada pestaña
    for (const c of esc.contextos) for (const p of c.pages()) await esc.captura(p, `ERROR-${p.__nombre || 'pagina'}`).catch(() => {});
  } finally {
    await esc.cerrar();
  }
  return esc.reporte(estado, error);
}

module.exports = { Escenario, correrEscenario, BASE, CAPTURAS, CELULAR, ESCRITORIO, FalloVerificacion };
