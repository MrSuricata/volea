import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus, Repeat } from 'lucide-react';
import { toast } from 'sonner';
import type { Order, Product } from '../../types';
import { useStore } from '../../tienda/store';
import { TZ_UY } from '../../lib/formato';
import { SupabaseService } from '../../services/supabaseService';
import { sesionAdminVencida } from '../../services/authService';
import { formatVariant } from '../../utils/caja';
import {
  diferenciaSugerida, metodosPara, metodoValido, resumenPlata, saldosAFavor, variantesDe,
  type Cambio, type MetodoCambio,
} from '../../utils/cambios';
import {
  AreaTexto, Boton, Campo, Chip, Confirmar, Dialogo, EncabezadoPagina, Entrada, EntradaPlata, Insignia,
  Plata, Segmentado, Selector, Tarjeta, Vacio,
} from '../ui';

// Cambios de prendas: la que vuelve suma stock, la que se lleva resta, y la diferencia
// se cobra, queda debiendo, se devuelve, queda a favor o va sin cargo (1 a 1, premio…).

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-UY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ_UY });
const rotulo = 'mb-2 block font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gray-500';
const conVariante = (nombre: string, v: string | null) => (v ? `${nombre} · ${formatVariant(v)}` : nombre);

/** Datos para abrir el cambio desde un pedido. */
export interface CambioDesdePedido {
  cliente: string;
  orderId: string;
  items: { productId: string; variant: string; texto: string }[];
}

export function cambioDesdePedido(o: Order): CambioDesdePedido {
  return {
    cliente: o.customer.name,
    orderId: o.id,
    items: o.items.map((it) => ({
      productId: it.product.id,
      variant: [it.selectedSize, it.selectedColor].filter(Boolean).join('|'),
      texto: `${it.product.name} · ${[it.selectedSize, it.selectedColor].filter(Boolean).join(' / ')}`,
    })),
  };
}

export function CambioModal({ products, reportedBy, desde, onClose, onDone }: {
  products: Product[];
  reportedBy: string;
  desde?: CambioDesdePedido;
  onClose: () => void;
  onDone: () => void;
}) {
  const ordenados = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const primero = desde?.items.find((it) => products.some((p) => p.id === it.productId));
  const [cliente, setCliente] = useState(desde?.cliente ?? '');
  const [devId, setDevId] = useState(primero?.productId ?? '');
  const [devVar, setDevVar] = useState<string | null>(primero?.variant ?? null);
  const [llevaId, setLlevaId] = useState(primero?.productId ?? '');
  const [llevaVar, setLlevaVar] = useState<string | null>(null);
  const [monto, setMonto] = useState<number | null>(null); // null = la sugerida
  const [quien, setQuien] = useState<'paga' | 'favor' | null>(null);
  const [metodo, setMetodo] = useState<MetodoCambio | null>(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  const dev = products.find((p) => p.id === devId);
  const lleva = products.find((p) => p.id === llevaId);
  const sugerida = dev && lleva ? diferenciaSugerida(dev.price, lleva.price) : 0;
  const lado = quien ?? (sugerida < 0 ? 'favor' : 'paga');
  const absoluto = monto ?? Math.abs(sugerida);
  const final = absoluto === 0 ? 0 : lado === 'paga' ? absoluto : -absoluto;
  const metodoFinal = metodoValido(final, metodo);
  const variantesLleva = lleva ? variantesDe(lleva.stockBySize).filter((v) => v.stock > 0 || v.key === llevaVar) : [];
  const listo = !!cliente.trim() && !!dev && !!devVar && !!lleva && !!llevaVar;

  async function guardar() {
    if (!listo || !dev || !lleva || !devVar || !llevaVar) return;
    if (await sesionAdminVencida()) {
      toast.error('Tu sesión de admin venció — cerrá sesión y volvé a entrar. No se guardó el cambio.');
      return;
    }
    setGuardando(true);
    const r = await SupabaseService.registrarCambio({
      cliente: cliente.trim(), orderId: desde?.orderId ?? null,
      devuelveProductId: dev.id, devuelveVariant: devVar, llevaProductId: lleva.id, llevaVariant: llevaVar,
      monto: final, metodo: metodoFinal, nota,
    }, reportedBy);
    setGuardando(false);
    if (!r.ok) { toast.error(`No se pudo guardar el cambio: ${r.error ?? 'probá de nuevo'}`); return; }
    toast.success(`Cambio guardado: ${resumenPlata({ monto: final, metodo: metodoFinal, saldoUsadoEl: null })}`);
    onDone();
  }

  return (
    <Dialogo
      abierto
      titulo="Cambio de prenda"
      descripcion="La que devuelve vuelve al stock y la que se lleva se descuenta."
      alCerrar={onClose}
      ocupado={guardando}
      ancho="lg"
      pie={(
        <>
          <Boton variante="fantasma" onClick={onClose} disabled={guardando}>Cancelar</Boton>
          <Boton icono={<Repeat size={16} />} cargando={guardando} disabled={!listo} onClick={() => void guardar()}>Guardar cambio</Boton>
        </>
      )}
    >
      <div className="space-y-5">
        <Campo etiqueta="Cliente" requerido>
          <Entrada value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nombre y apellido" />
        </Campo>

        <div>
          <span className={rotulo}>Devuelve</span>
          {desde && desde.items.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {desde.items.map((it) => (
                <Chip key={it.texto} activo={devId === it.productId && devVar === it.variant} onClick={() => { setDevId(it.productId); setDevVar(it.variant); setMonto(null); }}>
                  {it.texto}
                </Chip>
              ))}
            </div>
          )}
          <Selector aria-label="Prenda que devuelve" value={devId} onChange={(e) => { setDevId(e.target.value); setDevVar(null); setMonto(null); }}>
            <option value="">Elegí la prenda…</option>
            {ordenados.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Selector>
          {dev && (
            <div className="mt-2 flex flex-wrap gap-2">
              {variantesDe(dev.stockBySize).map((v) => (
                <Chip key={v.key} activo={devVar === v.key} onClick={() => setDevVar(v.key)}>{formatVariant(v.key)}</Chip>
              ))}
            </div>
          )}
        </div>

        <div>
          <span className={rotulo}>Se lleva</span>
          <Selector aria-label="Prenda que se lleva" value={llevaId} onChange={(e) => { setLlevaId(e.target.value); setLlevaVar(null); setMonto(null); }}>
            <option value="">Elegí la prenda…</option>
            {ordenados.filter((p) => p.active !== false).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Selector>
          {lleva && (
            <div className="mt-2 flex flex-wrap gap-2">
              {variantesLleva.length === 0
                ? <p className="text-sm text-red-700">No queda stock de esta prenda.</p>
                : variantesLleva.map((v) => (
                  <Chip key={v.key} activo={llevaVar === v.key} cantidad={v.stock} onClick={() => setLlevaVar(v.key)}>{formatVariant(v.key)}</Chip>
                ))}
            </div>
          )}
        </div>

        {dev && lleva && (
          <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-sm text-gray-600">
              Precio de lista: <Plata monto={dev.price} /> → <Plata monto={lleva.price} />
              {sugerida === 0 ? ' (mismo precio).' : sugerida > 0 ? <> · el cliente pone <Plata monto={sugerida} className="font-semibold" />.</> : <> · le sobran <Plata monto={-sugerida} className="font-semibold" />.</>}
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Campo etiqueta="Diferencia" className="w-36">
                <EntradaPlata valor={absoluto} alCambiar={(v) => setMonto(v === null ? 0 : Math.abs(Math.round(v)))} aria-label="Diferencia" />
              </Campo>
              {absoluto > 0 && (
                <Segmentado
                  etiqueta="Quién pone la diferencia"
                  valor={lado}
                  alCambiar={(v) => setQuien(v)}
                  opciones={[{ valor: 'paga', texto: 'La paga el cliente' }, { valor: 'favor', texto: 'Es del cliente' }]}
                />
              )}
              {absoluto !== 0 && <Boton variante="secundario" chico onClick={() => setMonto(0)}>Sin cargo (1 a 1)</Boton>}
            </div>
            <div className="flex flex-wrap gap-2">
              {metodosPara(final).map((m) => (
                <Chip key={m.valor} activo={metodoFinal === m.valor} onClick={() => setMetodo(m.valor)}>{m.texto}</Chip>
              ))}
            </div>
          </div>
        )}

        <Campo etiqueta="Nota (opcional)" ayuda="Ej.: premio del torneo, falla, le quedaba chica.">
          <AreaTexto value={nota} onChange={(e) => setNota(e.target.value)} className="min-h-[64px]" />
        </Campo>
      </div>
    </Dialogo>
  );
}

export function CambiosTab({ reportedBy }: { reportedBy: string }) {
  const { products, refreshProducts } = useStore();
  const [cambios, setCambios] = useState<Cambio[] | null | undefined>(undefined); // undefined = cargando
  const [nuevo, setNuevo] = useState(false);
  const [anular, setAnular] = useState<Cambio | null>(null);

  const cargar = useCallback(async () => setCambios(await SupabaseService.getCambios()), []);
  useEffect(() => { void cargar(); }, [cargar]);
  const saldos = useMemo(() => saldosAFavor(cambios ?? []), [cambios]);

  async function marcarUsado(c: Cambio) {
    const r = await SupabaseService.saldoCambioUsado(c.id, true);
    if (!r.ok) { toast.error(r.error ?? 'No se pudo marcar'); return; }
    toast.success(`Saldo de ${c.cliente} marcado como usado`);
    void cargar();
  }

  async function confirmarAnular() {
    if (!anular) return;
    const c = anular;
    setAnular(null);
    const r = await SupabaseService.anularCambio(c.id);
    if (!r.ok) { toast.error(`No se pudo anular: ${r.error ?? 'probá de nuevo'}`); return; }
    toast.success('Cambio anulado: el stock y la caja volvieron como estaban');
    void cargar();
    void refreshProducts();
  }

  return (
    <div>
      <EncabezadoPagina
        rotulo="Tienda"
        titulo="Cambios"
        descripcion="Una prenda por otra: el stock se acomoda solo y la diferencia queda en la Caja."
        acciones={<Boton icono={<Plus size={18} />} onClick={() => setNuevo(true)}>Nuevo cambio</Boton>}
      />

      {cambios === null && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          No se pudieron leer los cambios. Recargá la página; si sigue, falta la actualización de la base (v32).
        </p>
      )}

      {saldos.length > 0 && (
        <Tarjeta className="mb-4 p-4">
          <p className={rotulo}>Saldos a favor</p>
          <ul className="divide-y divide-gray-100">
            {saldos.flatMap((s) => s.cambios.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1"><strong className="text-navy-700">{c.cliente}</strong> · {fecha(c.createdAt)}</span>
                <Plata monto={-c.monto} className="font-semibold text-navy-700" />
                <Boton chico variante="secundario" onClick={() => void marcarUsado(c)}>Ya lo usó</Boton>
              </li>
            )))}
          </ul>
        </Tarjeta>
      )}

      {cambios && cambios.length === 0 ? (
        <Vacio icono={<Repeat size={22} />} titulo="Todavía no hay cambios" />
      ) : (
        <ul className="space-y-2">
          {(cambios ?? []).map((c) => (
            <li key={c.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-navy-700">{c.cliente}</p>
                <p className="text-[13px] text-gray-500">{fecha(c.createdAt)}{c.orderId && <> · <span className="font-mono">{c.orderId}</span></>}</p>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-gray-700">
                {conVariante(c.devuelveNombre, c.devuelveVariant)} <ArrowRight size={14} className="text-gray-400" /> {conVariante(c.llevaNombre, c.llevaVariant)}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Insignia tono={c.metodo === 'debe' ? 'atencion' : c.metodo === 'a_favor' && !c.saldoUsadoEl ? 'info' : 'neutro'}>{resumenPlata(c)}</Insignia>
                {c.nota && <span className="text-[13px] text-gray-500">“{c.nota}”</span>}
                <span className="flex-1" />
                <Boton chico variante="fantasma" onClick={() => setAnular(c)}>Anular</Boton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {nuevo && (
        <CambioModal
          products={products}
          reportedBy={reportedBy}
          onClose={() => setNuevo(false)}
          onDone={() => { setNuevo(false); void cargar(); void refreshProducts(); }}
        />
      )}

      <Confirmar
        abierto={anular !== null}
        titulo="¿Anular el cambio?"
        mensaje="Las prendas vuelven al stock como estaban y, si hubo plata en la Caja, ese movimiento se anula."
        textoConfirmar="Anular cambio"
        alConfirmar={() => void confirmarAnular()}
        alCerrar={() => setAnular(null)}
      />
    </div>
  );
}
