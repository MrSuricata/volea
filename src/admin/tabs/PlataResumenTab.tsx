import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import type { GastoPendiente, LedgerEntry, SocioMove } from '../../types';
import { supabase } from '../../services/supabaseClient';
import { normalizarLiquidacion, type LiquidacionTorneo } from '../../utils/liquidacionTorneo';
import { resumenPlata } from '../../utils/resumenPlata';
import { NOMBRES_SOCIOS, NOMBRES_TENEDOR } from '../../utils/socios';
import { BotonIcono, CargandoFilas, EncabezadoPagina, ErrorEstado, Insignia, Plata, formatoPlata } from '../ui';
import { plural } from '../ui-ventas/ventas';

// Plata › Resumen: el recorrido de la plata de punta a punta en una sola pantalla. No carga
// ni cambia nada: cada paso muestra su número y lleva a la pantalla donde se trabaja.
// Nació porque Caja, fiados, pendientes, cuentas entre socios y liquidaciones de torneos
// estaban cada una por su lado y «liquidar» quería decir dos cosas distintas.

type Props = {
  irA: (tab: string) => void;
  loadLedgerFull: () => Promise<LedgerEntry[] | null>;
  loadGastosPendientes: () => Promise<GastoPendiente[] | null>;
  loadSocioMoves: () => Promise<SocioMove[] | null>;
};

type Datos = { ledger: LedgerEntry[]; pendientes: GastoPendiente[]; socios: SocioMove[]; liquidaciones: { id: string; liq: LiquidacionTorneo }[] };

/** Las liquidaciones de torneos; [] si la tabla no responde (no frena el resto del resumen). */
async function leerLiquidaciones(): Promise<Datos['liquidaciones']> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('liquidaciones_torneo').select('id, nombre, data').order('updated_at', { ascending: false });
  if (error) { console.error('liquidaciones_torneo', error); return []; }
  return (data ?? []).map((f) => ({ id: f.id as string, liq: { ...normalizarLiquidacion(f.data), nombre: f.nombre as string } }));
}

const dm = (ymd: string) => `${Number(ymd.slice(8, 10))}/${Number(ymd.slice(5, 7))}`;

/** Un paso del recorrido: número, título, la cifra principal, el detalle y a dónde ir. */
function Paso({ n, titulo, que, cifra, tono = 'text-navy-700', children, accion, alIr }: {
  n: number; titulo: string; que: string; cifra: ReactNode; tono?: string; children?: ReactNode; accion: string; alIr: () => void;
}) {
  return (
    <section className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 md:p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-700 font-display text-[13px] font-black text-white">{n}</span>
        <div className="min-w-0">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-navy-700">{titulo}</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-gray-500">{que}</p>
        </div>
      </div>
      <p className={`mt-3 font-display text-2xl font-black tabular-nums md:text-[28px] ${tono}`}>{cifra}</p>
      {children && <div className="mt-2 space-y-1 text-[13px] text-gray-600">{children}</div>}
      <button type="button" onClick={alIr} className="group mt-auto inline-flex min-h-[44px] items-center gap-1.5 self-start pt-3 text-sm font-bold text-navy-700">
        {accion} <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
      </button>
    </section>
  );
}

const Renglon = ({ izq, der }: { izq: ReactNode; der: ReactNode }) => (
  <p className="flex items-baseline justify-between gap-3"><span className="min-w-0 truncate">{izq}</span><span className="shrink-0 font-semibold tabular-nums text-navy-700">{der}</span></p>
);

export function PlataResumenTab({ irA, loadLedgerFull, loadGastosPendientes, loadSocioMoves }: Props) {
  const [datos, setDatos] = useState<Datos | null | undefined>(undefined); // undefined = cargando · null = falló
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    const [ledger, pendientes, socios, liquidaciones] = await Promise.all([loadLedgerFull(), loadGastosPendientes(), loadSocioMoves(), leerLiquidaciones()]);
    // Sin la caja o sin las cuentas no hay resumen que valga: mejor el error que números a medias.
    setDatos(ledger === null || socios === null ? null : { ledger, pendientes: pendientes ?? [], socios, liquidaciones });
    setCargando(false);
  }, [loadLedgerFull, loadGastosPendientes, loadSocioMoves]);

  useEffect(() => { void cargar(); }, [cargar]);

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
  const r = useMemo(() => (datos ? resumenPlata(datos.ledger, datos.pendientes, datos.socios, datos.liquidaciones, hoy) : null), [datos, hoy]);
  const mesTexto = new Date().toLocaleDateString('es-UY', { month: 'long', timeZone: 'America/Montevideo' }).toLowerCase();

  return (
    <div className="fade-in">
      <EncabezadoPagina
        rotulo="Plata"
        titulo="Resumen"
        descripcion="El recorrido de la plata, de la venta al reparto. Acá no se carga nada: cada paso te lleva a su pantalla."
        acciones={<BotonIcono etiqueta="Actualizar" icono={<RefreshCw size={18} className={cargando ? 'animate-spin' : ''} />} onClick={() => void cargar()} disabled={cargando} className="border border-gray-300 bg-white" />}
      />

      {datos === undefined && <CargandoFilas filas={4} />}
      {datos === null && <ErrorEstado mensaje="No se pudo leer la plata. Si recién entraste, puede ser la sesión: probá de nuevo." alReintentar={() => void cargar()} />}

      {r && (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Paso
              n={1} titulo="Caja" que={`Todo lo que entra y sale se anota acá. Esto es ${mesTexto}.`}
              cifra={formatoPlata(r.mes.balance)} tono={r.mes.balance < 0 ? 'text-red-700' : 'text-navy-700'}
              accion="Ir a la Caja" alIr={() => irA('caja')}
            >
              <Renglon izq="Ventas" der={<span className="text-emerald-700">+{formatoPlata(r.mes.ventas)}</span>} />
              <Renglon izq="Gastos" der={<Plata monto={-r.mes.gastos} />} />
              <p className="text-gray-500">{plural(r.mes.movimientos, 'movimiento', 'movimientos')} en el mes. Reportes por fecha y estadísticas, en la Caja.</p>
            </Paso>

            <Paso
              n={2} titulo="Por cobrar" que="Ventas fiadas («Debe») que todavía no pagaron."
              cifra={formatoPlata(r.porCobrar.total)} tono={r.porCobrar.total > 0 ? 'text-amber-700' : 'text-navy-700'}
              accion="Cobrar en la Caja" alIr={() => irA('caja')}
            >
              {r.porCobrar.total === 0 ? <p>Nadie debe nada.</p> : (
                <>
                  {r.porCobrar.mayores.map((d) => <Renglon key={d.nombre} izq={d.nombre} der={formatoPlata(d.total)} />)}
                  <p className="text-gray-500">
                    {plural(r.porCobrar.personas, 'persona', 'personas')}{r.porCobrar.desde ? `, la deuda más vieja es del ${dm(r.porCobrar.desde)}` : ''}.
                  </p>
                </>
              )}
            </Paso>

            <Paso
              n={3} titulo="Por pagar" que="Gastos que ya sabemos que hay que pagar y todavía no salieron."
              cifra={formatoPlata(r.porPagar.total)} tono={r.porPagar.vencidos > 0 ? 'text-red-700' : 'text-navy-700'}
              accion="Pagar en la Caja" alIr={() => irA('caja')}
            >
              {r.porPagar.n === 0 ? <p>Nada pendiente de pago.</p> : (
                <>
                  <p>{plural(r.porPagar.n, 'gasto pendiente', 'gastos pendientes')}{r.porPagar.vencidos > 0 && <Insignia tono="alerta" className="ml-2">{plural(r.porPagar.vencidos, 'vencido', 'vencidos')}</Insignia>}</p>
                  {r.porPagar.proximo && <Renglon izq={`${r.porPagar.proximo.venceEl < hoy ? 'Venció' : 'Vence'} el ${dm(r.porPagar.proximo.venceEl)}: ${r.porPagar.proximo.label}`} der={formatoPlata(r.porPagar.proximo.amount)} />}
                </>
              )}
            </Paso>

            <Paso
              n={4} titulo="Pasar la Caja a los socios" que="Ventas y gastos de la Caja que todavía no entraron a las cuentas entre socios."
              cifra={formatoPlata(r.sinLiquidar.ventas - r.sinLiquidar.gastos)} tono={r.sinLiquidar.n > 0 ? 'text-amber-700' : 'text-navy-700'}
              accion="Ir a Socios › Liquidar caja" alIr={() => irA('socios')}
            >
              {r.sinLiquidar.n === 0 ? <p>Está todo pasado.</p> : (
                <>
                  <Renglon izq="Ventas sin pasar" der={<span className="text-emerald-700">+{formatoPlata(r.sinLiquidar.ventas)}</span>} />
                  <Renglon izq="Gastos sin pasar" der={<Plata monto={-r.sinLiquidar.gastos} />} />
                  {r.sinLiquidar.gastosPor.slice(0, 3).map((g) => (
                    <Renglon key={g.quien ?? 'nadie'} izq={<span className="pl-3 text-gray-500">{g.quien ? `los pagó ${NOMBRES_TENEDOR[g.quien]}` : 'sin anotar quién pagó'}</span>} der={formatoPlata(g.monto)} />
                  ))}
                  <p className="text-gray-500">{plural(r.sinLiquidar.n, 'movimiento', 'movimientos')}{r.sinLiquidar.desde ? `, desde el ${dm(r.sinLiquidar.desde)}` : ''}.</p>
                </>
              )}
            </Paso>

            <Paso
              n={5} titulo="Cuentas entre socios" que="Cómo está cada uno con el grupo al día de hoy (Brian 50 % · Paula 25 % · Gastón 25 %)."
              cifra={r.socios.every((s) => Math.abs(s.saldo) < 1) ? 'Al día' : 'Hay saldos'}
              accion="Ir a Socios" alIr={() => irA('socios')}
            >
              {r.socios.map((s) => (
                <Renglon
                  key={s.nombre} izq={NOMBRES_SOCIOS[s.nombre]}
                  der={Math.abs(s.saldo) < 1 ? 'al día' : s.saldo > 0
                    ? <span className="text-red-700">le debe al grupo {formatoPlata(s.saldo)}</span>
                    : <span className="text-emerald-700">el grupo le debe {formatoPlata(-s.saldo)}</span>}
                />
              ))}
              <p className="text-gray-500">No incluye lo del paso 4 hasta que se pase.</p>
            </Paso>

            <Paso
              n={6} titulo="Torneos" que="Las cuentas de cada campeonato con el club: inscripciones, premios y reparto."
              cifra={plural(r.torneos.length, 'liquidación', 'liquidaciones')}
              accion="Ir a Liquidar torneos" alIr={() => irA('liquidaciones')}
            >
              {r.torneos.length === 0 ? <p>Todavía no se liquidó ningún campeonato.</p> : r.torneos.slice(0, 4).map((t) => (
                <Renglon
                  key={t.id}
                  izq={<>{t.nombre}{t.porCobrar > 0 && <span className="text-amber-700"> · faltan cobrar {formatoPlata(t.porCobrar)}</span>}</>}
                  der={t.saldoClub >= 0 ? `al club ${formatoPlata(t.saldoClub)}` : `del club ${formatoPlata(-t.saldoClub)}`}
                />
              ))}
            </Paso>
          </div>

          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-[13px] leading-relaxed text-gray-600 md:p-5">
            <p className="font-display text-sm font-bold uppercase tracking-wide text-navy-700">Para no confundirse</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><b>Cobrar</b> un fiado es que entró la plata de una venta que estaba en «Debe». Se hace en la Caja.</li>
              <li><b>Liquidar caja</b> es pasar las ventas y gastos de la Caja a las cuentas entre socios, para que cada uno quede con su parte. Se hace en Socios.</li>
              <li><b>Liquidar un torneo</b> es hacer las cuentas de un campeonato con el club. No mueve la Caja ni las cuentas entre socios: es el cálculo y su PDF.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
