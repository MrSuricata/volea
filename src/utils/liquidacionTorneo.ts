// Liquidación de un campeonato: cuánto le toca al club, cuánto a VOLEA y cómo queda cada socio.
// El acuerdo típico: de cada inscripción una parte es "inscripción" (se reparte con el club por
// porcentaje) y el resto es la remera (todo de VOLEA); los gastos y premios se reparten con su
// propio porcentaje. Lógica pura: la pantalla (admin/tabs/LiquidacionesTab) solo la dibuja.

export const SOCIOS_LIQ = ['Brian', 'Paula', 'Gastón'] as const;
/** Quién puso la plata de un gasto: la caja de VOLEA, un socio de su bolsillo o el club. */
export type Pagador = 'volea' | 'club' | (typeof SOCIOS_LIQ)[number];

export type AcuerdoTorneo = {
  club: string;
  /** Precio completo de la inscripción (ej. 700). */
  precio: number;
  /** Cuánto de ese precio es inscripción y se reparte con el club (ej. 400); el resto es remera. */
  baseInscripcion: number;
  /** % de la base que es del club (ej. 55). */
  pctClub: number;
  /** % de los gastos que pone el club por defecto (ej. 55). */
  pctClubGastos: number;
  /** Quién cobró las inscripciones. */
  cobro: 'volea' | 'club';
};

export type LineaInscripcion = {
  id: string;
  nombre: string;
  /** Lo que le corresponde pagar (con cupón o precio especial ya aplicado). */
  total: number;
  pagado: number;
  /** Cuánto de su total se reparte con el club. Ausente ⇒ regla del acuerdo (ver baseDeLinea). */
  base?: number;
  nota?: string;
};

export type GastoTorneo = {
  id: string;
  concepto: string;
  cantidad: number;
  unitario: number;
  /** % que pone el club. */
  pctClub: number;
  pagadoPor: Pagador;
  proveedor?: string;
  /** false ⇒ todavía se le debe al proveedor. */
  pagado?: boolean;
  /** Gasto de la Caja del que salió (bot_ledger.id), para no asociarlo dos veces. */
  ledgerId?: string;
};

export type LiquidacionTorneo = {
  nombre: string;
  fecha?: string;
  eventId?: string;
  acuerdo: AcuerdoTorneo;
  inscripciones: LineaInscripcion[];
  gastos: GastoTorneo[];
  notas?: string;
};

export const ACUERDO_DEFECTO: AcuerdoTorneo = { club: 'Pickleball City', precio: 700, baseInscripcion: 400, pctClub: 55, pctClubGastos: 55, cobro: 'volea' };

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const pct = (n: unknown) => Math.min(100, Math.max(0, num(n)));

/**
 * Parte de una inscripción que se reparte con el club. Si paga el precio completo (o más), la
 * base del acuerdo; si paga menos (cupón, precio especial), en la misma proporción.
 */
export function baseDeLinea(l: LineaInscripcion, a: AcuerdoTorneo): number {
  const total = Math.max(0, num(l.total));
  if (typeof l.base === 'number' && Number.isFinite(l.base)) return Math.min(total, Math.max(0, l.base));
  const precio = num(a.precio);
  const base = Math.max(0, num(a.baseInscripcion));
  if (precio <= 0 || total >= precio) return Math.min(total, base);
  return r2(total * Math.min(1, base / precio));
}

export const montoGasto = (g: GastoTorneo) => r2(Math.max(0, num(g.cantidad)) * Math.max(0, num(g.unitario)));

export type ResultadoLiquidacion = {
  inscriptos: number;
  totalInscripciones: number;
  cobrado: number;
  porCobrar: number;
  deudores: { nombre: string; debe: number }[];
  /** Suma de las bases que se reparten con el club. */
  base: number;
  remeras: number;
  clubInscripciones: number;
  voleaInscripciones: number;
  gastos: number;
  clubGastos: number;
  voleaGastos: number;
  netoClub: number;
  netoVolea: number;
  /** Transferencia que cierra la cuenta con el club: + VOLEA le paga al club, − el club le paga a VOLEA. */
  saldoClub: number;
  /** De ese saldo, la parte que depende de inscripciones todavía sin cobrar. */
  saldoClubPendiente: number;
  saldoClubAhora: number;
  gastosPagadosPor: Record<string, number>;
  /** Gastos que todavía se le deben a un proveedor. */
  aProveedores: { concepto: string; proveedor: string; monto: number }[];
  /** Cada socio: lo que puso de su bolsillo y lo que le toca (su tercio del neto + lo que puso). */
  socios: { nombre: string; puso: number; parte: number; recibe: number }[];
};

export function calcularLiquidacion(l: LiquidacionTorneo): ResultadoLiquidacion {
  const a = l.acuerdo;
  const p = pct(a.pctClub) / 100;
  let total = 0; let cobrado = 0; let base = 0; let basePendiente = 0;
  const deudores: ResultadoLiquidacion['deudores'] = [];
  for (const i of l.inscripciones) {
    const t = Math.max(0, num(i.total));
    const pg = Math.min(t, Math.max(0, num(i.pagado)));
    const b = baseDeLinea(i, a);
    total += t; cobrado += pg; base += b;
    if (t > pg) {
      deudores.push({ nombre: i.nombre, debe: r2(t - pg) });
      basePendiente += t > 0 ? b * ((t - pg) / t) : 0;
    }
  }
  const clubInscripciones = r2(base * p);
  let gastos = 0; let clubGastos = 0;
  const gastosPagadosPor: Record<string, number> = {};
  const aProveedores: ResultadoLiquidacion['aProveedores'] = [];
  for (const g of l.gastos) {
    const m = montoGasto(g);
    gastos += m;
    clubGastos += m * (pct(g.pctClub) / 100);
    gastosPagadosPor[g.pagadoPor] = r2((gastosPagadosPor[g.pagadoPor] ?? 0) + m);
    if (g.pagado === false) aProveedores.push({ concepto: g.concepto, proveedor: g.proveedor?.trim() || 'Sin proveedor', monto: m });
  }
  clubGastos = r2(clubGastos);
  const netoClub = r2(clubInscripciones - clubGastos);
  const netoVolea = r2(total - clubInscripciones - (gastos - clubGastos));
  // El club tiene que terminar con netoClub: se le suma lo que puso en gastos y se le resta lo que cobró.
  const pusoClub = gastosPagadosPor.club ?? 0;
  const saldoClub = r2(netoClub + pusoClub - (a.cobro === 'club' ? total : 0));
  // Lo que falta cobrar: si cobra VOLEA, la parte del club de eso todavía no se le debe; si cobra el club, al revés.
  const saldoClubPendiente = r2(a.cobro === 'club' ? -(r2(total - cobrado) - basePendiente * p) : basePendiente * p);
  const n = SOCIOS_LIQ.length;
  const socios = SOCIOS_LIQ.map((nombre) => {
    const puso = gastosPagadosPor[nombre] ?? 0;
    const parte = r2(netoVolea / n);
    return { nombre, puso, parte, recibe: r2(parte + puso) };
  });
  return {
    inscriptos: l.inscripciones.length, totalInscripciones: r2(total), cobrado: r2(cobrado), porCobrar: r2(total - cobrado), deudores,
    base: r2(base), remeras: r2(total - base), clubInscripciones, voleaInscripciones: r2(total - clubInscripciones),
    gastos: r2(gastos), clubGastos, voleaGastos: r2(gastos - clubGastos), netoClub, netoVolea,
    saldoClub, saldoClubPendiente, saldoClubAhora: r2(saldoClub - saldoClubPendiente),
    gastosPagadosPor, aProveedores, socios,
  };
}

/** Deja el documento con la forma esperada (lo que viene de la base puede estar incompleto). */
export function normalizarLiquidacion(x: unknown): LiquidacionTorneo {
  const o = (x && typeof x === 'object' ? x : {}) as Partial<LiquidacionTorneo>;
  const a = (o.acuerdo && typeof o.acuerdo === 'object' ? o.acuerdo : {}) as Partial<AcuerdoTorneo>;
  return {
    nombre: typeof o.nombre === 'string' ? o.nombre : '',
    fecha: typeof o.fecha === 'string' ? o.fecha : undefined,
    eventId: typeof o.eventId === 'string' ? o.eventId : undefined,
    acuerdo: {
      club: typeof a.club === 'string' ? a.club : ACUERDO_DEFECTO.club,
      precio: num(a.precio ?? ACUERDO_DEFECTO.precio),
      baseInscripcion: num(a.baseInscripcion ?? ACUERDO_DEFECTO.baseInscripcion),
      pctClub: pct(a.pctClub ?? ACUERDO_DEFECTO.pctClub),
      pctClubGastos: pct(a.pctClubGastos ?? ACUERDO_DEFECTO.pctClubGastos),
      cobro: a.cobro === 'club' ? 'club' : 'volea',
    },
    inscripciones: Array.isArray(o.inscripciones) ? o.inscripciones.filter((i) => i && typeof i.id === 'string') : [],
    gastos: Array.isArray(o.gastos) ? o.gastos.filter((g) => g && typeof g.id === 'string') : [],
    notas: typeof o.notas === 'string' ? o.notas : undefined,
  };
}

/**
 * Trae los inscriptos de un evento a la liquidación. Los que ya estaban conservan lo que se les
 * ajustó a mano (base, nota) y actualizan lo pagado; los dados de baja no entran.
 */
export function sincronizarInscripciones(
  actuales: LineaInscripcion[],
  inscriptos: { id: string; nombre: string; estado: string; costo: number | null; pagado: number | null; deuda: number | null; cuponPct: number | null }[],
  precio: number,
): LineaInscripcion[] {
  const previas = new Map(actuales.map((l) => [l.id, l]));
  const delEvento = new Set(inscriptos.map((i) => i.id));
  const nuevas = inscriptos.filter((i) => i.estado !== 'baja').map((i) => {
    const pagado = Math.max(0, num(i.pagado));
    // Sin deuda anotada: le toca el costo (con cupón si tiene). Con deuda: lo pagado + lo que debe.
    const costo = num(i.costo ?? precio);
    const total = i.cuponPct ? r2(costo * (1 - pct(i.cuponPct) / 100)) : i.deuda !== null && i.pagado !== null ? r2(pagado + Math.max(0, num(i.deuda))) : costo;
    const previa = previas.get(i.id);
    return previa ? { ...previa, nombre: i.nombre, pagado } : { id: i.id, nombre: i.nombre, total, pagado };
  });
  // Las líneas cargadas a mano (no vienen del evento) se conservan.
  return [...nuevas, ...actuales.filter((l) => !delEvento.has(l.id) && l.id.startsWith('manual-'))];
}
