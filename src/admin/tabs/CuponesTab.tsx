// Cupones de un solo uso (v38): qué códigos quedan, quién usó cada uno y en qué. Los que se
// canjean en persona se marcan a mano; "Liberar" lo deja disponible otra vez (si estaba en una
// inscripción sin pagar, le saca el descuento).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { SupabaseService } from '../../services/supabaseService';
import { hoyMontevideo } from '../../utils/promo';
import { TZ_UY } from '../../lib/formato';
import type { Cupon } from '../../utils/cupones';
import {
  Boton, Campo, CargandoFilas, Confirmar, Dialogo, EncabezadoPagina, Entrada, ErrorEstado, Insignia, Tarjeta, Vacio,
} from '../ui';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-UY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ_UY });

export function CuponesTab() {
  const [cupones, setCupones] = useState<Cupon[] | null | undefined>(undefined); // undefined = cargando
  const [usando, setUsando] = useState<Cupon | null>(null);
  const [nombre, setNombre] = useState('');
  const [liberar, setLiberar] = useState<Cupon | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => setCupones(await SupabaseService.getCupones()), []);
  useEffect(() => { void cargar(); }, [cargar]);

  const hoy = hoyMontevideo();
  const grupos = useMemo(() => {
    const m = new Map<string, Cupon[]>();
    for (const c of cupones ?? []) m.set(c.etiqueta, [...(m.get(c.etiqueta) ?? []), c]);
    return [...m.entries()];
  }, [cupones]);

  async function marcarUsado() {
    if (!usando) return;
    setOcupado(true);
    const r = await SupabaseService.adminCupon(usando.codigo, 'usar', nombre.trim());
    setOcupado(false);
    if (!r.ok) { toast.error(r.error ?? 'No se pudo'); return; }
    toast.success(`${usando.codigo} marcado como usado`);
    setUsando(null);
    void cargar();
  }

  async function confirmarLiberar() {
    if (!liberar) return;
    setOcupado(true);
    const r = await SupabaseService.adminCupon(liberar.codigo, 'liberar');
    setOcupado(false);
    if (!r.ok) { toast.error(r.error ?? 'No se pudo'); return; }
    toast.success(`${liberar.codigo} vuelve a estar disponible`);
    setLiberar(null);
    void cargar();
  }

  const copiar = (codigo: string) => {
    void navigator.clipboard?.writeText(codigo).then(() => toast.success(`${codigo} copiado`), () => {});
  };

  return (
    <div>
      <EncabezadoPagina
        rotulo="Tienda"
        titulo="Cupones"
        descripcion="Códigos de un solo uso. La gente los escribe al pagar en la tienda o al inscribirse; los que se canjean en persona marcalos acá."
      />

      {cupones === undefined && <CargandoFilas filas={3} />}
      {cupones === null && (
        <ErrorEstado
          mensaje="No se pudieron leer los cupones. Si sigue, falta la actualización de la base (v38)."
          alReintentar={() => { setCupones(undefined); void cargar(); }}
        />
      )}
      {cupones && cupones.length === 0 && (
        <Vacio icono={<Ticket size={22} />} titulo="No hay cupones cargados" descripcion="Se cargan por SQL." />
      )}

      <div className="space-y-4">
        {grupos.map(([etiqueta, lista]) => {
          const libres = lista.filter((c) => !c.usadoAt && !(c.vence && c.vence < hoy)).length;
          return (
            <Tarjeta key={etiqueta} sinPadding titulo={<>{etiqueta} <span className="font-normal text-gray-500">· quedan {libres} de {lista.length}</span></>}>
              <ul className="divide-y divide-gray-100">
                {lista.map((c) => {
                  const vencido = !c.usadoAt && !!c.vence && c.vence < hoy;
                  return (
                    <li key={c.codigo} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                      <button
                        type="button"
                        onClick={() => copiar(c.codigo)}
                        title="Copiar"
                        className="inline-flex items-center gap-1.5 font-mono font-bold text-navy-700 hover:text-navy-500"
                      >
                        {c.codigo} <Copy size={13} className="text-gray-400" />
                      </button>
                      <span className="min-w-0 flex-1 text-gray-600">
                        {c.usadoAt
                          ? <>Usó <strong className="text-navy-700">{c.usadoPor || 'sin nombre'}</strong> · {fecha(c.usadoAt)}{c.usadoRef?.startsWith('VO-') ? ` · pedido ${c.usadoRef}` : c.usadoRef === 'en persona' ? ' · en persona' : ' · inscripción'}</>
                          : null}
                      </span>
                      {c.usadoAt ? (
                        <>
                          <Insignia>usado</Insignia>
                          <Boton chico variante="fantasma" onClick={() => setLiberar(c)}>Liberar</Boton>
                        </>
                      ) : vencido ? (
                        <Insignia tono="alerta">vencido</Insignia>
                      ) : (
                        <>
                          <Insignia tono="bien">disponible</Insignia>
                          <Boton chico variante="secundario" onClick={() => { setNombre(''); setUsando(c); }}>Usado en persona</Boton>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Tarjeta>
          );
        })}
      </div>

      <Dialogo
        abierto={!!usando}
        titulo={`Marcar ${usando?.codigo ?? ''} como usado`}
        alCerrar={() => setUsando(null)}
        ocupado={ocupado}
        ancho="sm"
        pie={(
          <>
            <Boton variante="secundario" onClick={() => setUsando(null)} disabled={ocupado}>Cancelar</Boton>
            <Boton onClick={() => void marcarUsado()} cargando={ocupado}>Marcar usado</Boton>
          </>
        )}
      >
        <Campo etiqueta="¿Quién lo usó?" ayuda="Opcional, para saber después a quién se le dio.">
          <Entrada value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} />
        </Campo>
      </Dialogo>

      <Confirmar
        abierto={!!liberar}
        titulo={`¿Liberar ${liberar?.codigo ?? ''}?`}
        mensaje="Vuelve a estar disponible. Si estaba en una inscripción que todavía no se cobró, se le saca el descuento."
        textoConfirmar="Liberar"
        variante="primario"
        cargando={ocupado}
        alConfirmar={() => void confirmarLiberar()}
        alCerrar={() => setLiberar(null)}
      />
    </div>
  );
}
