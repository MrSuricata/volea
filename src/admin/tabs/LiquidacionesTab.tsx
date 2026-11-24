// Liquidación de campeonatos (v40): por torneo se carga el acuerdo con el club (qué parte de la
// inscripción se reparte y en qué porcentaje), se traen los inscriptos del evento, se asocian
// gastos y premios (de la Caja o a mano) y sale cuánto le toca al club, a VOLEA y a cada socio,
// con una hoja para bajar en PDF. La cuenta la hace utils/liquidacionTorneo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileDown, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../services/supabaseClient';
import { SupabaseService } from '../../services/supabaseService';
import type { Event, LedgerEntry } from '../../types';
import {
  ACUERDO_DEFECTO, SOCIOS_LIQ, baseDeLinea, calcularLiquidacion, montoGasto, normalizarLiquidacion, sincronizarInscripciones,
  type GastoTorneo, type LineaInscripcion, type LiquidacionTorneo, type Pagador,
} from '../../utils/liquidacionTorneo';
import { abrirLiquidacion } from '../../utils/liquidacionTorneoPdf';
import {
  Boton, BotonIcono, Campo, CargandoFilas, Confirmar, Dialogo, EncabezadoPagina, Entrada, EntradaPlata, ErrorEstado, Estadistica,
  Insignia, Plata, Segmentado, Selector, Tarjeta, Vacio, claseEntrada,
} from '../ui';
import { cn } from '../../lib/cn';

type Fila = { id: string; nombre: string; eventId: string | null; liq: LiquidacionTorneo; actualizada: string };

const nuevoId = () => Math.random().toString(36).slice(2, 10);
const PAGADORES: { valor: Pagador; texto: string }[] = [
  { valor: 'volea', texto: 'Caja VOLEA' }, ...SOCIOS_LIQ.map((s) => ({ valor: s as Pagador, texto: s })), { valor: 'club', texto: 'El club' },
];
const DE_TENEDOR: Record<string, Pagador> = { brian: 'Brian', paula: 'Paula', gaston: 'Gastón' };

async function listar(): Promise<Fila[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('liquidaciones_torneo').select('id, nombre, event_id, data, updated_at').order('updated_at', { ascending: false });
  if (error) { console.error('liquidaciones_torneo', error); return null; }
  return (data ?? []).map((f) => ({
    id: f.id as string, nombre: f.nombre as string, eventId: (f.event_id as string | null) ?? null,
    liq: { ...normalizarLiquidacion(f.data), nombre: f.nombre as string }, actualizada: f.updated_at as string,
  }));
}

/** Número suelto (cantidad, porcentaje): acepta coma decimal. */
function EntradaNumero({ valor, alCambiar, className, ...resto }: { valor: number; alCambiar: (n: number) => void; className?: string; 'aria-label': string }) {
  const [texto, setTexto] = useState<string | null>(null);
  return (
    <input
      type="text" inputMode="decimal" autoComplete="off" className={cn(claseEntrada, 'text-right tabular-nums', className)}
      value={texto ?? String(valor).replace('.', ',')}
      onFocus={() => setTexto(String(valor).replace('.', ','))}
      onChange={(e) => { setTexto(e.target.value); const n = Number(e.target.value.replace(',', '.')); if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= 0) alCambiar(n); }}
      onBlur={() => setTexto(null)}
      {...resto}
    />
  );
}

export function LiquidacionesTab({ events }: { events: Event[] }) {
  const [filas, setFilas] = useState<Fila[] | null | undefined>(undefined); // undefined = cargando
  const [abiertaId, setAbiertaId] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [eventoNuevo, setEventoNuevo] = useState('');
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => setFilas(await listar()), []);
  useEffect(() => { void cargar(); }, [cargar]);

  const eventosOrdenados = useMemo(() => [...events].sort((a, b) => b.date.localeCompare(a.date)), [events]);

  async function crear() {
    if (!supabase) return;
    const ev = events.find((e) => e.id === eventoNuevo);
    const nombre = (nombreNuevo.trim() || ev?.name || '').trim();
    if (!nombre) { toast.error('Ponele un nombre o elegí un evento'); return; }
    setOcupado(true);
    let liq: LiquidacionTorneo = { nombre, fecha: ev?.date, eventId: ev?.id, acuerdo: { ...ACUERDO_DEFECTO, club: ev?.location || ACUERDO_DEFECTO.club }, inscripciones: [], gastos: [] };
    if (ev) {
      const insc = await SupabaseService.getInscripciones(ev.id);
      if (insc) liq = { ...liq, inscripciones: sincronizarInscripciones([], insc.map(aInscripto), liq.acuerdo.precio) };
    }
    const { data, error } = await supabase.from('liquidaciones_torneo').insert({ nombre, event_id: ev?.id ?? null, data: liq }).select('id').single();
    setOcupado(false);
    if (error || !data) { toast.error('No se pudo crear (¿sesión vencida?)'); return; }
    setCreando(false); setEventoNuevo(''); setNombreNuevo('');
    await cargar();
    setAbiertaId(data.id as string);
  }

  const abierta = filas?.find((f) => f.id === abiertaId);
  if (abierta) {
    return <Editor key={abierta.id} fila={abierta} alVolver={() => { setAbiertaId(null); void cargar(); }} />;
  }

  return (
    <div className="space-y-5">
      <EncabezadoPagina
        rotulo="Torneos"
        titulo="Liquidaciones"
        descripcion="Cuánto le toca al club y cuánto a VOLEA de cada campeonato: inscripciones, gastos y premios con sus porcentajes."
        acciones={<Boton icono={<Plus size={18} />} onClick={() => setCreando(true)} disabled={filas === null}>Nueva liquidación</Boton>}
      />
      {filas === undefined && <CargandoFilas />}
      {filas === null && (
        <ErrorEstado
          mensaje="No se pudieron leer las liquidaciones. Si es la primera vez, falta pegar la migración v40 (liquidaciones_torneo) en Supabase; si no, puede ser la sesión vencida."
          alReintentar={() => { setFilas(undefined); void cargar(); }}
        />
      )}
      {filas && filas.length === 0 && (
        <Vacio icono={<Wallet size={28} />} titulo="Todavía no hay liquidaciones" descripcion="Creá una eligiendo el evento: trae los inscriptos y lo que pagó cada uno."
          accion={<Boton icono={<Plus size={18} />} onClick={() => setCreando(true)}>Nueva liquidación</Boton>} />
      )}
      {filas && filas.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {filas.map((f) => {
            const r = calcularLiquidacion(f.liq);
            return (
              <button key={f.id} type="button" onClick={() => setAbiertaId(f.id)}
                className="rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-navy-700">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-display text-lg font-black uppercase leading-tight text-navy-700">{f.nombre}</div>
                    <div className="mt-1 text-sm text-gray-500">{f.liq.acuerdo.club} · {r.inscriptos} inscriptos{f.liq.fecha ? ` · ${f.liq.fecha}` : ''}</div>
                  </div>
                  {r.porCobrar > 0 && <Insignia tono="atencion">Falta cobrar <Plata monto={r.porCobrar} /></Insignia>}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div><div className="text-gray-500">{f.liq.acuerdo.club}</div><div className="text-lg font-bold tabular-nums text-navy-700"><Plata monto={r.netoClub} /></div></div>
                  <div><div className="text-gray-500">VOLEA</div><div className="text-lg font-bold tabular-nums text-emerald-700"><Plata monto={r.netoVolea} /></div></div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialogo abierto={creando} titulo="Nueva liquidación" alCerrar={() => setCreando(false)} ocupado={ocupado}
        pie={<><Boton variante="secundario" onClick={() => setCreando(false)} disabled={ocupado}>Cancelar</Boton><Boton onClick={() => void crear()} cargando={ocupado}>Crear</Boton></>}>
        <div className="space-y-4">
          <Campo etiqueta="Evento" ayuda="Trae los inscriptos y lo que pagó cada uno. Se puede dejar sin evento y cargar todo a mano.">
            <Selector value={eventoNuevo} onChange={(e) => setEventoNuevo(e.target.value)}>
              <option value="">Sin evento</option>
              {eventosOrdenados.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.date}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Nombre" ayuda="Si lo dejás vacío usa el nombre del evento.">
            <Entrada value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} placeholder="Torneo de los Palos" />
          </Campo>
        </div>
      </Dialogo>
    </div>
  );
}

const aInscripto = (i: { id: string; nombre: string; estado: string; pagoCosto: number | null; pagoMonto: number | null; pagoDeuda: number | null; cuponPercent?: number | null }) =>
  ({ id: i.id, nombre: i.nombre, estado: i.estado, costo: i.pagoCosto, pagado: i.pagoMonto, deuda: i.pagoDeuda, cuponPct: i.cuponPercent ?? null });

// ─── Editor ──────────────────────────────────────────────────────────────────

function Editor({ fila, alVolver }: { fila: Fila; alVolver: () => void }) {
  const [liq, setLiq] = useState<LiquidacionTorneo>(fila.liq);
  const [sucio, setSucio] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [borrar, setBorrar] = useState(false);
  const [caja, setCaja] = useState<LedgerEntry[] | null | undefined>(undefined); // undefined = cerrado
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const r = useMemo(() => calcularLiquidacion(liq), [liq]);
  const a = liq.acuerdo;

  const cambiar = (f: (l: LiquidacionTorneo) => LiquidacionTorneo) => { setLiq(f); setSucio(true); };
  const acuerdo = (parte: Partial<LiquidacionTorneo['acuerdo']>) => cambiar((l) => ({ ...l, acuerdo: { ...l.acuerdo, ...parte } }));
  const linea = (id: string, parte: Partial<LineaInscripcion>) => cambiar((l) => ({ ...l, inscripciones: l.inscripciones.map((i) => (i.id === id ? { ...i, ...parte } : i)) }));
  const gasto = (id: string, parte: Partial<GastoTorneo>) => cambiar((l) => ({ ...l, gastos: l.gastos.map((g) => (g.id === id ? { ...g, ...parte } : g)) }));

  useEffect(() => {
    if (!sucio) return;
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [sucio]);

  async function guardar(): Promise<boolean> {
    if (!supabase) return false;
    const nombre = liq.nombre.trim();
    if (!nombre) { toast.error('La liquidación necesita un nombre'); return false; }
    setGuardando(true);
    const { data, error } = await supabase.from('liquidaciones_torneo')
      .update({ nombre, data: { ...liq, nombre }, updated_at: new Date().toISOString() }).eq('id', fila.id).select('id');
    setGuardando(false);
    if (error || !data || data.length === 0) { toast.error('No se pudo guardar (¿sesión vencida?)'); return false; }
    setSucio(false);
    toast.success('Liquidación guardada');
    return true;
  }

  async function eliminar() {
    if (!supabase) return;
    setGuardando(true);
    const { error } = await supabase.from('liquidaciones_torneo').delete().eq('id', fila.id);
    setGuardando(false);
    if (error) { toast.error('No se pudo borrar'); return; }
    toast.success('Liquidación borrada');
    alVolver();
  }

  async function traerInscriptos() {
    if (!liq.eventId) return;
    const insc = await SupabaseService.getInscripciones(liq.eventId);
    if (!insc) { toast.error('No se pudieron leer los inscriptos'); return; }
    cambiar((l) => ({ ...l, inscripciones: sincronizarInscripciones(l.inscripciones, insc.map(aInscripto), l.acuerdo.precio) }));
    toast.success('Inscriptos actualizados (los ajustes a mano se conservan)');
  }

  async function abrirCaja() {
    setCaja(null);
    setElegidos(new Set());
    const todo = await SupabaseService.getLedger(600);
    const usados = new Set(liq.gastos.map((g) => g.ledgerId).filter(Boolean));
    setCaja((todo ?? []).filter((e) => e.kind === 'gasto' && !e.reverted && !usados.has(e.id)).slice(0, 80));
  }

  function asociarDeCaja() {
    const nuevos: GastoTorneo[] = (caja ?? []).filter((e) => elegidos.has(e.id)).map((e) => ({
      id: nuevoId(), concepto: e.label, cantidad: 1, unitario: e.amount, pctClub: a.pctClubGastos,
      pagadoPor: DE_TENEDOR[String(e.paidBy ?? '')] ?? 'volea', pagado: true, ledgerId: e.id,
    }));
    cambiar((l) => ({ ...l, gastos: [...l.gastos, ...nuevos] }));
    setCaja(undefined);
  }

  function bajar(para: 'club' | 'interno') {
    if (!abrirLiquidacion(liq, para)) toast.error('El navegador bloqueó la pestaña nueva: permití las ventanas emergentes.');
  }

  const celda = 'px-2 py-1.5 align-middle';
  const th = 'px-2 py-2 text-left text-xs font-bold uppercase tracking-wide text-gray-500';
  const chica = 'h-10 min-w-0';
  const saldoTexto = r.saldoClub >= 0 ? `VOLEA le paga a ${a.club}` : `${a.club} le paga a VOLEA`;

  return (
    <div className="space-y-5">
      <EncabezadoPagina
        rotulo="Liquidación"
        titulo={liq.nombre || 'Sin nombre'}
        descripcion={`${a.club} · ${r.inscriptos} inscriptos`}
        acciones={<>
          <Boton variante="fantasma" icono={<ArrowLeft size={18} />} onClick={() => { if (!sucio || window.confirm('Hay cambios sin guardar. ¿Salir igual?')) alVolver(); }}>Volver</Boton>
          <Boton variante="secundario" icono={<FileDown size={18} />} onClick={() => bajar('club')}>PDF para el club</Boton>
          <Boton variante="secundario" icono={<FileDown size={18} />} onClick={() => bajar('interno')}>PDF interno</Boton>
          <Boton onClick={() => void guardar()} cargando={guardando} disabled={!sucio}>{sucio ? 'Guardar' : 'Guardado'}</Boton>
        </>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Estadistica etiqueta={`Neto ${a.club}`} valor={r.netoClub} plata detalle={`${a.pctClub} % de inscripciones − gastos`} />
        <Estadistica etiqueta="Neto VOLEA" valor={r.netoVolea} plata tono="bien" detalle="Inscripciones + remeras − gastos" />
        <Estadistica etiqueta={saldoTexto} valor={Math.abs(r.saldoClub)} plata detalle={r.saldoClubPendiente !== 0 ? <>Con lo cobrado hoy: <Plata monto={Math.abs(r.saldoClubAhora)} /></> : 'Cierra la cuenta con el club'} />
        <Estadistica etiqueta="Falta cobrar" valor={r.porCobrar} plata tono={r.porCobrar > 0 ? 'atencion' : 'neutro'} detalle={r.deudores.length ? r.deudores.map((d) => d.nombre).join(', ') : 'Todo cobrado'} />
      </div>

      <Tarjeta titulo="Acuerdo con el club">
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 md:p-5">
          <Campo etiqueta="Nombre de la liquidación"><Entrada value={liq.nombre} onChange={(e) => cambiar((l) => ({ ...l, nombre: e.target.value }))} /></Campo>
          <Campo etiqueta="Club"><Entrada value={a.club} onChange={(e) => acuerdo({ club: e.target.value })} /></Campo>
          <Campo etiqueta="Fecha del torneo"><Entrada type="date" value={liq.fecha ?? ''} onChange={(e) => cambiar((l) => ({ ...l, fecha: e.target.value || undefined }))} /></Campo>
          <Campo etiqueta="Precio de la inscripción"><EntradaPlata valor={a.precio} alCambiar={(n) => acuerdo({ precio: n ?? 0 })} /></Campo>
          <Campo etiqueta="De eso, es inscripción" ayuda={<>El resto (<Plata monto={Math.max(0, a.precio - a.baseInscripcion)} />) es la remera: todo de VOLEA.</>}>
            <EntradaPlata valor={a.baseInscripcion} alCambiar={(n) => acuerdo({ baseInscripcion: n ?? 0 })} />
          </Campo>
          <Campo etiqueta="% del club sobre la inscripción" ayuda={`VOLEA se queda con el ${100 - a.pctClub} %.`}>
            <EntradaNumero valor={a.pctClub} alCambiar={(n) => acuerdo({ pctClub: Math.min(100, n) })} aria-label="% del club sobre la inscripción" />
          </Campo>
          <Campo etiqueta="% del club en gastos y premios" ayuda="Es el que se propone al agregar un gasto; cada gasto puede tener el suyo.">
            <EntradaNumero valor={a.pctClubGastos} alCambiar={(n) => acuerdo({ pctClubGastos: Math.min(100, n) })} aria-label="% del club en gastos" />
          </Campo>
          <div>
            <div className="mb-1.5 text-sm font-semibold text-gray-700">Las inscripciones las cobró</div>
            <Segmentado etiqueta="Quién cobró las inscripciones" valor={a.cobro} alCambiar={(v) => acuerdo({ cobro: v })}
              opciones={[{ valor: 'volea', texto: 'VOLEA' }, { valor: 'club', texto: 'El club' }]} />
          </div>
        </div>
      </Tarjeta>

      <Tarjeta titulo={`Inscripciones (${r.inscriptos})`} acciones={
        <div className="flex flex-wrap gap-2">
          {liq.eventId && <Boton chico variante="secundario" icono={<RefreshCw size={16} />} onClick={() => void traerInscriptos()}>Traer del evento</Boton>}
          <Boton chico variante="secundario" icono={<Plus size={16} />}
            onClick={() => cambiar((l) => ({ ...l, inscripciones: [...l.inscripciones, { id: `manual-${nuevoId()}`, nombre: '', total: l.acuerdo.precio, pagado: 0 }] }))}>Agregar</Boton>
        </div>
      }>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-gray-100">
              <th className={th}>Jugador</th><th className={cn(th, 'w-32')}>Le toca pagar</th><th className={cn(th, 'w-32')}>Pagó</th>
              <th className={cn(th, 'w-36')}>Se reparte con el club</th><th className={cn(th, 'w-28 text-right')}>{a.club}</th><th className="w-10" />
            </tr></thead>
            <tbody>
              {liq.inscripciones.map((i) => {
                const b = baseDeLinea(i, a);
                const debe = i.total - i.pagado;
                return (
                  <tr key={i.id} className="border-b border-gray-50">
                    <td className={celda}>
                      <Entrada className={chica} value={i.nombre} onChange={(e) => linea(i.id, { nombre: e.target.value })} aria-label="Jugador" />
                      {debe > 0 && <div className="mt-1"><Insignia tono="atencion">Debe <Plata monto={debe} /></Insignia></div>}
                    </td>
                    <td className={celda}><EntradaPlata className={chica} valor={i.total} alCambiar={(n) => linea(i.id, { total: n ?? 0 })} aria-label={`Le toca pagar ${i.nombre}`} /></td>
                    <td className={celda}><EntradaPlata className={chica} valor={i.pagado} alCambiar={(n) => linea(i.id, { pagado: n ?? 0 })} aria-label={`Pagó ${i.nombre}`} /></td>
                    <td className={celda}>
                      <EntradaPlata className={chica} valor={i.base ?? null} placeholder={String(b)} alCambiar={(n) => linea(i.id, { base: n ?? undefined })} aria-label={`Se reparte de ${i.nombre}`} />
                    </td>
                    <td className={cn(celda, 'text-right font-semibold tabular-nums text-navy-700')}><Plata monto={Math.round(b * a.pctClub) / 100} /></td>
                    <td className={celda}><BotonIcono etiqueta={`Quitar a ${i.nombre}`} icono={<Trash2 size={16} />} tono="peligro"
                      onClick={() => cambiar((l) => ({ ...l, inscripciones: l.inscripciones.filter((x) => x.id !== i.id) }))} /></td>
                  </tr>
                );
              })}
              <tr className="font-bold text-navy-700">
                <td className={celda}>Total</td>
                <td className={cn(celda, 'tabular-nums')}><Plata monto={r.totalInscripciones} /></td>
                <td className={cn(celda, 'tabular-nums')}><Plata monto={r.cobrado} /></td>
                <td className={cn(celda, 'tabular-nums')}><Plata monto={r.base} /></td>
                <td className={cn(celda, 'text-right tabular-nums')}><Plata monto={r.clubInscripciones} /></td><td />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="px-4 pb-4 pt-2 text-xs text-gray-500 md:px-5">
          «Se reparte con el club» vacío = automático: <Plata monto={a.baseInscripcion} /> si paga completo y en proporción si paga menos (cupón).
          Si alguien pagó solo la remera poné 0; si usó un cupón que regaló VOLEA poné la inscripción completa (<Plata monto={a.baseInscripcion} />): el club cobra su parte entera y la diferencia la absorbe VOLEA.
        </p>
      </Tarjeta>

      <Tarjeta titulo={`Gastos y premios (${liq.gastos.length})`} acciones={
        <div className="flex flex-wrap gap-2">
          <Boton chico variante="secundario" icono={<Wallet size={16} />} onClick={() => void abrirCaja()}>Traer de la Caja</Boton>
          <Boton chico variante="secundario" icono={<Plus size={16} />}
            onClick={() => cambiar((l) => ({ ...l, gastos: [...l.gastos, { id: nuevoId(), concepto: '', cantidad: 1, unitario: 0, pctClub: l.acuerdo.pctClubGastos, pagadoPor: 'volea', pagado: true }] }))}>Agregar</Boton>
        </div>
      }>
        {liq.gastos.length === 0 ? (
          <p className="p-4 text-sm text-gray-500 md:p-5">Sin gastos asociados. Traelos de la Caja o agregalos a mano (medallas, premios, pelotas…).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="border-b border-gray-100">
                <th className={th}>Concepto</th><th className={cn(th, 'w-20')}>Cant.</th><th className={cn(th, 'w-28')}>Costo c/u</th><th className={cn(th, 'w-24 text-right')}>Total</th>
                <th className={cn(th, 'w-20')}>% club</th><th className={cn(th, 'w-24 text-right')}>{a.club}</th><th className={cn(th, 'w-36')}>Lo pagó</th>
                <th className={cn(th, 'w-36')}>Proveedor</th><th className={cn(th, 'w-16')}>Pago</th><th className="w-10" />
              </tr></thead>
              <tbody>
                {liq.gastos.map((g) => {
                  const m = montoGasto(g);
                  return (
                    <tr key={g.id} className="border-b border-gray-50">
                      <td className={celda}><Entrada className={chica} value={g.concepto} onChange={(e) => gasto(g.id, { concepto: e.target.value })} aria-label="Concepto" placeholder="Medallas" /></td>
                      <td className={celda}><EntradaNumero className={chica} valor={g.cantidad} alCambiar={(n) => gasto(g.id, { cantidad: n })} aria-label={`Cantidad de ${g.concepto}`} /></td>
                      <td className={celda}><EntradaPlata className={chica} valor={g.unitario} alCambiar={(n) => gasto(g.id, { unitario: n ?? 0 })} aria-label={`Costo de ${g.concepto}`} /></td>
                      <td className={cn(celda, 'text-right font-semibold tabular-nums')}><Plata monto={m} /></td>
                      <td className={celda}><EntradaNumero className={chica} valor={g.pctClub} alCambiar={(n) => gasto(g.id, { pctClub: Math.min(100, n) })} aria-label={`% del club en ${g.concepto}`} /></td>
                      <td className={cn(celda, 'text-right tabular-nums text-navy-700')}><Plata monto={Math.round(m * g.pctClub) / 100} /></td>
                      <td className={celda}>
                        <Selector className={chica} value={g.pagadoPor} onChange={(e) => gasto(g.id, { pagadoPor: e.target.value as Pagador })} aria-label={`Quién pagó ${g.concepto}`}>
                          {PAGADORES.map((p) => <option key={p.valor} value={p.valor}>{p.texto}</option>)}
                        </Selector>
                      </td>
                      <td className={celda}><Entrada className={chica} value={g.proveedor ?? ''} onChange={(e) => gasto(g.id, { proveedor: e.target.value })} aria-label={`Proveedor de ${g.concepto}`} /></td>
                      <td className={celda}>
                        <label className="flex h-10 cursor-pointer items-center gap-1.5 text-xs">
                          <input type="checkbox" className="h-5 w-5" checked={g.pagado !== false} onChange={(e) => gasto(g.id, { pagado: e.target.checked })} /> {g.pagado !== false ? 'Sí' : 'Falta'}
                        </label>
                      </td>
                      <td className={celda}><BotonIcono etiqueta={`Quitar ${g.concepto}`} icono={<Trash2 size={16} />} tono="peligro"
                        onClick={() => cambiar((l) => ({ ...l, gastos: l.gastos.filter((x) => x.id !== g.id) }))} /></td>
                    </tr>
                  );
                })}
                <tr className="font-bold text-navy-700">
                  <td className={celda} colSpan={3}>Total</td>
                  <td className={cn(celda, 'text-right tabular-nums')}><Plata monto={r.gastos} /></td><td />
                  <td className={cn(celda, 'text-right tabular-nums')}><Plata monto={r.clubGastos} /></td><td colSpan={4} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta titulo={a.club}>
          <Renglones filas={[
            [`${a.pctClub} % de las inscripciones`, r.clubInscripciones],
            ['Su parte de gastos y premios', -r.clubGastos],
            ['Neto', r.netoClub, true],
            ...((r.gastosPagadosPor.club ?? 0) > 0 ? [['Gastos que pagó el club', r.gastosPagadosPor.club] as Renglon] : []),
            ...(a.cobro === 'club' ? [['Inscripciones que cobró', -r.totalInscripciones] as Renglon] : []),
            [saldoTexto, Math.abs(r.saldoClub), true],
            ...(r.saldoClubPendiente !== 0 ? [['Con lo cobrado hasta hoy', Math.abs(r.saldoClubAhora)] as Renglon] : []),
          ]} />
        </Tarjeta>
        <Tarjeta titulo="VOLEA">
          <Renglones filas={[
            [`${100 - a.pctClub} % de las inscripciones`, r.base - r.clubInscripciones],
            ['Remeras', r.remeras],
            ['Su parte de gastos y premios', -r.voleaGastos],
            ['Neto', r.netoVolea, true],
          ]} />
        </Tarjeta>
        <Tarjeta titulo="Entre socios">
          <Renglones filas={r.socios.flatMap((s): Renglon[] => [
            [s.puso > 0 ? `${s.nombre} · ${s.cuota * 100} % + ${Math.round(s.puso).toLocaleString('es-UY')} que puso` : `${s.nombre} · ${s.cuota * 100} %`, s.recibe],
          ])} />
          {r.aProveedores.length > 0 && (
            <div className="border-t border-gray-100 px-4 py-3 text-sm md:px-5">
              <div className="mb-1 font-bold text-amber-800">Falta pagar a proveedores</div>
              {r.aProveedores.map((p, i) => <div key={i} className="flex justify-between gap-3"><span>{p.proveedor} · {p.concepto}</span><Plata monto={p.monto} /></div>)}
            </div>
          )}
        </Tarjeta>
      </div>

      <Tarjeta titulo="Notas">
        <div className="p-4 md:p-5">
          <textarea className={cn(claseEntrada, 'h-24 py-2')} value={liq.notas ?? ''} onChange={(e) => cambiar((l) => ({ ...l, notas: e.target.value }))}
            placeholder="Lo que haya que acordarse de este torneo (solo sale en el PDF interno)." aria-label="Notas" />
        </div>
      </Tarjeta>

      <div className="flex justify-between gap-3">
        <Boton variante="fantasma" icono={<Trash2 size={18} />} onClick={() => setBorrar(true)}>Borrar liquidación</Boton>
        <Boton onClick={() => void guardar()} cargando={guardando} disabled={!sucio}>{sucio ? 'Guardar' : 'Guardado'}</Boton>
      </div>

      <Confirmar abierto={borrar} titulo="¿Borrar esta liquidación?" mensaje="No toca la Caja ni las inscripciones: solo se pierde esta cuenta."
        textoConfirmar="Borrar" cargando={guardando} alConfirmar={() => void eliminar()} alCerrar={() => setBorrar(false)} />

      <Dialogo abierto={caja !== undefined} titulo="Gastos de la Caja" descripcion="Marcá los que son de este torneo. Entran con el % del club del acuerdo y después se ajusta cada uno."
        alCerrar={() => setCaja(undefined)} ancho="lg"
        pie={<><Boton variante="secundario" onClick={() => setCaja(undefined)}>Cancelar</Boton><Boton onClick={asociarDeCaja} disabled={elegidos.size === 0}>Asociar {elegidos.size || ''}</Boton></>}>
        {caja === null && <CargandoFilas />}
        {caja && caja.length === 0 && <p className="text-sm text-gray-500">No hay gastos recientes sin asociar.</p>}
        {caja && caja.length > 0 && (
          <div className="divide-y divide-gray-100">
            {caja.map((e) => (
              <label key={e.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 py-2 text-sm">
                <input type="checkbox" className="h-5 w-5 shrink-0" checked={elegidos.has(e.id)}
                  onChange={(ev) => setElegidos((s) => { const n = new Set(s); if (ev.target.checked) n.add(e.id); else n.delete(e.id); return n; })} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-navy-700">{e.label}</span>
                  <span className="text-xs text-gray-500">{new Date(e.createdAt).toLocaleDateString('es-UY', { day: 'numeric', month: 'short' })}{e.paidBy ? ` · pagó ${e.paidBy}` : ''}</span>
                </span>
                <span className="font-bold tabular-nums"><Plata monto={e.amount} /></span>
              </label>
            ))}
          </div>
        )}
      </Dialogo>
    </div>
  );
}

type Renglon = [string, number, boolean?];

function Renglones({ filas }: { filas: Renglon[] }) {
  return (
    <div className="px-4 py-3 text-sm md:px-5">
      {filas.map(([texto, monto, fuerte], i) => (
        <div key={i} className={cn('flex justify-between gap-3 py-1', fuerte && 'border-t border-gray-200 font-bold text-navy-700')}>
          <span>{texto}</span><span className="tabular-nums"><Plata monto={monto} /></span>
        </div>
      ))}
    </div>
  );
}
