import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, MessageCircle, Phone, Plus, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import type { Order } from '../../types';
import { useStore } from '../../tienda/store';
import { lazyConRecarga } from '../../lib/lazyConRecarga';
import { TZ_UY } from '../../lib/formato';
import { FALLBACK_IMG, errorFoto } from '../../lib/fotos';
import { urlImagen } from '../../utils/imagenes';
import { waUruguay } from '../../utils/telefono';
import { sesionAdminVencida } from '../../services/authService';
import { cn } from '../../lib/cn';
import { BarraFiltros, Boton, Chip, Confirmar, EncabezadoPagina, Plata, Segmentado, Vacio } from '../ui';
import { ESTADOS_PEDIDO, InsigniaPagoMP, InsigniaPedido, ORDEN_PEDIDO } from '../estados';

const AdminOrderModal = lazyConRecarga(() =>
  import('../../components/AdminOrderModal').then((m) => ({ default: m.AdminOrderModal })),
);

// Pedidos de clientes (web y WhatsApp). Antes: lista sin filtros ni búsqueda, el aviso
// "Revisar pago" escondido en el celular, un select de 24px que cambiaba el estado al
// toque (sin confirmar ni avisar) y un "pedido creado" que salía aunque fallara.

type FiltroEstado = 'todos' | Order['status'] | 'revisar';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-UY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ_UY });

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function PedidosClientesTab() {
  const { orders, products, updateOrderStatus, addOrder } = useStore();
  const [params, setParams] = useSearchParams();
  const [abierto, setAbierto] = useState<string | null>(() => params.get('pedido'));
  const [filtro, setFiltro] = useState<FiltroEstado>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [modalNuevo, setModalNuevo] = useState(false);
  const [cambio, setCambio] = useState<{ pedido: Order; a: Order['status'] } | null>(null);

  const ordenados = useMemo(() => [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [orders]);
  const cuenta = (f: FiltroEstado) =>
    f === 'todos' ? orders.length : f === 'revisar' ? orders.filter((o) => o.requiereRevision).length : orders.filter((o) => o.status === f).length;

  const lista = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return ordenados.filter((o) => {
      if (filtro === 'revisar' ? !o.requiereRevision : filtro !== 'todos' && o.status !== filtro) return false;
      if (!q) return true;
      return normalizar(`${o.id} ${o.customer.name} ${o.customer.phone} ${o.customer.email}`).includes(q);
    });
  }, [ordenados, filtro, busqueda]);

  const alternar = (id: string) => {
    const nuevo = abierto === id ? null : id;
    setAbierto(nuevo);
    // El pedido abierto queda en la URL: se puede compartir o volver con "atrás".
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      if (nuevo) n.set('pedido', nuevo); else n.delete('pedido');
      return n;
    }, { replace: true });
  };

  const aplicarEstado = (pedido: Order, a: Order['status']) => {
    updateOrderStatus(pedido.id, a);
    toast.success(`Pedido ${pedido.id}: ${ESTADOS_PEDIDO[a].texto.toLowerCase()}`);
  };

  const pedirCambio = (pedido: Order, a: Order['status']) => {
    if (a === pedido.status) return;
    // Para atrás (p. ej. de Entregado a Pendiente) casi siempre es un toque sin querer: se confirma.
    if (ORDEN_PEDIDO.indexOf(a) < ORDEN_PEDIDO.indexOf(pedido.status)) setCambio({ pedido, a });
    else aplicarEstado(pedido, a);
  };

  const hayRevisar = cuenta('revisar') > 0;

  return (
    <div>
      <EncabezadoPagina
        rotulo="Tienda"
        titulo="Pedidos"
        descripcion="Los que entran por la web o se cargan a mano desde un WhatsApp."
        acciones={<Boton icono={<Plus size={18} />} onClick={() => setModalNuevo(true)}>Nuevo pedido</Boton>}
      />

      <BarraFiltros
        busqueda={busqueda}
        alBuscar={setBusqueda}
        placeholder="Buscar por número, nombre o teléfono"
        chips={(
          <>
            <Chip activo={filtro === 'todos'} onClick={() => setFiltro('todos')} cantidad={cuenta('todos')}>Todos</Chip>
            {hayRevisar && (
              <Chip activo={filtro === 'revisar'} onClick={() => setFiltro('revisar')} cantidad={cuenta('revisar')}>Pago a revisar</Chip>
            )}
            {ORDEN_PEDIDO.map((e) => (
              <Chip key={e} activo={filtro === e} onClick={() => setFiltro(e)} cantidad={cuenta(e)}>{ESTADOS_PEDIDO[e].texto}</Chip>
            ))}
          </>
        )}
      />

      {lista.length === 0 ? (
        <Vacio
          icono={<ShoppingBag size={22} />}
          titulo={orders.length === 0 ? 'Todavía no hay pedidos' : 'Ningún pedido con esos filtros'}
        />
      ) : (
        <ul className="space-y-2">
          {lista.map((o) => {
            const expandido = abierto === o.id;
            const wa = waUruguay(o.customer.phone);
            return (
              <li key={o.id} className={cn('overflow-hidden rounded-xl border bg-white', o.requiereRevision ? 'border-red-300' : 'border-gray-200')}>
                <button
                  type="button"
                  onClick={() => alternar(o.id)}
                  aria-expanded={expandido}
                  className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-navy-700">{o.customer.name || 'Sin nombre'}</p>
                      <Plata monto={o.total} className="shrink-0 font-display text-base font-bold text-navy-700" />
                    </div>
                    <p className="mt-0.5 text-[13px] text-gray-500">
                      <span className="font-mono">{o.id}</span> · {fecha(o.createdAt)} · {o.items.length} {o.items.length === 1 ? 'producto' : 'productos'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <InsigniaPedido estado={o.status} />
                      <InsigniaPagoMP order={o} />
                    </div>
                  </div>
                  <ChevronDown size={18} className={cn('mt-0.5 shrink-0 text-gray-400 transition-transform', expandido && 'rotate-180')} />
                </button>

                {expandido && (
                  <div className="space-y-5 border-t border-gray-100 bg-gray-50/60 p-4">
                    <div>
                      <p className="mb-2 font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gray-500">Estado</p>
                      <Segmentado
                        etiqueta="Estado del pedido"
                        valor={o.status}
                        alCambiar={(a) => pedirCambio(o, a)}
                        opciones={ORDEN_PEDIDO.map((e) => ({ valor: e, texto: ESTADOS_PEDIDO[e].texto }))}
                        className="w-full sm:w-auto"
                      />
                    </div>

                    {o.requiereRevision && (
                      <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        <strong>Revisar el pago:</strong> {o.requiereRevision}
                      </p>
                    )}

                    <div className="grid gap-5 md:grid-cols-2">
                      <div>
                        <p className="mb-2 font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gray-500">Cliente</p>
                        <div className="space-y-1 text-sm text-gray-700">
                          <p className="font-semibold text-navy-700">{o.customer.name}</p>
                          {o.customer.email && <p>{o.customer.email}</p>}
                          {(o.customer.address || o.customer.city) && (
                            <p>{[o.customer.address, o.customer.city, o.customer.department].filter(Boolean).join(', ')}</p>
                          )}
                          {o.customer.notes && <p className="rounded-md bg-white p-2 text-gray-600 ring-1 ring-gray-200">“{o.customer.notes}”</p>}
                        </div>
                        {o.customer.phone && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {wa && (
                              <a
                                href={`https://wa.me/${wa}?text=${encodeURIComponent(`Hola ${o.customer.name.split(' ')[0] || ''}! Te escribimos de VOLEA por tu pedido ${o.id}.`)}`}
                                target="_blank" rel="noopener noreferrer"
                                className="inline-flex h-11 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
                              >
                                <MessageCircle size={17} /> WhatsApp
                              </a>
                            )}
                            <a href={`tel:${o.customer.phone.replace(/\s/g, '')}`} className="inline-flex h-11 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-bold text-navy-700 hover:border-navy-700">
                              <Phone size={16} /> {o.customer.phone}
                            </a>
                          </div>
                        )}
                      </div>

                      <div>
                        <p className="mb-2 font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gray-500">Productos</p>
                        <ul className="space-y-2">
                          {o.items.map((item, idx) => (
                            <li key={idx} className="flex items-center gap-3">
                              <img
                                src={item.product.images[0] ? urlImagen(item.product.images[0], 160) : FALLBACK_IMG}
                                alt=""
                                className="h-11 w-11 shrink-0 rounded-lg bg-white object-cover ring-1 ring-gray-200"
                                onError={errorFoto(item.product.images[0])}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-navy-700">{item.product.name}</p>
                                <p className="text-xs text-gray-500">
                                  {[item.selectedSize, item.selectedColor].filter(Boolean).join(' / ')} · x{item.quantity}
                                </p>
                              </div>
                              <Plata monto={item.product.price * item.quantity} className="text-sm font-semibold text-navy-700" />
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3 flex items-baseline justify-between border-t border-gray-200 pt-3">
                          <span className="text-sm font-semibold text-gray-600">Total</span>
                          <Plata monto={o.total} className="font-display text-lg font-black text-navy-700" />
                        </div>
                      </div>
                    </div>

                    {o.paymentStatus && (
                      <div>
                        <p className="mb-2 font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gray-500">Pago online</p>
                        <dl className="grid gap-x-6 gap-y-1 text-sm text-gray-700 sm:grid-cols-2">
                          <div className="flex items-center gap-2"><dt className="text-gray-500">Estado:</dt><dd><InsigniaPagoMP order={o} /></dd></div>
                          {o.mpPaymentId && <div><dt className="inline text-gray-500">ID de pago MP: </dt><dd className="inline font-mono">{o.mpPaymentId}</dd></div>}
                          {o.paidAt && <div><dt className="inline text-gray-500">Pagado: </dt><dd className="inline">{fecha(o.paidAt)}</dd></div>}
                          {o.paidAmount != null && <div><dt className="inline text-gray-500">Monto acreditado: </dt><dd className="inline"><Plata monto={o.paidAmount} /></dd></div>}
                        </dl>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {modalNuevo && (
        <Suspense fallback={null}>
          <AdminOrderModal
            products={products}
            onClose={() => setModalNuevo(false)}
            onSave={async (o) => {
              // Sesión vencida → avisar ANTES de nada (mismo criterio que el editor de productos).
              if (await sesionAdminVencida()) {
                toast.error('Tu sesión de admin venció — cerrá sesión y volvé a entrar. El pedido NO se guardó.');
                return;
              }
              setModalNuevo(false);
              setAbierto(o.id);
              // Antes el "creado" salía aunque la base lo rechazara: ahora se espera la respuesta.
              const ok = await addOrder(o);
              if (ok) toast.success(`Pedido ${o.id} creado`);
              else toast.error(`El pedido ${o.id} quedó solo en este dispositivo: no llegó a la base. Revisá la conexión y volvé a cargarlo.`, { duration: 10000 });
            }}
          />
        </Suspense>
      )}

      <Confirmar
        abierto={cambio !== null}
        titulo="¿Volver el pedido para atrás?"
        mensaje={cambio && (
          <>El pedido <strong>{cambio.pedido.id}</strong> está <strong>{ESTADOS_PEDIDO[cambio.pedido.status].texto.toLowerCase()}</strong> y lo vas a pasar a <strong>{ESTADOS_PEDIDO[cambio.a].texto.toLowerCase()}</strong>.</>
        )}
        textoConfirmar={cambio ? `Pasar a ${ESTADOS_PEDIDO[cambio.a].texto.toLowerCase()}` : 'Confirmar'}
        variante="primario"
        alConfirmar={() => { if (cambio) aplicarEstado(cambio.pedido, cambio.a); setCambio(null); }}
        alCerrar={() => setCambio(null)}
      />
    </div>
  );
}
