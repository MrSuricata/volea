import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ClipboardList, ListChecks, Package, ShoppingBag, Trophy, Wallet } from 'lucide-react';
import { useStore } from '../../tienda/store';
import { getTotalStock } from '../../lib/formato';
import { agruparPorEvento, listarTorneosPublicos, type EventoAgrupado } from '../../torneos/publico/datos';
import { Boton, EncabezadoPagina, ErrorEstado, Estadistica, Insignia, Plata, Tarjeta, Vacio } from '../ui';
import { InsigniaPagoMP, InsigniaPedido } from '../estados';
import { TZ_UY } from '../../lib/formato';
import { UMBRAL_STOCK_BAJO } from '../StockDashboard';

// Inicio del panel (antes "Dashboard"): lo primero que se ve tiene que decir QUÉ HAY QUE
// ATENDER hoy, y cada número lleva a su pantalla. Antes eran tarjetas pastel que no se
// podían tocar, y los torneos sacaban al admin hacia la web pública.


type Props = {
  nombre: string;
  irA: (tab: string, extra?: Record<string, string>) => void;
  inscNuevas: number;
  tareasPendientes: number;
};

export function InicioTab({ nombre, irA, inscNuevas, tareasPendientes }: Props) {
  const { orders, products } = useStore();
  const [eventos, setEventos] = useState<EventoAgrupado[] | null>(null);
  const [errorTorneos, setErrorTorneos] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    setErrorTorneos(false);
    void listarTorneosPublicos().then((r) => {
      if (!vivo) return;
      if (r.error) setErrorTorneos(true);
      else setEventos(agruparPorEvento(r.torneos, Date.now()));
    });
    return () => { vivo = false; };
  }, [intento]);

  const pendientes = orders.filter((o) => o.status === 'pending').length;
  const aRevisar = orders.filter((o) => o.requiereRevision).length;
  let sinStock = 0;
  let stockBajo = 0;
  let unidades = 0;
  for (const p of products) {
    for (const q of Object.values(p.stockBySize)) {
      unidades += Math.max(0, q);
      if (q <= 0) sinStock++;
      else if (q <= UMBRAL_STOCK_BAJO) stockBajo++;
    }
  }
  const visibles = products.filter((p) => p.active !== false).length;
  const agotados = products.filter((p) => p.active !== false && getTotalStock(p) === 0).length;
  const ultimos = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);

  const hoy = new Date().toLocaleDateString('es-UY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ_UY });
  const primerNombre = nombre.split(/[\s@]/)[0] || 'equipo';

  return (
    <div>
      <EncabezadoPagina
        rotulo={hoy}
        titulo={`Hola, ${primerNombre}`}
        acciones={<Boton icono={<Wallet size={17} />} onClick={() => irA('caja')}>Ir a la caja</Boton>}
      />

      {/* Para atender: cada tarjeta lleva a su pantalla. */}
      <h2 className="mb-3 font-display text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500">Para atender</h2>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Estadistica
          etiqueta="Pedidos pendientes"
          valor={pendientes}
          tono={aRevisar > 0 ? 'alerta' : pendientes > 0 ? 'atencion' : 'neutro'}
          icono={<ShoppingBag size={18} />}
          detalle={aRevisar > 0 ? `${aRevisar} con pago a revisar` : undefined}
          onClick={() => irA('orders')}
        />
        <Estadistica
          etiqueta="Inscripciones nuevas"
          valor={inscNuevas}
          tono={inscNuevas > 0 ? 'atencion' : 'neutro'}
          icono={<ClipboardList size={18} />}
          onClick={() => irA('inscripciones')}
        />
        <Estadistica
          etiqueta="Tareas abiertas"
          valor={tareasPendientes}
          icono={<ListChecks size={18} />}
          onClick={() => irA('tareas')}
        />
        <Estadistica
          etiqueta="Variantes sin stock"
          valor={sinStock}
          tono={sinStock > 0 ? 'alerta' : 'bien'}
          icono={<Package size={18} />}
          detalle={stockBajo > 0 ? `${stockBajo} con stock bajo` : undefined}
          onClick={() => irA('stock')}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        {/* Torneos */}
        <Tarjeta
          className="xl:col-span-3"
          titulo={<span className="flex items-center gap-2"><Trophy size={16} /> Torneos</span>}
          acciones={(
            <Link to="/torneos" target="_blank" rel="noopener" className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-[13px] font-semibold text-navy-500 hover:bg-navy-50 hover:text-navy-700">
              Página pública <ArrowUpRight size={14} />
            </Link>
          )}
          sinPadding
        >
          {errorTorneos ? (
            <div className="p-4"><ErrorEstado mensaje="No se pudieron cargar los torneos." alReintentar={() => setIntento((n) => n + 1)} /></div>
          ) : eventos === null ? (
            <div className="space-y-2 p-4" role="status" aria-label="Cargando torneos">
              {[0, 1, 2].map((i) => <div key={i} className="h-14 rounded-lg bg-gray-100 motion-safe:animate-pulse" />)}
            </div>
          ) : eventos.length === 0 ? (
            <div className="p-4"><Vacio icono={<Trophy size={22} />} titulo="Todavía no hay torneos" accion={<Boton onClick={() => irA('torneos')}>Crear torneo</Boton>} /></div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {eventos.slice(0, 6).map((ev) => (
                <li key={ev.nombre}>
                  <button type="button" onClick={() => irA('torneos')} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 md:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-bold text-navy-700">{ev.nombre}</p>
                      <p className="mt-0.5 text-[13px] text-gray-500">
                        {ev.torneos.length === 1
                          ? `${ev.torneos[0].parejas.length} ${(ev.torneos[0].formato ?? 'grupos') === 'individual' ? 'jugadores' : 'parejas'}`
                          : `${ev.torneos.length} categorías`}
                        {' · '}{new Date(ev.ultimaFecha).toLocaleDateString('es-UY', { timeZone: TZ_UY })}
                      </p>
                    </div>
                    {ev.enVivo ? <Insignia tono="vivo" punto>En vivo</Insignia>
                      : ev.terminado ? <Insignia>Terminado</Insignia>
                        : <Insignia tono="atencion">Abierto</Insignia>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        {/* Tienda */}
        <div className="space-y-6 xl:col-span-2">
          <div className="grid grid-cols-2 gap-3">
            <Estadistica etiqueta="Productos visibles" valor={visibles} detalle={agotados > 0 ? `${agotados} agotados` : undefined} onClick={() => irA('products')} />
            <Estadistica etiqueta="Unidades en stock" valor={unidades.toLocaleString('es-UY')} onClick={() => irA('stock')} />
          </div>

          <Tarjeta
            titulo="Últimos pedidos"
            acciones={<button type="button" onClick={() => irA('orders')} className="h-9 rounded-md px-2 text-[13px] font-semibold text-navy-500 hover:bg-navy-50 hover:text-navy-700">Ver todos</button>}
            sinPadding
          >
            {ultimos.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500 md:px-5">Todavía no hay pedidos.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {ultimos.map((o) => (
                  <li key={o.id}>
                    <button type="button" onClick={() => irA('orders', { pedido: o.id })} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 md:px-5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-navy-700">{o.customer.name || 'Sin nombre'}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <InsigniaPedido estado={o.status} />
                          <InsigniaPagoMP order={o} />
                        </div>
                      </div>
                      <Plata monto={o.total} className="font-display text-sm font-bold text-navy-700" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        </div>
      </div>
    </div>
  );
}
