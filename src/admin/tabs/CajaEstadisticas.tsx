import { useState, type ReactNode } from 'react';
import { CalendarDays, Receipt, Trophy, Users } from 'lucide-react';
import { NOMBRES_TENEDOR } from '../../utils/socios';
import { diaLargo, NOMBRE_METODO, variacion, type EstadisticasCaja } from '../../utils/cajaReporte';
import { Insignia, Tarjeta, Vacio, formatoPlata } from '../ui';
import { Kpi } from '../ui-ventas/Kpi';
import { plural } from '../ui-ventas/ventas';

// Estadísticas de la Caja para el período elegido. Solo dibuja: los números salen de
// utils/cajaReporte (estadisticasCaja). Los anchos y altos de las barras van por `style`
// porque Tailwind no genera clases armadas con un número.

const TOPE = 8;

/** Lista con barra de proporción: nombre, detalle chico y monto a la derecha. */
function Barras({ filas, color = 'bg-navy-700', vacio }: {
  filas: { clave: string; nombre: ReactNode; detalle?: string; monto: number }[];
  color?: string;
  vacio: string;
}) {
  const [todo, setTodo] = useState(false);
  if (filas.length === 0) return <p className="text-sm text-gray-500">{vacio}</p>;
  const max = Math.max(...filas.map((f) => f.monto), 1);
  const total = filas.reduce((t, f) => t + f.monto, 0);
  const visibles = todo ? filas : filas.slice(0, TOPE);
  return (
    <>
      <ul className="space-y-2.5">
        {visibles.map((f) => (
          <li key={f.clave}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-semibold text-navy-700">{f.nombre}</span>
              <span className="shrink-0 font-display font-bold tabular-nums text-navy-700">{formatoPlata(f.monto)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.max(2, (f.monto / max) * 100)}%` }} />
              </span>
              <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-gray-500">
                {total > 0 ? `${Math.round((f.monto / total) * 100)} %` : ''}{f.detalle ? ` · ${f.detalle}` : ''}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {filas.length > TOPE && (
        <button type="button" onClick={() => setTodo(!todo)} className="mt-3 text-[13px] font-semibold text-navy-700 underline underline-offset-2">
          {todo ? 'Ver menos' : `Ver los ${filas.length}`}
        </button>
      )}
    </>
  );
}

/** Ventas (verde) y gastos (rojo) de cada tramo, uno al lado del otro. */
function Evolucion({ s }: { s: EstadisticasCaja }) {
  const max = Math.max(...s.serie.map((t) => Math.max(t.ventas, t.gastos)), 1);
  // Rótulos: como mucho ~8 a lo ancho para que no se pisen.
  const cada = Math.max(1, Math.ceil(s.serie.length / 8));
  return (
    <div>
      <div className="sin-barra overflow-x-auto">
        <div className="flex h-44 items-end gap-1" style={{ minWidth: `${s.serie.length * 14}px` }}>
          {s.serie.map((t) => (
            <div
              key={t.clave}
              title={`${t.etiqueta} · ventas ${formatoPlata(t.ventas)} · gastos ${formatoPlata(t.gastos)}`}
              className="flex h-full min-w-0 flex-1 items-end justify-center gap-px"
            >
              <span className="w-1/2 max-w-[14px] rounded-t-sm bg-emerald-600" style={{ height: `${t.ventas > 0 ? Math.max(2, (t.ventas / max) * 100) : 0}%` }} />
              <span className="w-1/2 max-w-[14px] rounded-t-sm bg-red-500" style={{ height: `${t.gastos > 0 ? Math.max(2, (t.gastos / max) * 100) : 0}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1 border-t border-gray-200 pt-1" style={{ minWidth: `${s.serie.length * 14}px` }}>
          {s.serie.map((t, i) => (
            <span key={t.clave} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[10px] tabular-nums text-gray-500">
              {i % cada === 0 ? t.etiqueta : ''}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" /> Ventas</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Gastos</span>
        <span>Tope de la escala: {formatoPlata(max)}</span>
      </div>
    </div>
  );
}

const textoCambio = (ahora: number, antes: number) => {
  const v = variacion(ahora, antes);
  if (v === null) return 'antes no hubo';
  return `${v >= 0 ? '+' : '−'}${Math.abs(v)} % (antes ${formatoPlata(antes)})`;
};

export function CajaEstadisticas({ s, anterior, textoAnterior }: {
  s: EstadisticasCaja;
  /** El tramo del mismo largo justo antes; null si no se puede comparar. */
  anterior: EstadisticasCaja | null;
  textoAnterior: string | null;
}) {
  if (s.nVentas + s.nGastos === 0) {
    return <Vacio titulo="Sin movimientos en estas fechas" descripcion="Elegí otro período o cambiá las fechas para ver las estadísticas." />;
  }
  const rotuloSerie = s.granularidad === 'dia' ? 'Día por día' : s.granularidad === 'semana' ? 'Semana por semana' : 'Mes por mes';
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etiqueta="Ticket promedio" valor={Math.round(s.ticketPromedio)} plata icono={<Receipt size={15} />} detalle={`sobre ${plural(s.nVentas, 'venta', 'ventas')}`} />
        <Kpi etiqueta="Ventas por día" valor={Math.round(s.ventasPorDia)} plata icono={<CalendarDays size={15} />} detalle={`${s.diasConVentas} de ${plural(s.dias, 'día', 'días')} con ventas`} />
        <Kpi etiqueta="Mejor día" valor={s.mejorDia ? s.mejorDia.ventas : '—'} plata tono="bien" icono={<Trophy size={15} />} detalle={s.mejorDia ? diaLargo(s.mejorDia.dia) : 'sin ventas'} />
        <Kpi etiqueta="Sin liquidar a socios" valor={s.sinLiquidar.ventas - s.sinLiquidar.gastos} plata tono="atencion" icono={<Users size={15} />} detalle={plural(s.sinLiquidar.n, 'movimiento', 'movimientos')} />
      </div>

      {anterior && textoAnterior && (
        <Tarjeta titulo={`Contra el período anterior · ${textoAnterior}`}>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            {([['Ventas', s.ventas, anterior.ventas], ['Gastos', s.gastos, anterior.gastos], ['Balance', s.balance, anterior.balance]] as const).map(([rotulo, ahora, antes]) => (
              <div key={rotulo}>
                <dt className="font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gray-500">{rotulo}</dt>
                <dd className="mt-0.5 font-semibold text-navy-700">{formatoPlata(ahora)} <span className="font-normal text-gray-500">· {textoCambio(ahora, antes)}</span></dd>
              </div>
            ))}
          </dl>
        </Tarjeta>
      )}

      {s.serie.length > 1 && (
        <Tarjeta titulo={rotuloSerie}>
          <Evolucion s={s} />
        </Tarjeta>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Cómo pagaron">
          <Barras
            vacio="Sin ventas en el período."
            color="bg-emerald-600"
            filas={s.porMetodo.map((m) => ({ clave: m.metodo, nombre: NOMBRE_METODO[m.metodo], detalle: `${m.n}`, monto: m.monto }))}
          />
        </Tarjeta>
        <Tarjeta titulo="Ventas por día de la semana">
          <Barras
            vacio="Sin ventas en el período."
            color="bg-emerald-600"
            filas={s.porDiaSemana.filter((d) => d.n > 0).map((d) => ({ clave: d.nombre, nombre: d.nombre, detalle: `${d.n}`, monto: d.ventas }))}
          />
        </Tarjeta>
        <Tarjeta
          titulo="Lo más vendido"
          acciones={<span className="text-xs text-gray-500">catálogo {formatoPlata(s.catalogo.monto)} · sueltos {formatoPlata(s.sueltos.monto)}</span>}
        >
          <Barras
            vacio="Sin ventas en el período."
            color="bg-emerald-600"
            filas={s.productos.map((p, i) => ({
              clave: `${i}-${p.nombre}`,
              nombre: <>{p.nombre}{!p.catalogo && <Insignia className="ml-1.5">suelto</Insignia>}</>,
              detalle: `${p.unidades} u.`,
              monto: p.monto,
            }))}
          />
        </Tarjeta>
        <Tarjeta titulo="En qué se gastó">
          <Barras
            vacio="Sin gastos en el período."
            color="bg-red-500"
            filas={s.gastosPorConcepto.map((g, i) => ({ clave: `${i}-${g.nombre}`, nombre: g.nombre, detalle: g.n > 1 ? `${g.n} veces` : undefined, monto: g.monto }))}
          />
        </Tarjeta>
        <Tarjeta titulo="Gastos: quién puso la plata">
          <Barras
            vacio="Sin gastos en el período."
            color="bg-red-500"
            filas={s.gastosPorPagador.map((g) => ({ clave: g.quien ?? 'nadie', nombre: g.quien ? NOMBRES_TENEDOR[g.quien] : 'Sin anotar', detalle: `${g.n}`, monto: g.monto }))}
          />
        </Tarjeta>
        <Tarjeta titulo="Quién registró">
          <ul className="divide-y divide-gray-100 text-sm">
            {s.porPersona.map((p) => (
              <li key={p.nombre} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="min-w-0 truncate font-semibold text-navy-700">{p.nombre} <span className="font-normal text-gray-500">· {p.n}</span></span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-semibold text-emerald-700">+{formatoPlata(p.ventas)}</span>
                  <span className="ml-2 font-semibold text-red-700">{formatoPlata(-p.gastos)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      </div>

      {s.anulados.n > 0 && (
        <p className="text-xs text-gray-500">
          En estas fechas hay {plural(s.anulados.n, 'movimiento anulado', 'movimientos anulados')} por {formatoPlata(s.anulados.monto)}: no cuentan en ningún número de arriba.
        </p>
      )}
    </div>
  );
}
