// Tanteador de bádminton dobles (Copa Badminton 06/09/2026). Réplica digital de
// la planilla en papel: dos zonas táctiles gigantes, la tira de puntos 1..tope
// que se va tachando, avisos de cambio de lado, deshacer, y todo persistido
// punto a punto en tanteador_partidos (Realtime refresca la lista en vivo entre
// dispositivos). Espejo en localStorage por si se corta la señal en la cancha.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft, ArrowLeftRight, BellOff, BookOpen, ChevronDown, ClipboardEdit, CloudOff, Medal, Megaphone, Pencil, Play, Plus,
  RotateCw, Trash2, Trophy, Undo2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';
import { SupabaseService } from '../services/supabaseService';
import type { TanteadorCategoria, TanteadorLado, TanteadorModo, TanteadorPartido } from '../types';
import { fechaHumana } from '../utils/fechas';
import { almacenLocal } from '../utils/almacen';
import {
  anotarPunto,
  cargarResultadoManual,
  corregirMarcadorActual,
  crearPartido,
  deshacerPunto,
  jugadoresDe,
  reiniciarPartido,
  marcadorActual,
  marcadorDe,
  propuestasLlave,
  resumenSets,
  setsGanados,
  tablaAmericano,
  tablaParejas,
  terminarManual,
  type AvisoPunto,
  type PropuestaLlave,
} from '../utils/tanteador';
import { Boton, BotonIcono, Campo, EncabezadoPagina, Entrada, Insignia, Segmentado, Selector, Vacio } from '../admin/ui';
import { cn } from '../lib/cn';

const ESPEJO_KEY = 'volea_tanteador_espejo';

function espejoLeer(): TanteadorPartido | null {
  return almacenLocal.leerJSON<TanteadorPartido>(ESPEJO_KEY);
}
// Sin storage no hay espejo; el guardado en la nube sigue igual (almacenLocal no tira).
function espejoGuardar(p: TanteadorPartido | null) {
  if (p) almacenLocal.guardarJSON(ESPEJO_KEY, p);
  else almacenLocal.borrar(ESPEJO_KEY);
}

type Vista = 'lista' | 'nuevo' | 'juego';
interface Aviso {
  titulo: string;
  detalle: string;
  boton: string;
  onOk?: () => void;
  cancelable?: boolean;
}
interface Sugerencia { torneoId: string; torneo: string; parejas: string[] }

export default function AdminTanteadorTab({ adminEmail }: { adminEmail: string }) {
  const [partidos, setPartidos] = useState<TanteadorPartido[] | null>(null);
  const [vista, setVista] = useState<Vista>('lista');
  const [actual, setActual] = useState<TanteadorPartido | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [corregir, setCorregir] = useState<{ a: string; b: string } | null>(null);
  const [llaveDe, setLlaveDe] = useState<{ cat: TanteadorCategoria; modo: TanteadorModo } | null>(null);
  const [resDe, setResDe] = useState<TanteadorPartido | null>(null);
  const [resSets, setResSets] = useState<string[][]>([['', ''], ['', ''], ['', '']]);
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);
  const [espejo, setEspejo] = useState<TanteadorPartido | null>(() => espejoLeer());

  // formulario — modo 'fijas': dos duplas · modo 'rotativas': 4 jugadores sueltos
  const [fCat, setFCat] = useState<TanteadorCategoria>('DM');
  const [fModo, setFModo] = useState<TanteadorModo>('fijas');
  const [fPa, setFPa] = useState('');
  const [fPb, setFPb] = useState('');
  const [fJug, setFJug] = useState<string[]>(['', '', '', '']);
  const [fJuez, setFJuez] = useState('');
  const [fCancha, setFCancha] = useState('1');
  const [fTorneoId, setFTorneoId] = useState<string | null>(null);

  const vistaRef = useRef(vista);
  vistaRef.current = vista;
  const ultimoAvisoOffline = useRef(0);
  // Aviso de conexión FIJO (antes era solo un toast cada 60 s, y en la cancha se perdía):
  // el último guardado falló o el teléfono dice que no tiene red. Solo muestra; el
  // guardado punto a punto y el espejo local siguen igual.
  const [ultimoGuardadoFallo, setUltimoGuardadoFallo] = useState(false);
  const [enLinea, setEnLinea] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setEnLinea(true);
    const off = () => setEnLinea(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const sinConexion = !enLinea || ultimoGuardadoFallo;
  const [reglamentoAbierto, setReglamentoAbierto] = useState(false);

  const cargar = useCallback(async () => {
    const ps = await SupabaseService.getTanteadorPartidos();
    if (ps) setPartidos(ps);
  }, []);

  useEffect(() => {
    void cargar();
    void SupabaseService.getTanteadorSugerencias().then((s) => { if (s) setSugerencias(s); });
  }, [cargar]);

  // Tiempo real (mismo patrón que el EN VIVO de torneos) + sondeo de respaldo.
  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let timer: number | undefined;
    const pedir = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void cargar(), 250);
    };
    const canal = sb.channel('tanteador-partidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tanteador_partidos' }, pedir)
      .subscribe();
    const sondeo = window.setInterval(() => {
      if (vistaRef.current === 'lista') void cargar();
    }, 60000);
    // En celular la pestaña se duerme y el canal Realtime muere: al volver
    // a la app, refetch para no mostrar datos viejos.
    const alVolver = () => { if (document.visibilityState === 'visible') void cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(sondeo);
      document.removeEventListener('visibilitychange', alVolver);
      void sb.removeChannel(canal);
    };
  }, [cargar]);

  const persistir = useCallback((p: TanteadorPartido) => {
    setActual(p);
    setPartidos((prev) => {
      const resto = (prev || []).filter((x) => x.id !== p.id);
      return [p, ...resto];
    });
    espejoGuardar(p.estado === 'en_juego' ? p : null);
    setEspejo(p.estado === 'en_juego' ? p : null);
    void SupabaseService.saveTanteadorPartido(p).then((ok) => {
      setUltimoGuardadoFallo(!ok);
      if (!ok && Date.now() - ultimoAvisoOffline.current > 60000) {
        ultimoAvisoOffline.current = Date.now();
        toast.error('Sin conexión: el partido sigue acá y se sube cuando vuelva la señal.');
      }
    });
  }, []);

  /* ───────── acciones de juego ───────── */
  const abrir = (p: TanteadorPartido) => {
    setActual(p);
    setVista('juego');
    window.scrollTo(0, 0);
  };

  const mostrarAviso = (a: AvisoPunto, p: TanteadorPartido) => {
    if (!a) return;
    if (a.tipo === 'cambio_lado') {
      setAviso({ titulo: 'CAMBIO DE LADO', detalle: `Un equipo llegó a ${p.cambioEn} en el 3er set.`, boton: 'Listo, seguimos' });
    } else if (a.tipo === 'fin_set') {
      const quien = a.ganador === 'A' ? p.parejaA : p.parejaB;
      setAviso({
        titulo: `FIN DEL ${a.numero}${a.numero === 1 ? 'ER' : 'DO'} SET`,
        detalle: `${quien} lo ganó ${a.marcador.a}-${a.marcador.b}. Cambio de lado.`,
        boton: '¡Seguimos!',
      });
    } else {
      const quien = a.ganador === 'A' ? p.parejaA : p.parejaB;
      setAviso({
        titulo: '¡PARTIDO!',
        detalle: `${quien} gana ${resumenSets(p)}.`,
        boton: 'Guardar y volver',
        onOk: () => setVista('lista'),
      });
    }
  };

  const tocar = (ladoPantalla: 'izq' | 'der') => {
    if (!actual || actual.estado !== 'en_juego') return;
    const lado: TanteadorLado = actual.invertido
      ? (ladoPantalla === 'izq' ? 'B' : 'A')
      : (ladoPantalla === 'izq' ? 'A' : 'B');
    const { partido: p, aviso: a } = anotarPunto(actual, lado);
    persistir(p);
    mostrarAviso(a, p);
  };

  const deshacer = () => {
    if (!actual) return;
    persistir(deshacerPunto(actual));
  };

  const abrirCorregir = () => {
    if (!actual || actual.estado !== 'en_juego') return;
    const s = marcadorActual(actual);
    setCorregir({ a: String(s.a), b: String(s.b) });
  };

  const guardarCorreccion = () => {
    if (!actual || !corregir) return;
    const r = corregirMarcadorActual(actual, parseInt(corregir.a, 10), parseInt(corregir.b, 10));
    if (!r.ok) { toast.error(r.error); return; }
    persistir(r.partido);
    setCorregir(null);
  };

  /** Guarda un partido SIN convertirlo en el activo (largar, resultado manual). */
  const guardarSuelto = useCallback((p: TanteadorPartido) => {
    const conFecha = { ...p, updatedAt: new Date().toISOString() };
    setPartidos((prev) => [conFecha, ...(prev || []).filter((x) => x.id !== p.id)]);
    void SupabaseService.saveTanteadorPartido(conFecha).then((ok) => {
      if (!ok) toast.error('Sin conexión: no se guardó, reintentá.');
      void cargar();
    });
  }, [cargar]);

  const largar = (p: TanteadorPartido) => {
    guardarSuelto({ ...p, llamadoAt: new Date().toISOString() });
    toast.success(`A la cancha ${p.cancha}: ${p.parejaA} vs ${p.parejaB}`);
  };

  const guardarResultado = () => {
    if (!resDe) return;
    const sets = resSets
      .filter(([a, b]) => a.trim() !== '' && b.trim() !== '')
      .map(([a, b]) => ({ a: parseInt(a, 10), b: parseInt(b, 10) }));
    const r = cargarResultadoManual(resDe, sets);
    if (!r.ok) { toast.error(r.error); return; }
    guardarSuelto(r.partido);
    setResDe(null);
    toast.success(`Resultado cargado: ${r.partido.ganador === 'A' ? r.partido.parejaA : r.partido.parejaB} gana`);
  };

  const crearLlave = (prop: PropuestaLlave) => {
    if (!llaveDe) return;
    const nuevos = prop.partidos.map((m, i) =>
      crearPartido({
        id: crypto.randomUUID(),
        categoria: llaveDe.cat,
        modo: llaveDe.modo,
        fase: 'llave',
        titulo: m.titulo,
        parejaA: m.parejaA,
        parejaB: m.parejaB,
        jugadoresA: m.jugadoresA,
        jugadoresB: m.jugadoresB,
        cancha: String(i + 1),
        creadoPor: adminEmail,
      }),
    );
    setLlaveDe(null);
    setPartidos((prev) => [...nuevos, ...(prev || [])]);
    void Promise.all(nuevos.map((p) => SupabaseService.saveTanteadorPartido(p))).then((oks) => {
      if (oks.every(Boolean)) toast.success(nuevos.length === 1 ? `${nuevos[0].titulo} creada` : 'Semifinales creadas');
      else toast.error('No se pudo guardar la llave en la nube — reintentá.');
      void cargar();
    });
  };

  const pedirReinicio = () => {
    if (!actual) return;
    setCorregir(null);
    setAviso({
      titulo: '¿Reiniciar el partido?',
      detalle: `${actual.parejaA} vs ${actual.parejaB} vuelve a 0-0: se borran todos los sets y puntos.`,
      boton: 'Sí, reiniciar',
      cancelable: true,
      onOk: () => persistir(reiniciarPartido(actual)),
    });
  };

  const terminar = () => {
    if (!actual) return;
    if (actual.estado === 'final') { setVista('lista'); return; }
    const s = marcadorActual(actual);
    setAviso({
      titulo: '¿Terminar partido?',
      detalle: `Va ${resumenSets(actual) || 'sin sets cerrados'}${s.a + s.b ? ` y el set actual ${s.a}-${s.b}` : ''}. Se guarda como está.`,
      boton: 'Sí, terminar',
      cancelable: true,
      onOk: () => {
        persistir(terminarManual(actual));
        setVista('lista');
      },
    });
  };

  const borrar = (p: TanteadorPartido) => {
    setAviso({
      titulo: '¿Borrar partido?',
      detalle: `${p.parejaA} vs ${p.parejaB}. No se puede deshacer.`,
      boton: 'Borrar',
      cancelable: true,
      onOk: () => {
        setPartidos((prev) => (prev || []).filter((x) => x.id !== p.id));
        if (espejo?.id === p.id) { espejoGuardar(null); setEspejo(null); }
        void SupabaseService.deleteTanteadorPartido(p.id).then((ok) => {
          if (!ok) { toast.error('No se pudo borrar en la nube.'); void cargar(); }
        });
      },
    });
  };

  /* ───────── nuevo partido ───────── */
  const abrirNuevo = () => {
    setFPa(''); setFPb(''); setFJug(['', '', '', '']); setFJuez(''); setFTorneoId(null);
    setFModo(fCat === 'DM' ? 'fijas' : 'rotativas');
    setVista('nuevo');
    window.scrollTo(0, 0);
  };

  const partirNombres = (texto: string) =>
    texto.split(/\s*[/\-]\s*/).map((s) => s.trim().toUpperCase()).filter(Boolean);

  const empezar = () => {
    // Formato de la copa: a 15 (tope 21), al mejor de 3. reglasPara(21) queda
    // en utils para torneos futuros.
    const base = {
      id: crypto.randomUUID(),
      categoria: fCat,
      modo: fModo,
      juez: fJuez.trim(),
      cancha: fCancha,
      obj: 15 as const,
      torneoId: fTorneoId,
      creadoPor: adminEmail,
    };
    let p: TanteadorPartido;
    if (fModo === 'fijas') {
      const pa = fPa.trim().toUpperCase();
      const pb = fPb.trim().toUpperCase();
      p = crearPartido({ ...base, parejaA: pa, parejaB: pb, jugadoresA: partirNombres(pa), jugadoresB: partirNombres(pb) });
    } else {
      const [a1, a2, b1, b2] = fJug.map((j) => j.trim().toUpperCase());
      p = crearPartido({ ...base, parejaA: `${a1} / ${a2}`, parejaB: `${b1} / ${b2}`, jugadoresA: [a1, a2], jugadoresB: [b1, b2] });
    }
    persistir(p);
    setVista('juego');
    window.scrollTo(0, 0);
  };

  // Pool de nombres para armar el partido con toques: jugadores de partidos ya
  // cargados en la categoría + los de las parejas de los torneos activos.
  const nombresSugeridos = (() => {
    const pool = new Set<string>();
    for (const p of partidos || []) {
      if (p.categoria !== fCat) continue;
      for (const lado of ['A', 'B'] as const) jugadoresDe(p, lado).forEach((n) => pool.add(n));
    }
    for (const s of sugerencias) {
      if (fCat === 'DF' ? !/FEMENIN/i.test(s.torneo) : /FEMENIN/i.test(s.torneo)) continue;
      for (const pareja of s.parejas) {
        pareja.split(/\s*[/\-]\s*/).forEach((n) => {
          const t = n.trim().toUpperCase();
          if (t) pool.add(t);
        });
      }
    }
    const elegidos = fJug.map((j) => j.trim().toUpperCase());
    return [...pool].sort().filter((n) => !elegidos.includes(n));
  })();

  const ponerNombre = (nombre: string) => {
    const i = fJug.findIndex((j) => !j.trim());
    if (i === -1) return;
    setFJug(fJug.map((j, k) => (k === i ? nombre : j)));
  };

  // Duplas para el modo fijas. Las etiquetas de partidos ya cargados mandan
  // (la tabla agrupa por ese texto EXACTO); los torneos solo siembran la
  // primera vez, para no ofrecer la misma dupla escrita de dos maneras.
  const duplasSugeridas = (() => {
    const pool = new Set<string>();
    for (const p of partidos || []) {
      if (p.categoria !== fCat || p.modo !== 'fijas') continue;
      pool.add(p.parejaA);
      pool.add(p.parejaB);
    }
    if (!pool.size) {
      for (const s of sugerencias) {
        if (fCat === 'DF' ? !/FEMENIN/i.test(s.torneo) : /FEMENIN/i.test(s.torneo)) continue;
        for (const pareja of s.parejas) pool.add(partirNombres(pareja).join(' / '));
      }
    }
    const sel = [fPa.trim().toUpperCase(), fPb.trim().toUpperCase()];
    return [...pool].sort().filter((n) => !sel.includes(n));
  })();

  const ponerDupla = (nombre: string) => {
    if (!fPa.trim()) setFPa(nombre);
    else if (!fPb.trim()) setFPb(nombre);
  };

  const jugLimpios = fJug.map((j) => j.trim().toUpperCase());
  const formValido = fModo === 'fijas'
    ? !!(fPa.trim() && fPb.trim() && fPa.trim().toUpperCase() !== fPb.trim().toUpperCase())
    : jugLimpios.every(Boolean) && new Set(jugLimpios).size === 4;

  /* ───────── render ───────── */
  const vivos = (partidos || []).filter((p) => p.estado === 'en_juego');
  const puntosDe = (p: TanteadorPartido) => p.hist.reduce((n, h) => n + h.length, 0);
  const enJuego = vivos.filter((p) => puntosDe(p) > 0);
  // Los cruces precargados: en juego sin puntos = todavía no arrancaron.
  // Los "largados" (llamados a cancha) van primero.
  const porJugar = vivos.filter((p) => puntosDe(p) === 0).sort(
    (a, b) => (b.llamadoAt ? 1 : 0) - (a.llamadoAt ? 1 : 0) || a.createdAt.localeCompare(b.createdAt),
  );
  const finales = (partidos || []).filter((p) => p.estado === 'final');
  const espejoPendiente = espejo && espejo.estado === 'en_juego' && !vivos.some((p) => p.id === espejo.id)
    ? espejo : null;

  const abrirResultado = (x: TanteadorPartido) => { setResSets([['', ''], ['', ''], ['', '']]); setResDe(x); };
  const anularLlamado = (x: TanteadorPartido) => guardarSuelto({ ...x, llamadoAt: null });
  const tarjeta = (p: TanteadorPartido) => (
    <Card key={p.id} p={p} onAbrir={abrir} onBorrar={borrar} onLargar={largar} onAnularLlamado={anularLlamado} onResultado={abrirResultado} />
  );
  // Descartar el espejo borra lo único que hay de ese partido si nunca llegó a subirse:
  // se pregunta antes (antes era una X suelta).
  const descartarEspejo = () => setAviso({
    titulo: '¿Descartar el partido guardado?',
    detalle: 'Está guardado solo en este teléfono. Si no llegó a subirse, se pierde.',
    boton: 'Sí, descartar',
    cancelable: true,
    onOk: () => { espejoGuardar(null); setEspejo(null); },
  });

  return (
    <div>
      {vista !== 'juego' && (
        <EncabezadoPagina
          rotulo="Torneos"
          titulo="Tanteador"
          descripcion="Planilla digital de bádminton dobles: punto a punto, con avisos de cambio de lado."
          acciones={vista === 'lista' ? (
            <Boton icono={<Plus size={18} />} onClick={abrirNuevo} className="w-full sm:w-auto">Nuevo partido</Boton>
          ) : undefined}
        />
      )}

      {/* ============ LISTA ============ */}
      {vista === 'lista' && (
        <div className="space-y-6">
          {sinConexion && <AvisoConexion />}

          {/* Reglamento plegado (antes era un bloque fijo arriba de todo). */}
          <section className="rounded-xl border border-gray-200 bg-white">
            <button
              type="button"
              onClick={() => setReglamentoAbierto((a) => !a)}
              aria-expanded={reglamentoAbierto}
              className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left"
            >
              <BookOpen size={18} className="shrink-0 text-navy-700" aria-hidden />
              <span className="min-w-0 flex-1 font-display text-sm font-bold text-navy-700">Reglamento · Copa Badminton · Pickleball City</span>
              <ChevronDown size={18} aria-hidden className={cn('shrink-0 text-gray-500 transition-transform', reglamentoAbierto && 'rotate-180')} />
            </button>
            {reglamentoAbierto && (
              <ul className="space-y-1.5 border-t border-gray-100 px-4 py-3 text-sm text-gray-700">
                <li><b className="text-navy-700">Masculino:</b> duplas fijas, todos contra todos.</li>
                <li><b className="text-navy-700">Femenino:</b> americano (rotativas, ida y vuelta).</li>
                <li>Sets a 15 (desde 14-14 por 2, tope 21) · al mejor de 3.</li>
                <li>Cambio de lado a los 8 del 3er set.</li>
              </ul>
            )}
          </section>

          {espejoPendiente && (
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => abrir(espejoPendiente)}
                className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 rounded-xl border-2 border-navy-700 bg-white px-4 py-2 text-left text-sm font-semibold text-navy-700"
              >
                <Play size={18} className="shrink-0" aria-hidden />
                <span className="min-w-0">Retomar partido en curso: {espejoPendiente.parejaA} vs {espejoPendiente.parejaB}</span>
              </button>
              <BotonIcono
                etiqueta="Descartar el partido guardado en este dispositivo"
                icono={<X size={18} />}
                tono="peligro"
                onClick={descartarEspejo}
                className="h-auto self-stretch border border-gray-200 bg-white"
              />
            </div>
          )}

          {partidos === null && <p className="py-6 text-center text-sm text-gray-600">Cargando partidos…</p>}

          {enJuego.length > 0 && (
            <SeccionLista titulo="En juego" cantidad={enJuego.length}>{enJuego.map(tarjeta)}</SeccionLista>
          )}
          {porJugar.length > 0 && (
            <SeccionLista titulo="Cruces por jugar" cantidad={porJugar.length}>{porJugar.map(tarjeta)}</SeccionLista>
          )}
          {(['DM', 'DF'] as const).flatMap((cat) => {
            const deCat = (partidos || []).filter((p) => p.categoria === cat);
            const bloques = [
              { clave: `${cat}-duplas`, titulo: 'de duplas', unidad: 'Dupla', modo: 'fijas' as const, filas: tablaParejas(deCat.filter((p) => p.modo === 'fijas'), cat) },
              { clave: `${cat}-ind`, titulo: 'individual', unidad: 'Jugador', modo: 'rotativas' as const, filas: tablaAmericano(deCat.filter((p) => p.modo === 'rotativas'), cat) },
            ].filter((b) => b.filas.length > 0);
            return bloques.map(({ clave, titulo, unidad, modo, filas: tabla }) => (
              <section key={clave}>
                <h2 className="mb-2 font-display text-xs font-bold uppercase tracking-[0.15em] text-gray-600">
                  Tabla {titulo} — {cat === 'DM' ? 'Masculino' : 'Femenino'}
                </h2>
                <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 text-left font-display text-[11px] font-bold uppercase tracking-wider text-gray-600">
                        <th scope="col" className="w-12 px-3 py-2.5">#</th>
                        <th scope="col" className="py-2.5">{unidad}</th>
                        <th scope="col" className="px-2 py-2.5 text-center">PJ</th>
                        <th scope="col" className="px-2 py-2.5 text-center">PG</th>
                        <th scope="col" className="px-2 py-2.5 text-center">Dif</th>
                        <th scope="col" className="px-2 py-2.5 text-center">PF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {tabla.map((f, i) => (
                        <tr key={f.nombre} className={i === 0 ? 'bg-navy-50 font-bold text-navy-700' : i === 1 ? 'font-semibold text-navy-700' : 'text-gray-700'}>
                          <td className="px-3 py-2.5">
                            {i < 2
                              ? <Medal size={17} className={i === 0 ? 'text-amber-500' : 'text-gray-400'} role="img" aria-label={`${i + 1}º`} />
                              : i + 1}
                          </td>
                          <td className="py-2.5">{f.nombre}</td>
                          <td className="px-2 py-2.5 text-center">{f.pj}</td>
                          <td className="px-2 py-2.5 text-center">{f.pg}</td>
                          <td className="px-2 py-2.5 text-center">{f.dif > 0 ? `+${f.dif}` : f.dif}</td>
                          <td className="px-2 py-2.5 text-center">{f.pf}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5 px-1 text-[12px] text-gray-500">
                  Orden: partidos ganados → diferencia de puntos → puntos a favor. Solo fase de grupos terminada (la llave no suma acá).
                </p>
                {propuestasLlave(partidos || [], cat, modo).length > 0 && (
                  <Boton icono={<Trophy size={18} />} onClick={() => setLlaveDe({ cat, modo })} className="mt-3 w-full sm:w-auto">
                    Armar llave — {cat === 'DM' ? 'Masculino' : 'Femenino'}
                  </Boton>
                )}
              </section>
            ));
          })}

          {finales.length > 0 && (
            <SeccionLista titulo="Finalizados" cantidad={finales.length}>{finales.map(tarjeta)}</SeccionLista>
          )}
          {partidos !== null && !vivos.length && !finales.length && (
            <Vacio
              titulo="Todavía no hay partidos"
              descripcion="Cada partido queda como una tarjeta: las duplas, los sets (ej. 15-9 · 12-15 · 15-11) y la cancha."
              accion={<Boton icono={<Plus size={18} />} onClick={abrirNuevo}>Nuevo partido</Boton>}
            />
          )}
        </div>
      )}

      {/* ============ NUEVO ============ */}
      {vista === 'nuevo' && (
        <div className="max-w-xl">
          <Boton variante="fantasma" icono={<ArrowLeft size={18} />} onClick={() => setVista('lista')} className="-ml-3 mb-2">
            Partidos
          </Boton>
          <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-4 md:p-5">
            <h2 className="font-display text-lg font-bold text-navy-700">Nuevo partido</h2>

            <div>
              <p className="mb-1.5 text-[13px] font-semibold text-navy-700">Categoría</p>
              <Segmentado
                etiqueta="Categoría"
                anchoCompleto
                valor={fCat}
                alCambiar={(c) => { setFCat(c); setFModo(c === 'DM' ? 'fijas' : 'rotativas'); }}
                opciones={[{ valor: 'DM', texto: 'Dobles Masculino' }, { valor: 'DF', texto: 'Dobles Femenino' }]}
              />
            </div>

            <div>
              <p className="mb-1.5 text-[13px] font-semibold text-navy-700">Formato</p>
              <Segmentado
                etiqueta="Formato"
                anchoCompleto
                valor={fModo}
                alCambiar={setFModo}
                opciones={[{ valor: 'fijas', texto: 'Duplas fijas' }, { valor: 'rotativas', texto: 'Rotativas (americano)' }]}
              />
              <p className="mt-1.5 text-[13px] text-gray-500">Duplas fijas: la tabla suma por pareja. Rotativas: la tabla suma por jugador.</p>
            </div>

            {fModo === 'fijas' ? (
              <div className="space-y-3">
                <Campo etiqueta={<EtiquetaLado lado="A">Dupla A · lado lima</EtiquetaLado>}>
                  <Entrada
                    value={fPa}
                    onChange={(e) => setFPa(e.target.value.toUpperCase())}
                    placeholder="APELLIDO / APELLIDO"
                    autoComplete="off"
                    className="border-l-4 border-l-lime-500 font-semibold uppercase"
                  />
                </Campo>
                <Campo etiqueta={<EtiquetaLado lado="B">Dupla B · lado rosa</EtiquetaLado>}>
                  <Entrada
                    value={fPb}
                    onChange={(e) => setFPb(e.target.value.toUpperCase())}
                    placeholder="APELLIDO / APELLIDO"
                    autoComplete="off"
                    className="border-l-4 border-l-[#E91E8C] font-semibold uppercase"
                  />
                </Campo>
                {duplasSugeridas.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {duplasSugeridas.map((n) => (
                      <button key={n} type="button" onClick={() => ponerDupla(n)} className={CLASE_SUGERENCIA}>{n}</button>
                    ))}
                  </div>
                )}
                <p className="text-[13px] text-gray-500">Tocá una dupla y va al primer lugar libre. Usá siempre el mismo nombre de dupla para que la tabla sume bien.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {fJug.map((v, i) => (
                    <Campo key={i} etiqueta={<EtiquetaLado lado={i < 2 ? 'A' : 'B'}>{i < 2 ? `A${i + 1} · lima` : `B${i - 1} · rosa`}</EtiquetaLado>}>
                      <Entrada
                        value={v}
                        onChange={(e) => setFJug(fJug.map((j, k) => (k === i ? e.target.value.toUpperCase() : j)))}
                        placeholder={i < 2 ? `JUGADOR A${i + 1}` : `JUGADOR B${i - 1}`}
                        autoComplete="off"
                        className={cn('border-l-4 font-semibold uppercase', i < 2 ? 'border-l-lime-500' : 'border-l-[#E91E8C]')}
                      />
                    </Campo>
                  ))}
                </div>
                {nombresSugeridos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {nombresSugeridos.map((n) => (
                      <button key={n} type="button" onClick={() => ponerNombre(n)} className={CLASE_SUGERENCIA}>{n}</button>
                    ))}
                  </div>
                )}
                <p className="text-[13px] text-gray-500">Tocá un nombre y va al primer lugar libre. Usá siempre el mismo nombre de jugador para que la tabla sume bien.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Juez (opcional)">
                <Entrada value={fJuez} onChange={(e) => setFJuez(e.target.value)} autoComplete="off" />
              </Campo>
              <Campo etiqueta="Cancha">
                <Selector value={fCancha} onChange={(e) => setFCancha(e.target.value)}>
                  {['1', '2', '3'].map((c) => <option key={c}>{c}</option>)}
                </Selector>
              </Campo>
            </div>

            <p className="rounded-lg bg-gray-50 px-3 py-2 text-[13px] font-semibold text-gray-700">
              Formato de la copa: sets a 15 (desde 14-14 por 2, tope 21) · al mejor de 3.
            </p>

            <div className="grid grid-cols-3 gap-2">
              <Boton variante="secundario" onClick={() => setVista('lista')}>Volver</Boton>
              <Boton onClick={empezar} disabled={!formValido} className="col-span-2">Empezar partido</Boton>
            </div>
          </div>
        </div>
      )}

      {/* ============ JUEGO ============ */}
      {vista === 'juego' && actual && (
        <Juego
          p={actual}
          sinConexion={sinConexion}
          onReintentar={() => persistir(actual)}
          onTocar={tocar}
          onDeshacer={deshacer}
          onInvertir={() => persistir({ ...actual, invertido: !actual.invertido })}
          onCorregir={abrirCorregir}
          onTerminar={terminar}
          onVolver={() => setVista('lista')}
        />
      )}

      {/* ============ RESULTADO MANUAL (de la hoja) ============ */}
      {resDe && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-900/95 p-4">
          <div role="dialog" aria-modal="true" aria-label="Cargar resultado" className="w-full max-w-sm rounded-2xl bg-white p-5">
            <p className="font-display text-lg font-bold text-navy-700">Cargar resultado</p>
            <p className="mt-0.5 text-[13px] text-gray-600">De la hoja al sistema. El 3er set solo si se jugó.</p>
            <div className="mt-4 grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-2 text-[13px] font-bold text-navy-700">
              <span />
              <EtiquetaLado lado="A"><span className="truncate">{resDe.parejaA}</span></EtiquetaLado>
              <EtiquetaLado lado="B"><span className="truncate">{resDe.parejaB}</span></EtiquetaLado>
              {resSets.map((fila, i) => (
                [
                  <span key={`l${i}`} className="font-display text-gray-600">Set {i + 1}</span>,
                  ...([0, 1] as const).map((j) => (
                    <input
                      key={`s${i}${j}`}
                      type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} autoComplete="off"
                      aria-label={`Set ${i + 1}, ${j === 0 ? resDe.parejaA : resDe.parejaB}`}
                      value={fila[j]}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D+/g, '');
                        setResSets(resSets.map((f, k) => (k === i ? f.map((x, l) => (l === j ? v : x)) : f)));
                      }}
                      className="h-12 w-full rounded-lg border border-gray-300 px-2 text-center font-display text-xl font-bold tabular-nums text-navy-700 focus:border-navy-700 focus:outline-none focus:ring-2 focus:ring-navy-700/15"
                    />
                  )),
                ]
              ))}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Boton variante="secundario" onClick={() => setResDe(null)}>Cancelar</Boton>
              <Boton onClick={guardarResultado}>Guardar</Boton>
            </div>
          </div>
        </div>
      )}

      {/* ============ ARMAR LLAVE ============ */}
      {llaveDe && (() => {
        const props = propuestasLlave(partidos || [], llaveDe.cat, llaveDe.modo);
        const pendientes = (partidos || []).filter(
          (p) => p.categoria === llaveDe.cat && p.modo === llaveDe.modo && p.fase === 'grupos' && p.estado === 'en_juego',
        ).length;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-900/95 p-4">
            <div role="dialog" aria-modal="true" aria-label="Armar llave" className="w-full max-w-md rounded-2xl bg-white p-5">
              <p className="font-display text-lg font-bold text-navy-700">
                Armar llave — {llaveDe.cat === 'DM' ? 'Masculino' : 'Femenino'}
              </p>
              {pendientes > 0 && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-900">
                  Quedan {pendientes} cruce{pendientes > 1 ? 's' : ''} de grupo sin terminar. La siembra usa la tabla como está AHORA.
                </p>
              )}
              <div className="mt-3 space-y-2">
                {props.map((prop) => (
                  <button
                    key={prop.id}
                    type="button"
                    onClick={() => crearLlave(prop)}
                    className="w-full rounded-xl border border-gray-300 bg-white p-3.5 text-left transition-colors hover:border-navy-700"
                  >
                    <p className="font-display text-sm font-bold text-navy-700">{prop.etiqueta}</p>
                    <p className="mt-0.5 text-[13px] text-gray-600">{prop.detalle}</p>
                  </button>
                ))}
                {props.length === 0 && (
                  <p className="text-sm text-gray-600">Nada para armar: o la llave ya está creada, o las semis siguen en juego.</p>
                )}
              </div>
              <Boton variante="secundario" anchoCompleto onClick={() => setLlaveDe(null)} className="mt-3">Cancelar</Boton>
            </div>
          </div>
        );
      })()}

      {/* ============ CORREGIR MARCADOR ============ */}
      {corregir && actual && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-900/95 p-4">
          <div role="dialog" aria-modal="true" aria-label="Corregir marcador" className="w-full max-w-sm rounded-2xl bg-white p-5">
            <p className="font-display text-lg font-bold text-navy-700">Corregir marcador</p>
            <p className="mt-0.5 text-[13px] text-gray-600">Set {actual.sets.length + 1} en curso. Los sets ya cerrados no se tocan (para eso está Deshacer).</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {(['a', 'b'] as const).map((l) => (
                <label key={l} className="block min-w-0">
                  <EtiquetaLado lado={l === 'a' ? 'A' : 'B'}>
                    <span className="truncate text-[13px] font-bold text-navy-700">{l === 'a' ? actual.parejaA : actual.parejaB}</span>
                  </EtiquetaLado>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} autoComplete="off"
                    value={corregir[l]}
                    onChange={(e) => setCorregir({ ...corregir, [l]: e.target.value.replace(/\D+/g, '') })}
                    className={cn(
                      'mt-1.5 h-14 w-full rounded-lg border border-l-4 border-gray-300 px-3 text-center font-display text-2xl font-bold tabular-nums text-navy-700 focus:border-navy-700 focus:outline-none focus:ring-2 focus:ring-navy-700/15',
                      l === 'a' ? 'border-l-lime-500' : 'border-l-[#E91E8C]',
                    )}
                  />
                </label>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Boton variante="secundario" onClick={() => setCorregir(null)}>Cancelar</Boton>
              <Boton onClick={guardarCorreccion}>Guardar</Boton>
            </div>
            <Boton variante="fantasma" anchoCompleto onClick={pedirReinicio} className="mt-2 text-red-700 hover:bg-red-50">
              Reiniciar partido a 0-0 (borra todos los tantos)
            </Boton>
          </div>
        </div>
      )}

      {/* ============ OVERLAY ============ */}
      {aviso && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-navy-900/95 p-6">
          <div role="alertdialog" aria-modal="true" aria-label={aviso.titulo} className="w-full max-w-md text-center">
            <p className="font-display text-4xl font-black leading-tight text-lime-400 sm:text-5xl">{aviso.titulo}</p>
            <p className="mt-3 text-lg font-semibold text-white">{aviso.detalle}</p>
            <Boton
              variante="acento"
              anchoCompleto
              onClick={() => { const ok = aviso.onOk; setAviso(null); ok?.(); }}
              className="mt-6 h-14 text-base"
            >
              {aviso.boton}
            </Boton>
            {aviso.cancelable && (
              <button
                type="button"
                onClick={() => setAviso(null)}
                className="mt-2.5 h-12 w-full rounded-lg border border-white/30 px-4 font-display text-sm font-bold text-white transition-colors hover:bg-white/10"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const CLASE_SUGERENCIA = 'inline-flex h-9 items-center rounded-full border border-gray-300 bg-white px-3.5 text-[13px] font-semibold text-navy-700 transition-colors hover:border-navy-700';

/** Punto de color del lado (lima = A, rosa = B): mismo código que la pantalla de juego. */
function EtiquetaLado({ lado, children }: { lado: 'A' | 'B'; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden className={cn('h-3 w-3 shrink-0 rounded-full ring-1', lado === 'A' ? 'bg-lime-400 ring-lime-600' : 'bg-[#E91E8C] ring-[#b0156a]')} />
      {children}
    </span>
  );
}

function SeccionLista({ titulo, cantidad, children }: { titulo: string; cantidad: number; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 font-display text-xs font-bold uppercase tracking-[0.15em] text-gray-600">
        {titulo} <Insignia>{cantidad}</Insignia>
      </h2>
      <div className="grid gap-2 xl:grid-cols-2">{children}</div>
    </section>
  );
}

/** Aviso fijo de conexión (en la lista y arriba del marcador): antes era solo un toast. */
function AvisoConexion({ oscuro = false, onReintentar }: { oscuro?: boolean; onReintentar?: () => void }) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold',
        oscuro ? 'bg-red-600 text-white' : 'border border-red-200 bg-red-50 text-red-800',
      )}
    >
      <CloudOff size={18} className="shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">Sin conexión: el partido sigue guardado en este teléfono y se sube con el próximo punto que tenga señal.</span>
      {onReintentar && (
        <button
          type="button"
          onClick={onReintentar}
          className={cn(
            'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-bold',
            oscuro ? 'bg-white text-red-700' : 'border border-red-300 bg-white text-red-700',
          )}
        >
          <RotateCw size={15} aria-hidden /> Reintentar
        </button>
      )}
    </div>
  );
}

/* ───────── tarjeta de la lista ───────── */
// La tarjeta entera es un botón (abre el partido) y las acciones van en una barra aparte:
// antes era un div clickeable con botones chiquitos adentro y se abría el partido al
// errarle al botón.
function Card({ p, onAbrir, onBorrar, onLargar, onAnularLlamado, onResultado }: {
  p: TanteadorPartido;
  onAbrir: (p: TanteadorPartido) => void;
  onBorrar: (p: TanteadorPartido) => void;
  onLargar: (p: TanteadorPartido) => void;
  onAnularLlamado: (p: TanteadorPartido) => void;
  onResultado: (p: TanteadorPartido) => void;
}) {
  const vivo = p.estado === 'en_juego';
  const s = vivo ? marcadorActual(p) : null;
  const pts = p.hist.reduce((n, h) => n + h.length, 0);
  const llamado = vivo && pts === 0 && !!p.llamadoAt;
  return (
    <div className={cn('flex rounded-xl border bg-white', vivo ? 'flex-col' : 'items-stretch', llamado ? 'border-navy-700 ring-1 ring-navy-700' : 'border-gray-200')}>
      <button type="button" onClick={() => onAbrir(p)} className={cn('block min-w-0 flex-1 p-4 text-left transition-colors hover:bg-gray-50', vivo ? 'rounded-t-xl' : 'rounded-l-xl')}>
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 space-y-1">
            {(['A', 'B'] as const).map((lado) => (
              <span key={lado} className={cn('flex items-center gap-1.5 text-[15px] leading-snug', p.ganador === lado ? 'font-bold text-navy-700' : 'text-gray-700')}>
                {p.ganador === lado && <Trophy size={15} className="shrink-0 text-emerald-700" role="img" aria-label="Ganó" />}
                <span className="truncate">{lado === 'A' ? p.parejaA : p.parejaB}</span>
              </span>
            ))}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1 font-display text-[15px] font-bold tabular-nums text-navy-700">
            {resumenSets(p)}
            {vivo && s && (pts > 0 || p.sets.length > 0) && (
              <span className="rounded-md bg-lime-400 px-2 py-0.5 text-navy-900" aria-label={`Set en curso ${s.a} a ${s.b}`}>{s.a}-{s.b}</span>
            )}
          </span>
        </span>
        <span className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[13px] text-gray-600">
          {p.fase === 'llave' && <Insignia tono="navy">{p.titulo || 'LLAVE'}</Insignia>}
          <Insignia>{p.categoria === 'DM' ? 'Masculino' : 'Femenino'}</Insignia>
          {vivo
            ? pts > 0
              ? <Insignia tono="vivo" punto>En juego</Insignia>
              : llamado ? <Insignia tono="vivo" punto>Llamado a cancha</Insignia> : <Insignia tono="info">Por jugar</Insignia>
            : <Insignia>Final</Insignia>}
          <span>Cancha {p.cancha}{p.juez ? ` · Juez: ${p.juez}` : ''}</span>
          <span>· {fechaHumana(p.createdAt, Date.now())}</span>
        </span>
      </button>
      {!vivo && (
        <div className="flex shrink-0 items-start border-l border-gray-100 p-1">
          <BotonIcono etiqueta={`Borrar ${p.parejaA} vs ${p.parejaB}`} icono={<Trash2 size={18} />} tono="peligro" onClick={() => onBorrar(p)} />
        </div>
      )}
      {vivo && <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-2 py-2">
        {vivo && pts === 0 && !p.llamadoAt && (
          <Boton icono={<Megaphone size={16} />} onClick={() => onLargar(p)} className="px-3.5">Largar</Boton>
        )}
        {llamado && (
          <Boton variante="secundario" icono={<BellOff size={16} />} onClick={() => onAnularLlamado(p)} className="px-3.5" aria-label="Anular el llamado a cancha">Anular</Boton>
        )}
        {vivo && (
          <Boton variante="secundario" icono={<ClipboardEdit size={16} />} onClick={() => onResultado(p)} className="px-3.5">Resultado</Boton>
        )}
        <BotonIcono etiqueta={`Borrar ${p.parejaA} vs ${p.parejaB}`} icono={<Trash2 size={18} />} tono="peligro" onClick={() => onBorrar(p)} className="ml-auto" />
      </div>}
    </div>
  );
}

/* ───────── pantalla de juego ───────── */
function Juego({ p, sinConexion, onReintentar, onTocar, onDeshacer, onInvertir, onCorregir, onTerminar, onVolver }: {
  p: TanteadorPartido;
  sinConexion: boolean;
  onReintentar: () => void;
  onTocar: (lado: 'izq' | 'der') => void;
  onDeshacer: () => void;
  onInvertir: () => void;
  onCorregir: () => void;
  onTerminar: () => void;
  onVolver: () => void;
}) {
  const s = marcadorActual(p);
  const sg = setsGanados(p);
  const izqEsA = !p.invertido;
  const ult = p.hist[p.hist.length - 1]?.slice(-1)[0] ?? null;
  const puedeDeshacer = p.hist.some((h) => h.length) || p.estado === 'final';

  const zona = (ladoPantalla: 'izq' | 'der') => {
    const esA = ladoPantalla === 'izq' ? izqEsA : !izqEsA;
    const nombre = esA ? p.parejaA : p.parejaB;
    const puntos = esA ? s.a : s.b;
    const sets = esA ? sg.A : sg.B;
    const sirve = ult !== null && (esA ? ult === 'A' : ult === 'B');
    return (
      <button
        onClick={() => onTocar(ladoPantalla)}
        disabled={p.estado !== 'en_juego'}
        className={`relative flex min-h-[36vh] flex-col items-center justify-between rounded-2xl border-2 px-2 pb-4 pt-8 text-center active:brightness-125 disabled:opacity-70 ${
          esA ? 'border-lime-400 bg-lime-400/10' : 'border-[#E91E8C] bg-[#E91E8C]/10'
        }`}
        aria-label={`Punto para ${nombre}`}
      >
        {/* Quién sacó el último punto (antes un emoji de volante que tapaba el nombre). */}
        <span className={`absolute left-1/2 top-2 -translate-x-1/2 rounded-full px-2 py-0.5 font-display text-[11px] font-black uppercase tracking-wider transition-opacity ${esA ? 'bg-lime-400 text-navy-900' : 'bg-[#E91E8C] text-white'} ${sirve ? 'opacity-100' : 'opacity-0'}`} aria-hidden>Saca</span>
        {/* Nombres grandes: se leen desde el costado de la cancha (antes text-xs). */}
        <span className={`min-h-[2.6em] break-words px-1 font-display text-base font-bold leading-tight sm:text-xl ${esA ? 'text-lime-400' : 'text-[#ff5fb1]'}`}>
          {nombre}
        </span>
        <span className="font-display text-[clamp(64px,17vw,130px)] font-black leading-none text-white">{puntos}</span>
        <span className="text-[11px] font-bold uppercase tracking-widest text-white/75">
          Sets <span className="font-display text-base text-white">{sets}</span>
        </span>
      </button>
    );
  };

  const claseControl = 'flex h-12 items-center justify-center gap-1.5 rounded-xl border border-navy-600 bg-navy-900 px-1 font-display text-[13px] font-bold text-white disabled:opacity-40';

  return (
    <div className="rounded-2xl bg-navy-800 p-3 sm:p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <button type="button" onClick={onVolver} className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-navy-600 px-3.5 font-display text-[13px] font-bold text-white">
          <ArrowLeft size={16} aria-hidden /> Partidos
        </button>
        <p className="text-right text-[13px] font-semibold text-white/80">
          {p.categoria} · Cancha {p.cancha}{p.juez ? ` · ${p.juez}` : ''}
        </p>
      </div>

      {/* Sin señal: queda fijo arriba del marcador mientras dure (antes, un toast y listo). */}
      {sinConexion && <div className="mb-2.5"><AvisoConexion oscuro onReintentar={onReintentar} /></div>}

      <div className="mb-2.5 flex flex-wrap justify-center gap-1.5">
        {p.sets.map((x, k) => (
          <span key={k} className="rounded-lg border border-navy-600 bg-navy-900 px-2.5 py-1 font-display text-xs font-bold text-white/80">
            Set {k + 1} <span className="text-white">{x.a}-{x.b}</span>
          </span>
        ))}
        {p.estado === 'en_juego' && (
          <span className="rounded-lg border border-lime-400 bg-navy-900 px-2.5 py-1 font-display text-xs font-bold text-lime-400">
            Set {p.sets.length + 1} <span>{s.a}-{s.b}</span>
          </span>
        )}
        {p.estado === 'final' && (
          <span className="rounded-lg bg-lime-400 px-2.5 py-1 font-display text-xs font-black text-navy-800">
            FINAL{p.ganador ? ` · GANA ${p.ganador === 'A' ? p.parejaA : p.parejaB}` : ''}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {zona('izq')}
        {zona('der')}
      </div>

      <div className="mt-2.5 grid grid-cols-4 gap-2">
        <button type="button" onClick={onDeshacer} disabled={!puedeDeshacer} className={claseControl}>
          <Undo2 size={15} aria-hidden /> Deshacer
        </button>
        <button type="button" onClick={onInvertir} className={claseControl}>
          <ArrowLeftRight size={15} aria-hidden /> Lados
        </button>
        <button type="button" onClick={onCorregir} disabled={p.estado !== 'en_juego'} className={claseControl}>
          <Pencil size={15} aria-hidden /> Corregir
        </button>
        <button type="button" onClick={onTerminar} className={claseControl}>
          {p.estado === 'final' ? 'Volver' : 'Terminar'}
        </button>
      </div>

      {/* La tira de la planilla: números 1..tope que se tachan al anotar */}
      <div className="mt-3 rounded-xl border border-navy-700 bg-navy-900/60 p-3">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/70">Planilla del partido</p>
        {p.hist.map((h, k) => {
          const ms = k < p.sets.length ? p.sets[k] : marcadorDe(h);
          return (
            <div key={k} className={k > 0 ? 'mt-3' : ''}>
              <div className="mb-1 flex justify-between text-[11px] font-bold text-white/70">
                <span>{k + 1}{k === 0 ? 'ER' : k === 1 ? 'DO' : 'ER'} SET</span>
                <span className="font-display text-white">{ms.a} - {ms.b}</span>
              </div>
              {(['A', 'B'] as const).map((lado) => (
                <div
                  key={lado}
                  className="mb-0.5 grid gap-[2px]"
                  style={{ gridTemplateColumns: `repeat(${p.cap}, minmax(0, 1fr))` }}
                >
                  {Array.from({ length: p.cap }, (_, n) => {
                    const num = n + 1;
                    const pts = lado === 'A' ? ms.a : ms.b;
                    const lleno = num <= pts;
                    return (
                      <span
                        key={num}
                        className={`rounded-sm border py-[3px] text-center font-display text-[9px] font-semibold leading-none ${
                          lleno
                            ? lado === 'A'
                              ? 'border-lime-400 bg-lime-400 text-navy-900 line-through'
                              : 'border-[#E91E8C] bg-[#E91E8C] text-white line-through'
                            : `border-navy-700 bg-navy-900 text-navy-300 ${num > p.obj ? 'border-dashed' : ''}`
                        }`}
                      >
                        {num}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
