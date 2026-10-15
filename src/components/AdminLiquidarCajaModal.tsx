import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import type { LedgerEntry, SocioMove, SocioName, SocioLiquidacionMove, Tenedor } from '../types';
import { esCuotaFutura, impactosGasto, impactosVenta, SOCIOS, NOMBRES_SOCIOS, TENEDORES, NOMBRES_TENEDOR } from '../utils/socios';
import { cn } from '../lib/cn';
import { Boton, Dialogo, Confirmar, Plata, Insignia, Segmentado, Vacio, CargandoFilas, ErrorEstado, formatoPlata } from '../admin/ui';
import { plural } from '../admin/ui-ventas/ventas';
import { agruparPorCobrador, ventaALiquidar, type VentaALiquidar } from '../utils/liquidacionCaja';

const TZ = 'America/Montevideo';
const diaMvd = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date();
  return isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: TZ });
};

/**
 * Fallback para gastos SIN pagador elegido (los del bot y los históricos): se
 * deduce del nombre de quien lo registró. Es una adivinanza y se equivoca: todo
 * lo que no empieza con "brian"/"paul" cae en Gastón — incluida la cuenta
 * compartida "VOLEA Team". Por eso los gastos nuevos de la web guardan `paidBy`
 * explícito y esta función ya no los toca. Igual queda ajustable en el modal.
 */
const personaASocio = (nombre: string): SocioName => {
  const n = nombre.trim().toLowerCase();
  if (n.startsWith('brian')) return 'brian';
  if (n.startsWith('paul') || n.startsWith('pauli')) return 'paula';
  return 'gaston';
};

/** Quién puso la plata: lo elegido al registrar manda; si no hay, se adivina. */
const pagadorDe = (e: LedgerEntry): Tenedor => e.paidBy ?? personaASocio(e.reportedBy || '');

/**
 * Cada venta lleva su cobrador (quién tiene la plata). Viene sugerido por quien cobró
 * la deuda o quien registró la venta; las de cuentas compartidas arrancan sin elegir.
 * Se agrupan por cómo entró la plata solo para mostrarlas y para asentar un
 * movimiento por grupo y socio.
 */
const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-UY', { day: 'numeric', month: 'short', timeZone: TZ });
type GastoRow = {
  id: string; label: string; fecha: string | null; monto: number; persona: string;
  pagador: Tenedor;
  /** true = lo eligió alguien al registrar; false = lo adivinamos por el nombre. */
  elegido: boolean;
  incluir: boolean;
};

// La Caja VOLEA primero: es donde queda el efectivo. Lo que va a la caja no mueve las cuentas de socios.
const OPCIONES_SOCIOS = TENEDORES.map(s => ({ valor: s, texto: NOMBRES_TENEDOR[s] }));
const AREAS: { valor: SocioMove['area']; texto: string }[] = [
  { valor: 'marca', texto: 'Marca' },
  { valor: 'cafeteria', texto: 'Cafetería' },
  { valor: 'otros', texto: 'Otros' },
];

/** Casilla con área de toque de 44px (la fila entera no, porque adentro hay otros controles). */
function Casilla({ marcada, alCambiar, etiqueta }: { marcada: boolean; alCambiar: () => void; etiqueta: string }) {
  return (
    <label className="-m-2 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-gray-100">
      <input type="checkbox" checked={marcada} onChange={alCambiar} aria-label={etiqueta} className="h-5 w-5 cursor-pointer accent-navy-700" />
    </label>
  );
}

export function AdminLiquidarCajaModal({ socioMoves, loadLedgerFull, liquidar, onClose, onDone }: {
  socioMoves: SocioMove[] | null;
  loadLedgerFull: () => Promise<LedgerEntry[] | null>;
  liquidar: (ids: string[], moves: SocioLiquidacionMove[]) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [ventas, setVentas] = useState<VentaALiquidar[]>([]);
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [gastoRows, setGastoRows] = useState<GastoRow[]>([]);
  const [fiadosSinCobrar, setFiadosSinCobrar] = useState({ n: 0, total: 0 });
  const [area, setArea] = useState<SocioMove['area']>('marca');
  const [saving, setSaving] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const data = await loadLedgerFull();
      if (!vivo) return;
      if (data === null) { setFailed(true); setLoading(false); return; }
      const pendientes = data.filter(e => !e.reverted && !e.socioSettledAt);

      const vs: VentaALiquidar[] = [];
      let fiadosN = 0, fiadosTotal = 0;
      for (const e of pendientes) {
        if (e.kind !== 'venta') continue;
        if (e.paymentMethod === 'debe' && !e.settledAt) {
          fiadosN++; fiadosTotal += e.amount;
          continue; // plata que todavía no entró: se liquida cuando se cobre
        }
        vs.push(ventaALiquidar(e));
      }

      const gastos: GastoRow[] = pendientes
        .filter(e => e.kind === 'gasto')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(e => ({
          id: e.id, label: e.label, fecha: diaMvd(e.createdAt), monto: e.amount,
          persona: e.reportedBy || '—', pagador: pagadorDe(e), elegido: e.paidBy !== null, incluir: true,
        }));

      setVentas(vs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      setGastoRows(gastos);
      setFiadosSinCobrar({ n: fiadosN, total: fiadosTotal });
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, [loadLedgerFull]);

  const saldosHoy = useMemo(() => {
    const s: Record<SocioName, number> = { brian: 0, paula: 0, gaston: 0 };
    const ahora = new Date();
    for (const m of socioMoves || []) {
      if (m.moneda !== 'UYU' || esCuotaFutura(m, ahora)) continue;
      s.brian += m.impBrian; s.paula += m.impPaula; s.gaston += m.impGaston;
    }
    return s;
  }, [socioMoves]);

  // Grupos por cómo entró la plata, de mayor a menor.
  const ventaGroups = useMemo(() => {
    const m = new Map<string, VentaALiquidar[]>();
    for (const v of ventas) m.set(v.grupo, [...(m.get(v.grupo) ?? []), v]);
    return [...m.entries()]
      .map(([key, filas]) => ({
        key, filas, incluir: !excluidos.has(key),
        total: filas.reduce((s, v) => s + v.monto, 0),
        porSocio: TENEDORES.map(s => ({ s, total: filas.filter(v => v.cobrador === s).reduce((t, v) => t + v.monto, 0) })).filter(x => x.total > 0),
        sinElegir: filas.filter(v => v.cobrador === null),
      }))
      .sort((a, b) => b.total - a.total);
  }, [ventas, excluidos]);
  const ventasIncluidas = useMemo(() => ventas.filter(v => !excluidos.has(v.grupo)), [ventas, excluidos]);
  const asignar = (ids: Set<string>, s: Tenedor) =>
    setVentas(vs => vs.map(v => ids.has(v.id) ? { ...v, cobrador: s, origen: 'cobro' } : v));
  const alternar = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };

  const deltas = useMemo(() => {
    const d: Record<SocioName, number> = { brian: 0, paula: 0, gaston: 0 };
    for (const g of agruparPorCobrador(ventasIncluidas)) {
      if (g.cobrador === 'caja') continue;
      const imp = impactosVenta(g.total, g.cobrador);
      for (const s of SOCIOS) d[s] += imp[s];
    }
    for (const r of gastoRows) {
      if (!r.incluir || r.pagador === 'caja') continue;
      const imp = impactosGasto(r.monto, r.pagador);
      for (const s of SOCIOS) d[s] += imp[s];
    }
    return d;
  }, [ventasIncluidas, gastoRows]);
  // Lo que entra (+) o sale (−) de la Caja VOLEA con esta liquidación.
  const deltaCaja = useMemo(() =>
    ventasIncluidas.filter(v => v.cobrador === 'caja').reduce((t, v) => t + v.monto, 0)
    - gastoRows.filter(r => r.incluir && r.pagador === 'caja').reduce((t, r) => t + r.monto, 0),
  [ventasIncluidas, gastoRows]);

  const totVentas = ventasIncluidas.reduce((s, v) => s + v.monto, 0);
  const totGastos = gastoRows.filter(r => r.incluir).reduce((s, r) => s + r.monto, 0);
  const nMovs = ventasIncluidas.length + gastoRows.filter(r => r.incluir).length;
  const hayAlgo = ventas.length + gastoRows.length > 0;
  // Ventas incluidas a las que les falta decir quién tiene la plata.
  const sinCobrador = ventasIncluidas.filter(v => v.cobrador === null);
  // Gastos que se van a liquidar con un pagador ADIVINADO. Se muestra el monto,
  // no solo la cantidad: es la plata que se le puede asentar al socio equivocado.
  const sinConfirmar = gastoRows.filter(r => r.incluir && !r.elegido);
  const montoSinConfirmar = sinConfirmar.reduce((s, r) => s + r.monto, 0);
  const puedeLiquidar = nMovs > 0 && sinCobrador.length === 0;

  const handleConfirm = async () => {
    if (saving || nMovs === 0 || sinCobrador.length > 0) return;
    setSaving(true);
    try {
      const hoy = diaMvd();
      const ids: string[] = [];
      const moves: SocioLiquidacionMove[] = [];
      for (const g of agruparPorCobrador(ventasIncluidas)) {
        ids.push(...g.ids);
        const n = g.ids.length;
        const monto = Math.round(g.total * 100) / 100;
        if (g.cobrador === 'caja') {
          moves.push({
            caja: true, area, tipo: 'venta', fecha: hoy,
            descripcion: `Liquidación caja — ${g.grupo} (${n} venta${n === 1 ? '' : 's'})`,
            monto, pagador: null, de: null, para: null, imp_brian: 0, imp_paula: 0, imp_gaston: 0,
          });
          continue;
        }
        const imp = impactosVenta(g.total, g.cobrador);
        moves.push({
          area, tipo: 'venta', fecha: hoy,
          descripcion: `Liquidación caja — ${g.grupo} cobrado por ${NOMBRES_SOCIOS[g.cobrador]} (${n} venta${n === 1 ? '' : 's'})`,
          monto,
          pagador: null, de: null, para: g.cobrador,
          imp_brian: imp.brian, imp_paula: imp.paula, imp_gaston: imp.gaston,
        });
      }
      for (const r of gastoRows) {
        if (!r.incluir) continue;
        ids.push(r.id);
        if (r.pagador === 'caja') {
          moves.push({
            caja: true, area, tipo: 'gasto', fecha: r.fecha, descripcion: r.label,
            monto: Math.round(r.monto * 100) / 100, pagador: null, de: null, para: null, imp_brian: 0, imp_paula: 0, imp_gaston: 0,
          });
          continue;
        }
        const imp = impactosGasto(r.monto, r.pagador);
        moves.push({
          area, tipo: 'gasto', fecha: r.fecha,
          descripcion: `${r.label} (caja)`,
          monto: Math.round(r.monto * 100) / 100,
          pagador: r.pagador, de: null, para: null,
          imp_brian: imp.brian, imp_paula: imp.paula, imp_gaston: imp.gaston,
        });
      }
      const res = await liquidar(ids, moves);
      if (!res.ok) {
        toast.error(res.error || 'No se pudo liquidar la caja');
        return;
      }
      toast.success(`Caja liquidada: ${formatoPlata(totVentas)} en ventas y ${formatoPlata(totGastos)} en gastos`);
      setConfirmando(false);
      onDone();
    } catch (e) {
      console.error('Error liquidando la caja:', e);
      toast.error('No se pudo liquidar la caja. Probá de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const textoBoton = nMovs === 0 ? 'Nada seleccionado'
    : sinCobrador.length > 0 ? `Falta elegir quién cobró ${plural(sinCobrador.length, 'venta', 'ventas')}`
    : `Liquidar ${formatoPlata(totVentas)} en ventas y ${formatoPlata(totGastos)} en gastos`;

  // Saldos redondos (sin centavos), como en la pestaña Socios.
  const lee = (v: number) => v > 0.5 ? `debe ${formatoPlata(Math.round(v))}` : v < -0.5 ? `a favor ${formatoPlata(Math.round(-v))}` : 'al día';

  return (
    <>
      {/* Antes que el Dialogo a propósito: si se cierran juntos (al liquidar), React limpia
          en este orden y el scroll del body vuelve bien. */}
      {confirmando && (
        <Confirmar
          abierto
          titulo="¿Liquidar la caja?"
          variante="primario"
          mensaje={(
            <>
              <p>
                Se asientan {plural(nMovs, 'movimiento', 'movimientos')} en las cuentas de socios
                ({area === 'marca' ? 'Marca' : area === 'cafeteria' ? 'Cafetería' : 'Otros'}) y quedan marcados como liquidados en la caja.
              </p>
              <p className="mt-2 font-semibold tabular-nums text-navy-700">
                Ventas {formatoPlata(totVentas)} · Gastos {formatoPlata(totGastos)}
              </p>
              {sinConfirmar.length > 0 && (
                <p className="mt-2 text-amber-800">
                  Ojo: {plural(sinConfirmar.length, 'gasto va', 'gastos van')} con el pagador adivinado ({formatoPlata(montoSinConfirmar)}).
                </p>
              )}
            </>
          )}
          textoConfirmar="Liquidar"
          cargando={saving}
          alConfirmar={() => void handleConfirm()}
          alCerrar={() => !saving && setConfirmando(false)}
        />
      )}

      <Dialogo
        abierto
        titulo="Liquidar caja a socios"
        descripcion="Pasa las ventas y gastos de la caja que faltan repartir a las cuentas de socios. Marcá quién tiene la plata de cada cosa y mirá cómo quedan los saldos antes de confirmar."
        alCerrar={onClose}
        ocupado={saving || confirmando}
        ancho="lg"
        pie={!loading && !failed && hayAlgo ? (
          <>
            <Boton variante="secundario" onClick={onClose} disabled={saving}>Cancelar</Boton>
            <Boton onClick={() => setConfirmando(true)} disabled={!puedeLiquidar || saving}>
              {textoBoton}
            </Boton>
          </>
        ) : (
          <Boton variante="secundario" onClick={onClose}>Cerrar</Boton>
        )}
      >
        {loading && <CargandoFilas filas={3} />}
        {failed && !loading && <ErrorEstado mensaje="No se pudo cargar la caja. Verificá tu sesión." />}
        {!loading && !failed && !hayAlgo && (
          <Vacio icono={<CheckCircle2 size={22} />} titulo="No hay nada pendiente de liquidar" descripcion="Todas las ventas y gastos de la caja ya están en las cuentas de socios." />
        )}

        {!loading && !failed && hayAlgo && (
          <div className="space-y-6">
            {ventaGroups.length > 0 && (
              <section>
                <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-navy-700">Ventas por repartir</h3>
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                  {ventaGroups.map(g => {
                    const abierto = abiertos.has(g.key);
                    const todos = new Set(g.filas.map(v => v.id));
                    const faltan = new Set(g.sinElegir.map(v => v.id));
                    return (
                    <li key={g.key} className={cn('space-y-2.5 px-3 py-3', !g.incluir && 'bg-gray-50')}>
                      <div className="flex items-center gap-3">
                        <Casilla
                          marcada={g.incluir}
                          etiqueta={`Incluir ${g.key}`}
                          alCambiar={() => setExcluidos(ex => alternar(ex, g.key))}
                        />
                        <div className={cn('min-w-0 flex-1', !g.incluir && 'opacity-50')}>
                          <p className="font-display text-sm font-bold text-navy-700">{g.key}</p>
                          <p className="text-xs text-gray-500">
                            {plural(g.filas.length, 'venta', 'ventas')}
                            {g.porSocio.map(x => <span key={x.s}> · {NOMBRES_TENEDOR[x.s]} {formatoPlata(x.total)}</span>)}
                            {g.sinElegir.length > 0 && <span className="font-semibold text-amber-800"> · sin elegir {formatoPlata(g.sinElegir.reduce((t, v) => t + v.monto, 0))}</span>}
                          </p>
                        </div>
                        <Plata monto={g.total} className={cn('shrink-0 text-sm font-bold text-emerald-700', !g.incluir && 'opacity-50')} />
                      </div>
                      {g.incluir && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:pl-11">
                          <span className="text-[13px] font-semibold text-gray-600">
                            {g.sinElegir.length === 1 ? 'La que falta, a' : g.sinElegir.length > 1 ? `Las ${g.sinElegir.length} que faltan, a` : g.filas.length === 1 ? 'Va a' : 'Todas a'}
                          </span>
                          <Segmentado
                            etiqueta={`Quién cobró ${g.key}`}
                            opciones={OPCIONES_SOCIOS}
                            valor={g.sinElegir.length === 0 && g.porSocio.length === 1 ? g.porSocio[0].s : null}
                            alCambiar={s => asignar(g.sinElegir.length > 0 ? faltan : todos, s)}
                            className={g.sinElegir.length > 0 ? 'ring-1 ring-inset ring-amber-300' : undefined}
                          />
                          <Boton chico variante="fantasma" onClick={() => setAbiertos(a => alternar(a, g.key))}>
                            {abierto ? 'Ocultar' : 'Ver una por una'}
                          </Boton>
                        </div>
                      )}
                      {g.incluir && abierto && (
                        <ul className="space-y-2 sm:pl-11">
                          {g.filas.map(v => (
                            <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-gray-50 px-2.5 py-2">
                              <span className="min-w-0 flex-1 text-[13px] text-gray-700">
                                <span className="text-gray-500">{fechaCorta(v.createdAt)} ·</span> {v.label}
                              </span>
                              <Plata monto={v.monto} className="text-[13px] font-semibold text-navy-700" />
                              <Segmentado
                                etiqueta={`Quién cobró ${v.label}`}
                                opciones={OPCIONES_SOCIOS}
                                valor={v.cobrador}
                                alCambiar={s => asignar(new Set([v.id]), s)}
                                className={v.cobrador === null ? 'ring-1 ring-inset ring-amber-300' : undefined}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                    );
                  })}
                </ul>
                {fiadosSinCobrar.n > 0 && (
                  <p className="mt-2 text-[13px] text-amber-800">
                    Quedan afuera {formatoPlata(fiadosSinCobrar.total)} en {plural(fiadosSinCobrar.n, 'fiado', 'fiados')} sin cobrar: se liquidan cuando entre la plata.
                  </p>
                )}
              </section>
            )}

            {gastoRows.length > 0 && (
              <section>
                <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-navy-700">Gastos por asentar</h3>
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                  {gastoRows.map(r => (
                    <li key={r.id} className={cn('space-y-2.5 px-3 py-3', !r.incluir && 'bg-gray-50')}>
                      <div className="flex items-center gap-3">
                        <Casilla
                          marcada={r.incluir}
                          etiqueta={`Incluir ${r.label}`}
                          alCambiar={() => setGastoRows(rs => rs.map(x => x.id === r.id ? { ...x, incluir: !x.incluir } : x))}
                        />
                        <div className={cn('min-w-0 flex-1', !r.incluir && 'opacity-50')}>
                          <p className="break-words text-sm font-semibold text-navy-700">{r.label}</p>
                          <p className="text-xs text-gray-500">{r.fecha} · registró {r.persona}</p>
                        </div>
                        <Plata monto={-r.monto} className={cn('shrink-0 text-sm font-bold', !r.incluir && 'opacity-50')} />
                      </div>
                      {r.incluir && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:pl-11">
                          <span className="text-[13px] font-semibold text-gray-600">Pagó</span>
                          {/* Tocar CONFIRMA la fila (elegido: true), aunque se toque el mismo
                              socio: sin eso el aviso ámbar quedaba pegado para siempre y, con
                              casi todas las filas en ámbar, dejaba de leerse. Así funciona como checklist. */}
                          <Segmentado
                            etiqueta={`Quién pagó ${r.label}`}
                            opciones={OPCIONES_SOCIOS}
                            valor={r.pagador}
                            alCambiar={s => setGastoRows(rs => rs.map(x => x.id === r.id ? { ...x, pagador: s, elegido: true } : x))}
                            className={!r.elegido ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : undefined}
                          />
                          {!r.elegido && <Insignia tono="atencion">sugerido, confirmalo</Insignia>}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[13px] leading-relaxed text-gray-500">
                  «Pagó» = quién puso la plata. Los gastos cargados desde la Caja web ya vienen con el
                  pagador elegido; los <span className="font-semibold text-amber-800">sugeridos</span> vienen
                  del bot o son viejos y están adivinados por el nombre: revisalos.
                  Si un gasto salió del efectivo de la caja, elegí «Caja VOLEA».
                  Si algo ya está cargado en las cuentas, destildalo para no contarlo dos veces.
                </p>
              </section>
            )}

            <section>
              <span className="mb-1.5 block text-[13px] font-semibold text-navy-700">Área</span>
              <Segmentado etiqueta="Área de la liquidación" opciones={AREAS} valor={area} alCambiar={setArea} />
            </section>

            {/* Previsión de saldos */}
            <section className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="mb-2 font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gray-500">
                Cómo quedan los saldos (al día de hoy)
              </p>
              <ul className="space-y-1.5">
                {SOCIOS.map(s => {
                  const antes = saldosHoy[s];
                  const despues = antes + deltas[s];
                  return (
                    <li key={s} className="grid grid-cols-[4.5rem_1fr] items-baseline gap-x-2 text-sm">
                      <span className="font-semibold text-navy-700">{NOMBRES_SOCIOS[s]}</span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="tabular-nums text-gray-500">{lee(antes)}</span>
                        <ArrowRight size={14} className="shrink-0 text-gray-400" aria-label="pasa a" />
                        <span className={cn(
                          'font-semibold tabular-nums',
                          despues > 0.5 ? 'text-red-700' : despues < -0.5 ? 'text-emerald-700' : 'text-gray-500',
                        )}>
                          {lee(despues)}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {deltaCaja !== 0 && (
                <p className="mt-2 grid grid-cols-[4.5rem_1fr] items-baseline gap-x-2 border-t border-gray-200 pt-2 text-sm">
                  <span className="font-semibold text-navy-700">Caja</span>
                  <span className={cn('font-semibold tabular-nums', deltaCaja > 0 ? 'text-emerald-700' : 'text-red-700')}>
                    {deltaCaja > 0 ? 'entran' : 'salen'} {formatoPlata(Math.abs(Math.round(deltaCaja)))} a la Caja VOLEA
                  </span>
                </p>
              )}
              {sinCobrador.length > 0 && (
                <p className="mt-2 text-[13px] text-gray-500">
                  Todavía no cuentan {plural(sinCobrador.length, 'venta', 'ventas')} sin cobrador elegido.
                </p>
              )}
            </section>

            {sinConfirmar.length > 0 && (
              <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>
                  {plural(sinConfirmar.length, 'gasto', 'gastos')} por {formatoPlata(montoSinConfirmar)} con
                  el pagador <b>adivinado</b> por el nombre de quien lo registró. Tocá el «Pagó» de cada uno
                  para confirmarlo: si está mal, esa plata se le asienta al socio equivocado.
                </span>
              </p>
            )}
          </div>
        )}
      </Dialogo>
    </>
  );
}
