import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Activity, RefreshCw, Upload } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { Boton, Campo, CargandoFilas, Confirmar, EncabezadoPagina, Entrada, ErrorEstado, Insignia, Selector, Tarjeta, Vacio } from '../admin/ui';
import type { TonoInsignia } from '../admin/ui';
import ConectarDupr from './ConectarDupr';
import { configDupr, panelDupr } from './dupr';
import type { ConfigDuprWeb, EstadoDupr, EstadoPartido, PedidoTorneo, RevisionTorneo } from './dupr';

// Panel de DUPR: el estado de la conexión, quiénes conectaron su cuenta y la subida de los
// partidos de un cuadro. Todo lo que habla con DUPR pasa por /api/dupr/admin.

type Conexion = {
  dupr_id: string; nombre: string | null; rating_singles: number | null; rating_dobles: number | null;
  rating_at: string | null; habilitado: boolean | null; premium: boolean | null; suscripto: boolean; admin_email: string | null;
};
type Cuadro = { id: string; nombre: string; fase: string; evento: string | null };

const rating = (n: number | null) => (n === null ? '—' : Number(n).toFixed(3));
const fechaCorta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-UY', { day: 'numeric', month: 'short' }) : '—');
const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const TONO: Record<EstadoPartido, TonoInsignia> = { subido: 'bien', 'por subir': 'info', 'cambió': 'atencion', 'por borrar': 'alerta', 'no va': 'neutro' };
const CLUB: Record<'ok' | 'sin-rol' | 'vencida' | 'sin-club', { tono: TonoInsignia; texto: string }> = {
  ok: { tono: 'bien', texto: 'Puede subir partidos del club' },
  'sin-rol': { tono: 'alerta', texto: 'No es directora ni organizadora del club' },
  vencida: { tono: 'atencion', texto: 'La conexión venció: conectá de nuevo' },
  'sin-club': { tono: 'neutro', texto: 'Sin club: los partidos van como partner' },
};

export default function DuprTab() {
  const [estado, setEstado] = useState<EstadoDupr | null>(null);
  const [error, setError] = useState('');
  const [web, setWeb] = useState<ConfigDuprWeb>({ habilitado: false });
  const [conexiones, setConexiones] = useState<Conexion[]>([]);
  const [cuadros, setCuadros] = useState<Cuadro[]>([]);
  const [ocupado, setOcupado] = useState('');

  const cargar = useCallback(async () => {
    setError('');
    const r = await panelDupr.estado();
    if (!r.ok) { setError(r.error); return; }
    setEstado(r.datos);
    void configDupr().then(setWeb);
    if (!r.datos.configurado || !supabase) return;
    const [c, t] = await Promise.all([
      supabase.from('dupr_conexiones')
        .select('dupr_id, nombre, rating_singles, rating_dobles, rating_at, habilitado, premium, suscripto, admin_email')
        .eq('entorno', r.datos.entorno).order('conectado_at', { ascending: false }),
      supabase.from('rk_torneos').select('id, nombre, fase, evento').order('creado_el', { ascending: false }),
    ]);
    if (c.data) setConexiones(c.data as Conexion[]);
    if (t.data) setCuadros(t.data as Cuadro[]);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  if (error) return <ErrorEstado mensaje={error} alReintentar={() => void cargar()} />;
  if (!estado) return <CargandoFilas />;

  if (!estado.configurado) {
    return (
      <div className="max-w-2xl">
        <EncabezadoPagina rotulo="Torneos" titulo="DUPR" descripcion="Ratings al día y partidos subidos a DUPR desde la web." />
        <Vacio
          icono={<Activity size={22} />}
          titulo="Falta cargar las claves de DUPR"
          descripcion="La conexión ya está armada. Cuando DUPR mande la client key y el client secret se cargan en Vercel (los pasos están en docs/DUPR.md del repo) y este panel se activa solo."
        />
      </div>
    );
  }

  const correr = async (clave: string, tarea: () => Promise<{ ok: true } | { ok: false; error: string }>, exito: string) => {
    setOcupado(clave);
    const r = await tarea();
    setOcupado('');
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(exito);
    void cargar();
  };

  return (
    <div className="max-w-4xl">
      <EncabezadoPagina
        rotulo="Torneos" titulo="DUPR"
        descripcion="Ratings al día y partidos subidos a DUPR desde la web."
        acciones={<Boton variante="secundario" chico icono={<RefreshCw size={16} />} onClick={() => void cargar()}>Actualizar</Boton>}
      />

      <Tarjeta className="mb-4" titulo="Conexión">
        <div className="flex flex-wrap items-center gap-2">
          <Insignia tono={estado.entorno === 'prod' ? 'bien' : 'atencion'} punto>
            {estado.entorno === 'prod' ? 'Producción' : 'Ambiente de prueba de DUPR (UAT)'}
          </Insignia>
          <Insignia>{estado.conexiones} {estado.conexiones === 1 ? 'cuenta conectada' : 'cuentas conectadas'}</Insignia>
          <Insignia>{estado.clubId ? `Club ${estado.clubId}` : 'Sin club'}</Insignia>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[13px] font-semibold text-navy-700">Aviso de cambios de rating</p>
            <p className="mt-0.5 break-all text-xs text-gray-500">{estado.webhook}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Boton variante="secundario" chico cargando={ocupado === 'webhook'}
                onClick={() => void correr('webhook', async () => panelDupr.registrarWebhook(), 'DUPR ya avisa los cambios de rating a esta web')}>
                Registrar en DUPR
              </Boton>
              {estado.sinSuscribir > 0 && (
                <Boton variante="secundario" chico cargando={ocupado === 'suscribir'}
                  onClick={() => void correr('suscribir', async () => panelDupr.suscribirPendientes(), 'Listo: quedaron todos suscriptos')}>
                  Suscribir {estado.sinSuscribir} pendiente{estado.sinSuscribir === 1 ? '' : 's'}
                </Boton>
              )}
            </div>
          </div>

          <div>
            <p className="text-[13px] font-semibold text-navy-700">Tu cuenta DUPR</p>
            {estado.miCuenta ? (
              <div className="mt-1">
                <p className="text-sm text-navy-700">{estado.miCuenta.nombre ?? 'Cuenta'} · {estado.miCuenta.duprId}</p>
                <Insignia tono={CLUB[estado.miCuenta.club].tono} className="mt-1">{CLUB[estado.miCuenta.club].texto}</Insignia>
              </div>
            ) : (
              <p className="mt-0.5 text-xs text-gray-500">
                {estado.clubId ? 'Para subir partidos a nombre del club, DUPR pide comprobar con tu cuenta que lo dirigís u organizás.' : 'Conectala para verla acá con tu rating.'}
              </p>
            )}
            {web.habilitado && (
              <div className="mt-2 max-w-xs">
                <ConectarDupr login={web.login} conexion={null} comoEquipo
                  etiqueta={estado.miCuenta ? 'Conectar de nuevo' : 'Conectar mi cuenta DUPR'} discreto={estado.miCuenta !== null}
                  alConectar={() => { toast.success('Cuenta DUPR conectada'); void cargar(); }} />
              </div>
            )}
          </div>
        </div>
      </Tarjeta>

      <SubirCuadro cuadros={cuadros} conClub={estado.clubId !== null} />

      <Tarjeta titulo={`Cuentas conectadas (${conexiones.length})`} sinPadding>
        {conexiones.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-500">Todavía nadie conectó su cuenta DUPR.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[12px] uppercase tracking-wide text-gray-500">
                <tr><th className="px-4 py-2">Jugador</th><th className="px-2 py-2">DUPR ID</th><th className="px-2 py-2">Dobles</th><th className="px-2 py-2">Singles</th><th className="px-2 py-2">Rating del</th><th className="px-4 py-2" /></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {conexiones.map((c) => (
                  <tr key={c.dupr_id}>
                    <td className="px-4 py-2 font-semibold text-navy-700">{c.nombre ?? '—'}</td>
                    <td className="px-2 py-2 tabular-nums text-gray-600">{c.dupr_id}</td>
                    <td className="px-2 py-2 tabular-nums">{rating(c.rating_dobles)}</td>
                    <td className="px-2 py-2 tabular-nums">{rating(c.rating_singles)}</td>
                    <td className="px-2 py-2 text-gray-500">{fechaCorta(c.rating_at)}</td>
                    <td className="px-4 py-2 text-right">
                      <span className="inline-flex flex-wrap justify-end gap-1">
                        {c.admin_email && <Insignia tono="navy">Equipo</Insignia>}
                        {c.premium && <Insignia tono="info">DUPR+</Insignia>}
                        {c.habilitado === false && <Insignia tono="alerta">No habilitada</Insignia>}
                        {!c.suscripto && <Insignia tono="atencion">Sin aviso</Insignia>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}

// Revisar un cuadro contra DUPR y sincronizarlo: sube lo nuevo, corrige lo que cambió y borra
// lo que dejó de corresponder. Primero siempre se muestra qué va a pasar.
function SubirCuadro({ cuadros, conClub }: { cuadros: Cuadro[]; conClub: boolean }) {
  const [pedido, setPedido] = useState<PedidoTorneo>({ torneoId: '', fecha: hoy(), lugar: 'Pickleball City, Montevideo', evento: '', puntaje: 'SIDEOUT' });
  const [revision, setRevision] = useState<RevisionTorneo | null>(null);
  const [ocupado, setOcupado] = useState<'' | 'revisar' | 'sincronizar'>('');
  const [confirmar, setConfirmar] = useState(false);

  const cambiar = (cambio: Partial<PedidoTorneo>) => { setPedido((p) => ({ ...p, ...cambio })); setRevision(null); };
  const elegir = (torneoId: string) => {
    const c = cuadros.find((x) => x.id === torneoId);
    // el nombre del evento que va a DUPR: el del evento del cuadro, si tiene
    cambiar({ torneoId, evento: c?.evento ? `VOLEA ${c.evento}` : c ? `VOLEA ${c.nombre}` : '' });
  };

  const revisar = async () => {
    setOcupado('revisar');
    const r = await panelDupr.revisar(pedido);
    setOcupado('');
    if (!r.ok) { toast.error(r.error); return; }
    setRevision(r.datos);
  };
  const sincronizar = async () => {
    setConfirmar(false);
    setOcupado('sincronizar');
    const r = await panelDupr.sincronizar(pedido);
    setOcupado('');
    if (!r.ok) { toast.error(r.error); return; }
    setRevision(r.datos);
    const h = r.datos.hecho;
    if (!h) return;
    const partes = [h.subidos && `${h.subidos} subidos`, h.actualizados && `${h.actualizados} corregidos`, h.borrados && `${h.borrados} borrados`].filter(Boolean).join(' · ');
    if (h.errores.length > 0) toast.error(`DUPR rechazó ${h.errores.length}: mirá el motivo en la lista`);
    else if (h.pendientes > 0) toast.message(`${partes || 'Avanzó'} · quedan ${h.pendientes}: tocá de nuevo para terminar`);
    else toast.success(partes || 'No había nada para cambiar');
  };

  const res = revision?.resumen;
  const cambios = res ? res.porSubir + res.cambiaron + res.porBorrar : 0;

  return (
    <Tarjeta className="mb-4" titulo="Subir un cuadro a DUPR">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Cuadro">
          <Selector value={pedido.torneoId} onChange={(e) => elegir(e.target.value)}>
            <option value="">Elegí un cuadro…</option>
            {cuadros.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.fase === 'terminado' ? '' : ' (en juego)'}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Fecha en que se jugó">
          <Entrada type="date" value={pedido.fecha} max={hoy()} onChange={(e) => cambiar({ fecha: e.target.value })} />
        </Campo>
        <Campo etiqueta="Nombre del evento en DUPR">
          <Entrada value={pedido.evento} onChange={(e) => cambiar({ evento: e.target.value })} placeholder="VOLEA Aniversario Pickleball City 2026" />
        </Campo>
        <Campo etiqueta="Lugar">
          <Entrada value={pedido.lugar} onChange={(e) => cambiar({ lugar: e.target.value })} />
        </Campo>
        <Campo etiqueta="Puntaje" ayuda="Side out: suma solo el que saca. Rally: suma el que gana el punto.">
          <Selector value={pedido.puntaje} onChange={(e) => cambiar({ puntaje: e.target.value as PedidoTorneo['puntaje'] })}>
            <option value="SIDEOUT">Side out</option>
            <option value="RALLY">Rally</option>
          </Selector>
        </Campo>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Boton variante="secundario" cargando={ocupado === 'revisar'} disabled={!pedido.torneoId} onClick={() => void revisar()}>Revisar partidos</Boton>
        {revision && cambios > 0 && (
          <Boton icono={<Upload size={18} />} cargando={ocupado === 'sincronizar'} onClick={() => setConfirmar(true)}>
            Sincronizar con DUPR
          </Boton>
        )}
        {res && (
          <span className="text-[13px] text-gray-600">
            {res.subidos} subidos · {res.porSubir} por subir · {res.cambiaron} cambiaron · {res.porBorrar} por borrar · {res.noVan} no van
          </span>
        )}
      </div>

      {revision && (
        <ul className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200">
          {revision.partidos.map((p) => (
            <li key={p.partidoId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="w-24 shrink-0 text-[12px] font-semibold uppercase tracking-wide text-gray-500">{p.fase}</span>
              <span className="min-w-0 flex-1 text-navy-700">
                {p.a} <span className="text-gray-400">vs</span> {p.b}
                {p.puntos && <strong className="ml-2 tabular-nums">{p.puntos[0]}–{p.puntos[1]}</strong>}
              </span>
              <Insignia tono={TONO[p.estado]}>{p.estado}</Insignia>
              {(p.error ?? p.motivo) && (
                <span className={`w-full text-[13px] ${p.error ? 'font-semibold text-red-700' : 'text-gray-500'}`}>
                  {p.error ? `DUPR lo rechazó: ${p.error}` : p.motivo}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Confirmar
        abierto={confirmar}
        titulo="¿Sincronizar este cuadro con DUPR?"
        mensaje={res ? [
          res.porSubir > 0 && `Se suben ${res.porSubir} partidos`,
          res.cambiaron > 0 && `se corrigen ${res.cambiaron}`,
          res.porBorrar > 0 && `se borran ${res.porBorrar}`,
        ].filter(Boolean).join(', ') + `${conClub ? ' a nombre del club' : ''}. Los ratings de esos jugadores cambian en DUPR.` : ''}
        textoConfirmar="Sincronizar"
        variante="primario"
        alConfirmar={() => void sincronizar()}
        alCerrar={() => setConfirmar(false)}
      />
    </Tarjeta>
  );
}
