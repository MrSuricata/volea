// Reporte de la Caja por rango de fechas: qué días entran y las estadísticas del período.
// Lógica pura (la dibujan AdminCajaTab y admin/tabs/CajaEstadisticas, y la exportan
// cajaExcel y cajaReportePdf). Los días son siempre los de Montevideo (UTC-3 fijo, sin
// horario de verano) y viajan como "YYYY-MM-DD", que ordena igual que la fecha.
import type { LedgerEntry, Tenedor } from '../types';
import { normalizar } from './nombres';

export type PeriodoCaja = 'hoy' | '7d' | '30d' | 'mes' | 'todo' | 'rango';
/** Días inclusive; null = sin tope de ese lado. */
export type RangoDias = { desde: string | null; hasta: string | null };

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const aMs = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
const aYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const esYmd = (s: string | null | undefined): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(aMs(s));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Día calendario de un instante visto desde Montevideo ('' si la fecha está rota). */
export function diaMvd(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : aYmd(t - 3 * HORA);
}

export const sumarDias = (ymd: string, n: number) => aYmd(aMs(ymd) + n * DIA);
/** Cuántos días tiene un rango cerrado (los dos extremos cuentan). */
export const diasEntre = (desde: string, hasta: string) => Math.round((aMs(hasta) - aMs(desde)) / DIA) + 1;

/** Los días que abarca cada período. En 'rango' un extremo vacío queda abierto y si vienen al revés se dan vuelta. */
export function rangoDePeriodo(p: PeriodoCaja, hoy: string, desde?: string | null, hasta?: string | null): RangoDias {
  if (p === 'hoy') return { desde: hoy, hasta: hoy };
  if (p === '7d') return { desde: sumarDias(hoy, -6), hasta: hoy };
  if (p === '30d') return { desde: sumarDias(hoy, -29), hasta: hoy };
  if (p === 'mes') return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
  if (p === 'todo') return { desde: null, hasta: null };
  const d = esYmd(desde) ? desde : null;
  const h = esYmd(hasta) ? hasta : null;
  return d && h && d > h ? { desde: h, hasta: d } : { desde: d, hasta: h };
}

/** El mes calendario anterior al de `hoy`, completo. */
export function mesAnterior(hoy: string): { desde: string; hasta: string } {
  const hasta = sumarDias(`${hoy.slice(0, 8)}01`, -1);
  return { desde: `${hasta.slice(0, 8)}01`, hasta };
}

/** El tramo del mismo largo justo antes (para comparar). null si el rango está abierto. */
export function rangoAnterior(r: RangoDias): RangoDias | null {
  if (!r.desde || !r.hasta) return null;
  const n = diasEntre(r.desde, r.hasta);
  return { desde: sumarDias(r.desde, -n), hasta: sumarDias(r.desde, -1) };
}

export function enRango(iso: string, r: RangoDias): boolean {
  if (!r.desde && !r.hasta) return true;
  const d = diaMvd(iso);
  if (d === '') return true; // una fecha rota no se esconde: mejor verla que perderla
  return (!r.desde || d >= r.desde) && (!r.hasta || d <= r.hasta);
}

const dm = (ymd: string) => `${Number(ymd.slice(8, 10))}/${Number(ymd.slice(5, 7))}`;
const dmy = (ymd: string) => `${dm(ymd)}/${ymd.slice(0, 4)}`;

/** "20/10 al 23/11/2026" · "el 23/11/2026" · "desde el 20/10/2026" · "todo el historial". */
export function textoRango(r: RangoDias): string {
  if (r.desde && r.hasta) {
    if (r.desde === r.hasta) return `el ${dmy(r.desde)}`;
    return `${r.desde.slice(0, 4) === r.hasta.slice(0, 4) ? dm(r.desde) : dmy(r.desde)} al ${dmy(r.hasta)}`;
  }
  if (r.desde) return `desde el ${dmy(r.desde)}`;
  if (r.hasta) return `hasta el ${dmy(r.hasta)}`;
  return 'todo el historial';
}

export type MetodoCaja = 'mp' | 'efectivo' | 'transferencia' | 'debe-pendiente' | 'debe-cobrado' | 'sin-metodo';
export const METODOS_CAJA: MetodoCaja[] = ['mp', 'efectivo', 'transferencia', 'debe-cobrado', 'debe-pendiente', 'sin-metodo'];
export const NOMBRE_METODO: Record<MetodoCaja, string> = {
  mp: 'Mercado Pago', efectivo: 'Efectivo', transferencia: 'Transferencia',
  'debe-cobrado': 'Fiado ya cobrado', 'debe-pendiente': 'Fiado sin cobrar', 'sin-metodo': 'Sin método',
};

export const metodoDe = (e: LedgerEntry): MetodoCaja => {
  if (e.paymentMethod === 'debe') return e.settledAt ? 'debe-cobrado' : 'debe-pendiente';
  return e.paymentMethod ?? 'sin-metodo';
};

const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** 0 = lunes … 6 = domingo. */
const diaSemana = (ymd: string) => (new Date(aMs(ymd)).getUTCDay() + 6) % 7;

export type Granularidad = 'dia' | 'semana' | 'mes';
export type TramoSerie = { clave: string; etiqueta: string; ventas: number; gastos: number };

export type EstadisticasCaja = {
  ventas: number; gastos: number; balance: number;
  nVentas: number; nGastos: number;
  /** Movimientos anulados dentro del período (no cuentan en nada más). */
  anulados: { n: number; monto: number };
  ticketPromedio: number;
  /** Primer y último día que abarca la serie (null si no hay movimientos ni rango cerrado). */
  desde: string | null; hasta: string | null;
  dias: number;
  /** Días del período en los que hubo al menos una venta. */
  diasConVentas: number;
  ventasPorDia: number;
  mejorDia: { dia: string; ventas: number } | null;
  granularidad: Granularidad;
  serie: TramoSerie[];
  porDiaSemana: { nombre: string; ventas: number; n: number }[];
  porMetodo: { metodo: MetodoCaja; monto: number; n: number }[];
  /** Ventas del catálogo (descuentan stock) contra ítems sueltos. */
  catalogo: { monto: number; n: number };
  sueltos: { monto: number; n: number };
  productos: { nombre: string; catalogo: boolean; unidades: number; monto: number; n: number }[];
  gastosPorConcepto: { nombre: string; monto: number; n: number }[];
  gastosPorPagador: { quien: Tenedor | null; monto: number; n: number }[];
  porPersona: { nombre: string; ventas: number; gastos: number; n: number }[];
  /** Lo del período que todavía no pasó a las cuentas entre socios. */
  sinLiquidar: { ventas: number; gastos: number; n: number };
};

function tramos(desde: string, hasta: string, g: Granularidad): TramoSerie[] {
  const lista: TramoSerie[] = [];
  if (g === 'mes') {
    let y = Number(desde.slice(0, 4)); let m = Number(desde.slice(5, 7));
    const fin = hasta.slice(0, 7);
    for (;;) {
      const clave = `${y}-${String(m).padStart(2, '0')}`;
      lista.push({ clave, etiqueta: `${MESES[m - 1]} ${String(y).slice(2)}`, ventas: 0, gastos: 0 });
      if (clave >= fin) break;
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
    return lista;
  }
  const paso = g === 'semana' ? 7 : 1;
  const inicio = g === 'semana' ? sumarDias(desde, -diaSemana(desde)) : desde;
  for (let d = inicio; d <= hasta; d = sumarDias(d, paso)) lista.push({ clave: d, etiqueta: dm(d), ventas: 0, gastos: 0 });
  return lista;
}

const claveTramo = (dia: string, g: Granularidad) => (g === 'mes' ? dia.slice(0, 7) : g === 'semana' ? sumarDias(dia, -diaSemana(dia)) : dia);

/**
 * A qué renglón de «Lo más vendido» va una venta. Las inscripciones y los pedidos de la web
 * traen el nombre de la persona o el código en la etiqueta: se juntan en un solo renglón.
 * "2× Llavero" cuenta como 2 unidades de "Llavero" (un combo "A + B" queda como está).
 */
export function itemVendido(e: LedgerEntry): { clave: string; nombre: string; unidades: number } {
  const qty = Math.max(1, e.qty || 1);
  if (e.productId) return { clave: `p:${e.productId}`, nombre: e.label, unidades: qty };
  const label = e.label.trim();
  if (/^inscripci[oó]n\s*:/i.test(label)) return { clave: 's:inscripciones', nombre: 'Inscripciones', unidades: qty };
  if (/^pedido\s+\S+\s*:/i.test(label)) return { clave: 's:pedidos-web', nombre: 'Pedidos de la web', unidades: qty };
  const veces = /^(\d{1,3})\s*[×x]\s+(.+)$/i.exec(label);
  if (veces && !veces[2].includes(' + ')) return { clave: `s:${normalizar(veces[2])}`, nombre: veces[2], unidades: Number(veces[1]) * qty };
  return { clave: `s:${normalizar(label)}`, nombre: label, unidades: qty };
}

/** Estadísticas de los movimientos que caen en el rango. Los anulados solo se cuentan aparte. */
export function estadisticasCaja(entries: LedgerEntry[], rango: RangoDias): EstadisticasCaja {
  const dentro = entries.filter((e) => enRango(e.createdAt, rango));
  const activos = dentro.filter((e) => !e.reverted);
  const anuladosLista = dentro.filter((e) => e.reverted);

  let ventas = 0; let gastos = 0; let nVentas = 0; let nGastos = 0;
  let min: string | null = null; let max: string | null = null;
  const ventasDia = new Map<string, number>();
  const porDiaSemana = DIAS_SEMANA.map((nombre) => ({ nombre, ventas: 0, n: 0 }));
  const metodos = new Map<MetodoCaja, { monto: number; n: number }>();
  const catalogo = { monto: 0, n: 0 }; const sueltos = { monto: 0, n: 0 };
  const productos = new Map<string, EstadisticasCaja['productos'][number]>();
  const conceptos = new Map<string, { nombre: string; monto: number; n: number }>();
  const pagadores = new Map<Tenedor | null, { monto: number; n: number }>();
  const personas = new Map<string, EstadisticasCaja['porPersona'][number]>();
  const sinLiquidar = { ventas: 0, gastos: 0, n: 0 };

  for (const e of activos) {
    const dia = diaMvd(e.createdAt);
    if (dia) { if (!min || dia < min) min = dia; if (!max || dia > max) max = dia; }
    const nombrePersona = e.reportedBy || '—';
    const persona = personas.get(nombrePersona) ?? { nombre: nombrePersona, ventas: 0, gastos: 0, n: 0 };
    persona.n += 1;
    if (!e.socioSettledAt) { sinLiquidar.n += 1; if (e.kind === 'venta') sinLiquidar.ventas += e.amount; else sinLiquidar.gastos += e.amount; }
    if (e.kind === 'venta') {
      ventas += e.amount; nVentas += 1; persona.ventas += e.amount;
      if (dia) {
        ventasDia.set(dia, (ventasDia.get(dia) ?? 0) + e.amount);
        const ds = porDiaSemana[diaSemana(dia)]; ds.ventas += e.amount; ds.n += 1;
      }
      const m = metodoDe(e);
      const acM = metodos.get(m) ?? { monto: 0, n: 0 }; acM.monto += e.amount; acM.n += 1; metodos.set(m, acM);
      const esCatalogo = Boolean(e.productId);
      const grupo = esCatalogo ? catalogo : sueltos; grupo.monto += e.amount; grupo.n += 1;
      const item = itemVendido(e);
      const prod = productos.get(item.clave) ?? { nombre: item.nombre, catalogo: esCatalogo, unidades: 0, monto: 0, n: 0 };
      prod.unidades += item.unidades; prod.monto += e.amount; prod.n += 1; productos.set(item.clave, prod);
    } else {
      gastos += e.amount; nGastos += 1; persona.gastos += e.amount;
      const clave = normalizar(e.label);
      const c = conceptos.get(clave) ?? { nombre: e.label, monto: 0, n: 0 }; c.monto += e.amount; c.n += 1; conceptos.set(clave, c);
      const pg = pagadores.get(e.paidBy) ?? { monto: 0, n: 0 }; pg.monto += e.amount; pg.n += 1; pagadores.set(e.paidBy, pg);
    }
    personas.set(nombrePersona, persona);
  }

  // La serie abarca el rango pedido; un extremo abierto se cierra con el primer/último movimiento.
  const desde = rango.desde ?? min;
  const hasta = rango.hasta ?? max;
  let serie: TramoSerie[] = []; let granularidad: Granularidad = 'dia'; let dias = 0;
  if (desde && hasta && desde <= hasta) {
    dias = diasEntre(desde, hasta);
    granularidad = dias <= 45 ? 'dia' : dias <= 182 ? 'semana' : 'mes';
    serie = tramos(desde, hasta, granularidad);
    const porClave = new Map(serie.map((t) => [t.clave, t]));
    for (const e of activos) {
      const dia = diaMvd(e.createdAt);
      const t = dia ? porClave.get(claveTramo(dia, granularidad)) : undefined;
      if (!t) continue;
      if (e.kind === 'venta') t.ventas += e.amount; else t.gastos += e.amount;
    }
    for (const t of serie) { t.ventas = r2(t.ventas); t.gastos = r2(t.gastos); }
  }

  let mejorDia: EstadisticasCaja['mejorDia'] = null;
  for (const [dia, v] of ventasDia) if (!mejorDia || v > mejorDia.ventas) mejorDia = { dia, ventas: r2(v) };

  const porMonto = <T extends { monto: number }>(a: T, b: T) => b.monto - a.monto;
  const redondo = <T extends { monto: number }>(x: T): T => ({ ...x, monto: r2(x.monto) });
  return {
    ventas: r2(ventas), gastos: r2(gastos), balance: r2(ventas - gastos), nVentas, nGastos,
    anulados: { n: anuladosLista.length, monto: r2(anuladosLista.reduce((s, e) => s + e.amount, 0)) },
    ticketPromedio: nVentas ? r2(ventas / nVentas) : 0,
    desde: desde ?? null, hasta: hasta ?? null, dias,
    diasConVentas: ventasDia.size,
    ventasPorDia: dias ? r2(ventas / dias) : 0,
    mejorDia, granularidad, serie,
    porDiaSemana: porDiaSemana.map((d) => ({ ...d, ventas: r2(d.ventas) })),
    porMetodo: METODOS_CAJA.filter((m) => metodos.has(m)).map((m) => ({ metodo: m, monto: r2(metodos.get(m)!.monto), n: metodos.get(m)!.n })),
    catalogo: redondo(catalogo), sueltos: redondo(sueltos),
    productos: Array.from(productos.values()).map(redondo).sort(porMonto),
    gastosPorConcepto: Array.from(conceptos.values()).map(redondo).sort(porMonto),
    gastosPorPagador: Array.from(pagadores.entries()).map(([quien, v]) => ({ quien, monto: r2(v.monto), n: v.n })).sort(porMonto),
    porPersona: Array.from(personas.values()).map((p) => ({ ...p, ventas: r2(p.ventas), gastos: r2(p.gastos) })).sort((a, b) => b.ventas + b.gastos - (a.ventas + a.gastos)),
    sinLiquidar: { ventas: r2(sinLiquidar.ventas), gastos: r2(sinLiquidar.gastos), n: sinLiquidar.n },
  };
}

/** Cambio contra el período anterior en % (null si antes no hubo nada con qué comparar). */
export function variacion(ahora: number, antes: number): number | null {
  if (!antes) return null;
  return Math.round(((ahora - antes) / Math.abs(antes)) * 100);
}

/** "Lunes 23/11" a partir de un día. */
export const diaLargo = (ymd: string) => `${DIAS_SEMANA[diaSemana(ymd)]} ${dm(ymd)}`;
