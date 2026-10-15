import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Calculator, PieChart, Trash2, Vault } from 'lucide-react';
import { toast } from 'sonner';
import type { SocioName } from '../types';
import { SupabaseService } from '../services/supabaseService';
import { partesReparto, resumenCaja, TEXTO_TIPO, type CajaVoleaMov } from '../utils/cajaVolea';
import { NOMBRES_SOCIOS, SOCIOS } from '../utils/socios';
import { cn } from '../lib/cn';
import { Boton, BotonIcono, Campo, Confirmar, Dialogo, Entrada, EntradaPlata, Plata, Segmentado, formatoPlata } from '../admin/ui';

// Caja VOLEA: la plata física de la caja, que es de los tres. Al liquidar, el efectivo queda acá;
// desde acá se cuenta, se reparte, o un socio retira o pone plata.

type Accion = 'conteo' | 'retiro' | 'aporte' | 'reparto';

const TITULO: Record<Accion, string> = {
  conteo: 'Contar la caja',
  retiro: 'Alguien se lleva plata de la caja',
  aporte: 'Alguien pone plata en la caja',
  reparto: 'Repartir 50/25/25',
};

const AYUDA: Record<Accion, string> = {
  conteo: 'Contá los billetes y poné cuánto hay. Si no coincide con lo esperado, la diferencia queda anotada y el saldo pasa a ser lo contado.',
  retiro: 'Ese socio queda debiéndoles a los otros dos su parte (como si hubiera cobrado una venta).',
  aporte: 'Los otros dos le deben su parte (como un gasto que pagó él).',
  reparto: 'Sale de la caja y cada uno se lleva su parte: Brian 50%, Paula 25%, Gastón 25%. No cambia las cuentas entre socios.',
};

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-UY', { day: 'numeric', month: 'short', timeZone: 'America/Montevideo' });

export function CajaVoleaPanel({ reportedBy, socioSugerido, onCuentasCambiaron }: {
  reportedBy: string;
  socioSugerido: SocioName | null;
  onCuentasCambiaron: () => void;
}) {
  const [movs, setMovs] = useState<CajaVoleaMov[] | null | undefined>(undefined);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [monto, setMonto] = useState<number | null>(null);
  const [socio, setSocio] = useState<SocioName | null>(socioSugerido);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [verTodo, setVerTodo] = useState(false);
  const [anular, setAnular] = useState<CajaVoleaMov | null>(null);

  const cargar = useCallback(async () => setMovs(await SupabaseService.getCajaVolea()), []);
  useEffect(() => { void cargar(); }, [cargar]);
  const r = useMemo(() => resumenCaja(movs ?? []), [movs]);

  const abrir = (a: Accion) => {
    setAccion(a);
    setMonto(a === 'reparto' && r.saldo > 0 ? r.saldo : null);
    setSocio(socioSugerido);
    setNota('');
  };

  const necesitaSocio = accion === 'retiro' || accion === 'aporte';
  const montoOk = monto !== null && Number.isFinite(monto) && (accion === 'conteo' ? monto >= 0 : monto > 0);
  const listo = !!accion && montoOk && (!necesitaSocio || !!socio);

  async function guardar() {
    if (!accion || !listo || monto === null) return;
    setGuardando(true);
    const res = await SupabaseService.movCajaVolea(accion, monto, necesitaSocio ? socio : null, nota, reportedBy);
    setGuardando(false);
    if (!res.ok) { toast.error(res.error ?? 'No se pudo guardar'); return; }
    const dif = accion === 'conteo' ? Math.round(monto - r.saldo) : 0;
    toast.success(accion === 'conteo'
      ? (dif === 0 ? 'Caja contada: coincide' : `Caja contada: ${dif > 0 ? 'sobran' : 'faltan'} ${formatoPlata(Math.abs(dif))}`)
      : 'Listo, anotado en la caja');
    setAccion(null);
    void cargar();
    if (necesitaSocio) onCuentasCambiaron();
  }

  async function confirmarAnular() {
    if (!anular) return;
    const m = anular;
    setAnular(null);
    const res = await SupabaseService.anularMovCajaVolea(m.id);
    if (!res.ok) { toast.error(res.error ?? 'No se pudo anular'); return; }
    toast.success('Movimiento anulado');
    void cargar();
    if (m.socio) onCuentasCambiaron();
  }

  if (movs === null) {
    return (
      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        No se pudo leer la Caja VOLEA. Recargá la página; si sigue, falta la actualización de la base (v34).
      </div>
    );
  }

  const lista = (movs ?? []).slice(0, verTodo ? 200 : 6);
  const partes = accion === 'reparto' && monto ? partesReparto(monto) : null;

  return (
    <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gray-500">
            <Vault size={14} /> Caja VOLEA · efectivo
          </p>
          <p className={cn('mt-1 font-display text-3xl font-black tabular-nums', r.saldo < 0 ? 'text-red-700' : 'text-navy-700')}>
            {movs === undefined ? '…' : formatoPlata(r.saldo)}
          </p>
          <p className="mt-0.5 text-[13px] text-gray-500">
            {r.ultimoConteo
              ? <>Contada el {fecha(r.ultimoConteo.createdAt)}: {formatoPlata(r.ultimoConteo.contado ?? 0)}. Después entraron {formatoPlata(r.entradas)} y salieron {formatoPlata(r.salidas)}.</>
              : 'Todavía no se contó: empezá con «Contar» para arrancar del efectivo que hay hoy.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Boton chico icono={<Calculator size={15} />} onClick={() => abrir('conteo')}>Contar</Boton>
          <Boton chico variante="secundario" icono={<ArrowUpFromLine size={15} />} onClick={() => abrir('retiro')}>Retiro</Boton>
          <Boton chico variante="secundario" icono={<ArrowDownToLine size={15} />} onClick={() => abrir('aporte')}>Aporte</Boton>
          <Boton chico variante="secundario" icono={<PieChart size={15} />} onClick={() => abrir('reparto')} disabled={r.saldo <= 0}>Repartir</Boton>
        </div>
      </div>

      {lista.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100 border-t border-gray-100">
          {lista.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-14 shrink-0 text-[12px] text-gray-500">{fecha(m.createdAt)}</span>
              <span className="min-w-0 flex-1 truncate text-gray-700">
                <span className="font-semibold text-navy-700">{TEXTO_TIPO[m.tipo]}</span>
                {m.socio && <> · {NOMBRES_SOCIOS[m.socio]}</>} · {m.descripcion}
              </span>
              <Plata monto={m.monto} className={cn('shrink-0 font-semibold', m.monto >= 0 ? 'text-emerald-700' : 'text-red-700')} />
              {m.tipo !== 'venta' && m.tipo !== 'gasto'
                ? <BotonIcono etiqueta={`Anular ${TEXTO_TIPO[m.tipo]}`} icono={<Trash2 size={15} />} tono="peligro" onClick={() => setAnular(m)} />
                : <span className="w-9 shrink-0" />}
            </li>
          ))}
        </ul>
      )}
      {(movs?.length ?? 0) > 6 && (
        <Boton chico variante="fantasma" className="mt-2" onClick={() => setVerTodo((v) => !v)}>{verTodo ? 'Ver menos' : `Ver todos (${movs?.length})`}</Boton>
      )}

      {accion && (
        <Dialogo
          abierto
          titulo={TITULO[accion]}
          descripcion={AYUDA[accion]}
          alCerrar={() => setAccion(null)}
          ocupado={guardando}
          ancho="sm"
          pie={(
            <>
              <Boton variante="secundario" onClick={() => setAccion(null)} disabled={guardando}>Cancelar</Boton>
              <Boton onClick={() => void guardar()} disabled={!listo} cargando={guardando}>Guardar</Boton>
            </>
          )}
        >
          <div className="space-y-4">
            {necesitaSocio && (
              <div>
                <span className="mb-1.5 block text-[13px] font-semibold text-navy-700">¿Quién?</span>
                <Segmentado etiqueta="Socio" opciones={SOCIOS.map((s) => ({ valor: s, texto: NOMBRES_SOCIOS[s] }))} valor={socio} alCambiar={setSocio} anchoCompleto />
              </div>
            )}
            <Campo
              etiqueta={accion === 'conteo' ? '¿Cuánto hay en la caja?' : 'Monto'}
              ayuda={accion === 'conteo'
                ? `Se esperan ${formatoPlata(r.saldo)}.${monto !== null && Math.round(monto - r.saldo) !== 0 ? ` ${monto > r.saldo ? 'Sobran' : 'Faltan'} ${formatoPlata(Math.abs(Math.round(monto - r.saldo)))}.` : ''}`
                : accion === 'retiro' || accion === 'reparto' ? `En la caja hay ${formatoPlata(r.saldo)}.` : undefined}
            >
              <EntradaPlata valor={monto} alCambiar={setMonto} />
            </Campo>
            {partes && (
              <p className="rounded-lg bg-gray-50 p-2.5 text-[13px] text-gray-700">
                Brian {formatoPlata(partes.brian)} · Paula {formatoPlata(partes.paula)} · Gastón {formatoPlata(partes.gaston)}
              </p>
            )}
            <Campo etiqueta="Nota (opcional)">
              <Entrada value={nota} onChange={(e) => setNota(e.target.value)} placeholder={accion === 'conteo' ? 'Ej.: cierre del torneo' : 'Ej.: para pagar a Pickleball City'} />
            </Campo>
          </div>
        </Dialogo>
      )}

      <Confirmar
        abierto={anular !== null}
        titulo="¿Anular el movimiento?"
        mensaje={anular && <>Se borra «{anular.descripcion}» de la caja{anular.socio ? ' y de las cuentas de socios' : ''}.</>}
        textoConfirmar="Anular"
        alConfirmar={() => void confirmarAnular()}
        alCerrar={() => setAnular(null)}
      />
    </section>
  );
}
