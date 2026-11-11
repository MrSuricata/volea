import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { conLimite } from '../utils/arranque';
import type { EstadoTorneos } from './TorneosApp';
import type { Torneo } from './engine/tipos';
import { aplicarEdicion, aplicarRemotosFrescos, filaDeTorneo, mergeTorneos, mismoInstante, subirTorneo } from './sync';
import type { EntradaRemota, FilaTorneo, OperacionesTorneo } from './sync';
import { fusionarTorneo } from './fusion';
import { CLAVE_CACHE } from './cacheTorneos';
import type { Cache } from './cacheTorneos';

// 'conflicto' = hay cambios locales sin subir y TODOS están frenados esperando que
// alguien resuelva el banner. Sin este estado la UI decía "⏳ Sincronizando…" para
// siempre (push() se saltea los ids en conflicto y vuelve sin marcar error), que fue
// exactamente lo que hizo invisible la pérdida de los resultados del 9/8.
export type EstadoSync = 'sincronizado' | 'pendiente' | 'sinConexion' | 'conflicto';

// Techo para CADA llamada de red del sync: con la sesión vencida y el refresh
// colgado (la conexión trabada de la PC del trabajo), un upsert podía esperar
// para siempre → `enVuelo` quedaba tomado y la UI decía "Sincronizando…" sin fin
// (visto 2026-08-08 subiendo los torneos del 9/8). Con techo, el fallo cae en los
// caminos de error que ya existen ('sinConexion' + reintento periódico de 30s).
// 30s y no 15: los torneos con muchas parejas son documentos grandes y esta
// conexión a veces es lenta de verdad — cortar un envío que iba a llegar es peor.
const TECHO_SYNC_MS = 30000;
function conTechoSync<T extends { data?: unknown; error: unknown }>(
  q: PromiseLike<T> & { abortSignal?: (signal: AbortSignal) => unknown },
): Promise<T | { data: null; error: Error }> {
  // ABORT real al vencer (mismo fix que supabaseService 2026-08-09): sin esto el
  // request colgado quedaba zombie ocupando la conexión y encolaba a los nuevos.
  if (typeof q.abortSignal === 'function') {
    const ctrl = new AbortController();
    q.abortSignal(ctrl.signal);
    setTimeout(() => ctrl.abort(), TECHO_SYNC_MS + 100);
  }
  return conLimite<T | { data: null; error: Error }>(q, TECHO_SYNC_MS, {
    data: null,
    error: new Error('timeout: la red no respondió en 30s'),
  });
}

function cacheVacia(): Cache {
  return { estado: { torneos: [], jugadores: [] }, base: {}, sucios: [], borrados: [], jugadoresBase: [], jugadoresSucios: false, configSucia: false, conflictos: [], baseDatos: {}, conflictosDetalle: {} };
}

// Relectura automatica (ademas de Realtime): cada cuanto se pregunta al server, con la pestaña
// visible, si cambio algun torneo. Es un select de `id, updated_at` (bytes), y solo si algo
// cambio se baja todo. Realtime trae los cambios al instante; esto cubre un canal caido.
const CHEQUEO_MS = 20000;

// Mientras el foco esta en una caja de texto (un resultado a medio tipear) no se relee: el
// borrador vive en el componente y una relectura no lo pisa, pero tampoco hay apuro — se relee
// apenas se suelta la caja (Enter / salir de la fila, que ademas guarda).
function editandoTexto(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

function operacionesSupabase(sb: NonNullable<typeof supabase>): OperacionesTorneo {
  return {
    actualizarSi: (fila: FilaTorneo, base: string) => {
      const { id, ...resto } = fila;
      return conTechoSync(sb.from('rk_torneos').update(resto).eq('id', id).eq('updated_at', base).select('updated_at')) as PromiseLike<{ data: { updated_at: string }[] | null; error: unknown }>;
    },
    insertar: (fila: FilaTorneo) =>
      conTechoSync(sb.from('rk_torneos').insert(fila).select('updated_at')) as PromiseLike<{ data: { updated_at: string }[] | null; error: unknown }>,
    leer: (id: string) =>
      conTechoSync(sb.from('rk_torneos').select('data, updated_at').eq('id', id).maybeSingle()) as PromiseLike<{ data: { data: Torneo; updated_at: string } | null; error: unknown }>,
  };
}

function leerCache(): Cache {
  try {
    const crudo = localStorage.getItem(CLAVE_CACHE);
    if (crudo) {
      const c = JSON.parse(crudo) as Partial<Cache>;
      if (c && c.estado && Array.isArray(c.estado.torneos)) {
        return {
          estado: c.estado,
          base: c.base ?? {},
          sucios: c.sucios ?? [],
          borrados: c.borrados ?? [],
          jugadoresBase: c.jugadoresBase ?? [],
          jugadoresSucios: c.jugadoresSucios ?? false,
          configSucia: c.configSucia ?? false,
          conflictos: c.conflictos ?? [],
          // caches de antes de la fusion por partido no traen esto: sus torneos sucios caen al
          // comportamiento seguro de siempre (conflicto si el server avanzo), nunca a pisar
          baseDatos: c.baseDatos && typeof c.baseDatos === 'object' ? c.baseDatos : {},
          conflictosDetalle: c.conflictosDetalle && typeof c.conflictosDetalle === 'object' ? c.conflictosDetalle : {},
        };
      }
    }
  } catch { /* cache corrupto: arrancar limpio */ }
  return cacheVacia();
}

// Poison-pill: un torneo con datos corruptos (por ejemplo, sin fecha de creacion) no debe
// trabar el push de TODO lo demas. Se excluye y se avisa una vez; el resto sigue su curso.
function esTorneoValido(t: Torneo): boolean {
  return typeof t.creadoEl === 'string' && t.creadoEl !== '' && typeof t.nombre === 'string' && typeof t.fase === 'string';
}

export function useSyncTorneos(avisarError: (mensaje: string) => void) {
  const [cache, setCache] = useState<Cache>(() => leerCache());
  const [estadoSync, setEstadoSync] = useState<EstadoSync>('pendiente');
  const [conflictos, setConflictos] = useState<string[]>([]);
  // Espejo sincronico de `cache.conflictos`, para que push() los excluya sin esperar un
  // render. Escritor autoritativo: el effect de persistencia/derivacion, de abajo, cada
  // vez que `cache` cambia (post-commit). pull() ademas lo adelanta de forma optimista en
  // su propio tick (junto con cacheRef, ANTES de encadenar push(): ver aplicarPull); el
  // effect despues lo pisa con la verdad commiteada, que para entonces coincide.
  const conflictosRef = useRef<Set<string>>(new Set());
  const timerPush = useRef<number | null>(null);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const enVuelo = useRef(false); // guard de reentrada: solo un push corriendo a la vez
  const pedidoReentrada = useRef(false); // si llego un pedido mientras habia uno en vuelo, se encola UNA repeticion
  const avisosPorClave = useRef<Set<string>>(new Set()); // evita repetir el mismo aviso de dato invalido para siempre
  const ultimoAvisoGeneral = useRef(0); // rate-limit general (ms epoch de time del ultimo aviso "generico")
  const ultimoPushFallo = useRef(false); // ultimo intento de push (o su ausencia de supabase): fallo? lo deriva el effect
  // Pull y push NO se solapan: un pull que lee el server mientras el push escribe veria su propia
  // escritura como "el server avanzo" y podria fusionar contra si mismo (choque falso si se edito
  // de nuevo el mismo partido). Lo pedido mientras el otro corre queda encolado (una vez).
  const pullEnVuelo = useRef(false);
  const pullPendiente = useRef(false);
  const pullRef = useRef<() => Promise<void>>(async () => {}); // push() encola un pull sin depender de su identidad
  const chequeoEnVuelo = useRef(false);
  // updated_at del server que este equipo ya vio por torneo (ultimo pull o push propio): el
  // chequeo liviano y Realtime comparan contra esto para no bajar todo por un eco de lo propio.
  const ultimoVisto = useRef<Record<string, string>>({ ...cache.base });
  const fusionesSeguidas = useRef(0); // tope de re-push tras fusionar, para no ciclar si el server no para de moverse

  // Aviso rate-limitado: con `clave` se reporta UNA sola vez por clave (para siempre, hasta
  // reload); sin `clave` es un aviso "generico" limitado a 1 cada 60s para no floodear toasts
  // en cada reintento periodico si la red sigue mala.
  const avisarLimitado = useCallback((mensaje: string, clave?: string) => {
    if (clave) {
      if (avisosPorClave.current.has(clave)) return;
      avisosPorClave.current.add(clave);
      avisarError(mensaje);
      return;
    }
    const ahora = Date.now();
    if (ahora - ultimoAvisoGeneral.current < 60000) return;
    ultimoAvisoGeneral.current = ahora;
    avisarError(mensaje);
  }, [avisarError]);

  // ---- PERSISTENCIA + DERIVACION: unica fuente de verdad post-commit sobre `cache' ----
  // Nunca corre dentro de un updater de setCache (evita el anti-patron de leer un ref de
  // resultado justo despues de llamar setCache, que dependia de la evaluacion eager de
  // updaters - una optimizacion de React, no parte de su contrato). `conflictos` vive en
  // `cache.conflictos` (lo escribe el merge del pull, o resolverConflicto); este effect
  // los propaga al estado React `conflictos` y al espejo `conflictosRef` como ULTIMO
  // escritor (pull() adelanta ese espejo en su propio tick para que el push encadenado no
  // lea conflictos viejos, y push() adelanta cacheRef igual — este effect pisa ambos con
  // lo commiteado), y es el UNICO que deriva `estadoSync` de las banderas sucias del cache.
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_CACHE, JSON.stringify(cache));
    } catch (e) {
      console.error('[torneos sync] no se pudo persistir en localStorage', e);
      avisarLimitado('No se pudieron guardar los cambios en este navegador (almacenamiento lleno o bloqueado).');
    }

    setConflictos(cache.conflictos);
    conflictosRef.current = new Set(cache.conflictos);

    const hayAlgoSucio = cache.sucios.length > 0 || cache.borrados.length > 0 || cache.jugadoresSucios || cache.configSucia;
    // Si lo único que queda pendiente está frenado por un conflicto sin resolver, el
    // push no lo va a subir NUNCA (se saltea esos ids): decirlo en vez de mostrar
    // "Sincronizando…" eternamente, que hace creer que ya está subiendo solo.
    const conflictoSet = new Set(cache.conflictos);
    const quedaAlgoSubible =
      cache.sucios.some((id) => !conflictoSet.has(id)) ||
      cache.borrados.length > 0 || cache.jugadoresSucios || cache.configSucia;
    if (!hayAlgoSucio) {
      setEstadoSync('sincronizado');
    } else if (!quedaAlgoSubible && cache.conflictos.length > 0) {
      setEstadoSync('conflicto');
    } else {
      setEstadoSync(ultimoPushFallo.current ? 'sinConexion' : 'pendiente');
    }
  }, [cache, avisarLimitado]);

  // ---- PUSH: sube sucios + borrados + jugadores + config, con guard de reentrada ----
  const push = useCallback(async () => {
    if (enVuelo.current || pullEnVuelo.current) { pedidoReentrada.current = true; return; }
    if (!supabase) { ultimoPushFallo.current = true; setEstadoSync('sinConexion'); return; }
    enVuelo.current = true;
    let repetirPorFusion = false;
    try {
      ultimoPushFallo.current = false; // optimista: se marca true mas abajo si algo falla en este intento
      const c = cacheRef.current;
      const conflictoSet = new Set(conflictosRef.current);
      // snapshot: lo que vamos a subir es exactamente esto, tomado ANTES de los await.
      // Los ids en conflicto se excluyen del push (todavia no se decidio que gana).
      const snapshotTorneos = new Map<string, Torneo>();
      for (const id of c.sucios) {
        if (conflictoSet.has(id)) continue;
        const t = c.estado.torneos.find((x) => x.id === id);
        if (t) snapshotTorneos.set(id, t);
      }
      const snapshotBorrados = [...c.borrados];
      const snapshotJugadores = c.estado.jugadores;
      const snapshotJugadoresSucios = c.jugadoresSucios;
      const snapshotConfig = c.estado.configPuntos;
      const snapshotConfigSucia = c.configSucia;

      const hayAlgoQueHacer = snapshotTorneos.size > 0 || snapshotBorrados.length > 0 || snapshotJugadoresSucios || snapshotConfigSucia;
      if (!hayAlgoQueHacer) {
        // nada que subir ahora mismo (puede haber sucios igual: son los excluidos por
        // conflicto, pendientes de resolver). `cache` no cambia en esta rama - la
        // derivacion del effect ya reflejaba el estado correcto desde el cambio que
        // disparo este push (una edicion, un pull, etc), no hace falta tocar nada aca.
        return;
      }

      const ahora = new Date().toISOString();
      const baseDelta: Record<string, string> = {};
      const idsSubidos = new Set<string>();
      const frescos: EntradaRemota[] = []; // el server avanzo: versiones a fusionar
      let huboErrorGeneral = false;
      const snapshotBase = c.base;

      // ---- torneos: validar (poison-pill) y subir de a uno, condicionado a la base ----
      // (antes: un upsert en lote que pisaba lo que el server tuviera; ver subirTorneo en sync.ts)
      const op = operacionesSupabase(supabase);
      for (const [id, t] of snapshotTorneos) {
        if (!esTorneoValido(t)) {
          avisarLimitado(`El torneo "${t.nombre || id}" tiene datos incompletos y no se pudo sincronizar. Revisalo o borralo.`, `poison:${id}`);
          continue;
        }
        const r = await subirTorneo(op, filaDeTorneo(t, ahora), snapshotBase[id]);
        if (r.tipo === 'ok') {
          baseDelta[id] = r.updatedAt;
          idsSubidos.add(id);
          ultimoVisto.current[id] = r.updatedAt;
        } else if (r.tipo === 'avanzado') {
          // otro dispositivo (arbitro, otra tablet, En vivo) escribio desde nuestra base: no se
          // pisa; se fusiona abajo y, si no choca, se vuelve a empujar con la base nueva
          frescos.push(r.remoto);
        } else {
          // sin esto, un torneo que nunca logra subir (p.ej. sin conexion) deja
          // ultimoPushFallo en false: el effect de persistencia ve `sucios` no vacio
          // y muestra 'pendiente' (Sincronizando...) para siempre en vez de 'sinConexion'
          // (Sin conexion - trabajando local), el estado real. Mismo tratamiento que
          // ya reciben los fallos de borrados/jugadores/config mas abajo.
          huboErrorGeneral = true;
          console.error('[torneos sync] fila de torneo fallo', id, r.error);
          avisarLimitado(`No se pudo sincronizar el torneo "${t.nombre}".`, `fila:${id}`);
        }
      }

      // ---- borrados: delete de tombstones locales ----
      let borradosOk: string[] = [];
      if (snapshotBorrados.length > 0) {
        // defensa extra: si el id reaparecio localmente (p.ej. reimport) entre el
        // snapshot y este punto, NO lo borramos en el server. cacheRef.current es la
        // lectura mas fresca posible en este momento (setEstado ya lo saca de `borrados`
        // apenas reaparece, pero esto cubre cualquier ventana de carrera residual).
        const idsActuales = new Set(cacheRef.current.estado.torneos.map((x) => x.id));
        const aBorrar = snapshotBorrados.filter((id) => !idsActuales.has(id));
        if (aBorrar.length > 0) {
          const { error } = await conTechoSync(supabase.from('rk_torneos').delete().in('id', aBorrar));
          if (!error) borradosOk = aBorrar;
          else { huboErrorGeneral = true; console.error('[torneos sync] borrado de torneos fallo', error); }
        }
      }

      // ---- jugadores: upsert de los locales + delete de los que ya no estan ----
      let jugadoresOk = false;
      if (snapshotJugadoresSucios) {
        try {
          const filasJ = snapshotJugadores.map((j) => ({ id: j.id, nombre: j.nombre, alias: j.alias ?? [], updated_at: ahora }));
          if (filasJ.length > 0) {
            const { error } = await conTechoSync(supabase.from('rk_jugadores').upsert(filasJ));
            if (error) throw error;
          }
          const idsLocales = new Set(snapshotJugadores.map((j) => j.id));
          const idsBorrarJ = c.jugadoresBase.filter((id) => !idsLocales.has(id));
          if (idsBorrarJ.length > 0) {
            const { error } = await conTechoSync(supabase.from('rk_jugadores').delete().in('id', idsBorrarJ));
            if (error) throw error;
          }
          jugadoresOk = true;
        } catch (e) {
          huboErrorGeneral = true;
          console.error('[torneos sync] jugadores fallo', e);
        }
      }

      // ---- config ----
      let configOk = false;
      if (snapshotConfigSucia && snapshotConfig) {
        const { error } = await conTechoSync(supabase.from('rk_config').upsert({ id: 1, data: snapshotConfig, updated_at: ahora }));
        if (!error) configOk = true;
        else { huboErrorGeneral = true; console.error('[torneos sync] config fallo', error); }
      }

      // ---- cleanup: solo lo que efectivamente se confirmo, y con base como DELTA ----
      // Funcion pura: la comparte el setCache de abajo (estado React, para cuando el
      // componente sigue montado) CON la persistencia directa a localStorage que sigue
      // (para cuando ya no lo esta). Sin esa segunda parte, un push que termina despues de
      // que el tab de Torneos se desmonto (p.ej. el admin cambia de pestaña mientras el
      // upsert todavia esta en vuelo) pierde su bookkeeping: setCache pasa a ser un no-op
      // post-desmontaje y el effect de persistencia (que solo corre en reaccion a un cambio
      // de `cache`) nunca llega a ejecutarse. localStorage se queda con `sucios`/`base`
      // viejos aunque el server ya tenga los datos nuevos, y el proximo mount hace un pull,
      // ve dirty + base desalineada contra el remoto, y levanta un conflicto FALSO contra el
      // propio push que recien confirmamos (con el riesgo de que "La del server" descarte
      // trabajo mas nuevo del mismo admin).
      const reconciliarPostPush = (prev: Cache): Cache => {
        const suciosRestantes = prev.sucios.filter((id) => {
          if (conflictoSet.has(id)) return true; // excluido del push: sigue sucio
          if (!idsSubidos.has(id)) return true; // invalido o fallo la subida: sigue sucio
          const actual = prev.estado.torneos.find((x) => x.id === id);
          return actual !== snapshotTorneos.get(id); // se edito de nuevo mientras viajaba: sigue sucio
        });
        const borradosRestantes = prev.borrados.filter((id) => !borradosOk.includes(id));
        const baseSinBorrados = { ...prev.base };
        for (const id of borradosOk) delete baseSinBorrados[id];
        const nuevaBase = { ...baseSinBorrados, ...baseDelta };
        // copia base: lo subido y confirmado ES el server ahora. Si se volvio a editar mientras
        // viajaba (sigue sucio) la copia pasa a ser lo que se subio; si quedo limpio, no hace falta.
        const nuevaBaseDatos = { ...prev.baseDatos };
        for (const id of borradosOk) delete nuevaBaseDatos[id];
        for (const id of idsSubidos) {
          if (suciosRestantes.includes(id)) nuevaBaseDatos[id] = snapshotTorneos.get(id)!;
          else delete nuevaBaseDatos[id];
        }
        const jugadoresSuciosRestante = jugadoresOk && prev.estado.jugadores === snapshotJugadores ? false : prev.jugadoresSucios;
        const configSuciaRestante = configOk && prev.estado.configPuntos === snapshotConfig ? false : prev.configSucia;
        const jugadoresBaseNueva = jugadoresOk ? snapshotJugadores.map((j) => j.id) : prev.jugadoresBase;
        const tras = {
          ...prev,
          base: nuevaBase,
          baseDatos: nuevaBaseDatos,
          sucios: suciosRestantes,
          borrados: borradosRestantes,
          jugadoresSucios: jugadoresSuciosRestante,
          configSucia: configSuciaRestante,
          jugadoresBase: jugadoresBaseNueva,
        };
        return aplicarRemotosFrescos(tras, frescos).cache;
      };

      // Persistencia directa: corre SIEMPRE (montado o no), calculada sobre cacheRef.current
      // (el reflejo sincronico mas fresco disponible aca - lo mismo que ya usa el resto de
      // este archivo). Tambien actualizamos el ref in-place para que un push reentrante
      // (pedidoReentrada, mas abajo) que llegue a correr despues de un desmontaje no lea
      // bookkeeping viejo. Si el componente sigue montado, el setCache de mas abajo hace
      // ademas el camino normal (estado React + su effect, que vuelve a escribir el mismo
      // resultado en localStorage - redundante pero inofensivo).
      // Limite conocido y acotado: cacheRef.current es el ULTIMO estado COMMITEADO (se
      // reasigna al tope del render), no necesariamente el resultado de un setEstado que ya
      // se encolo pero todavia no rendereo. Ese caso lo corrige el effect de persistencia
      // milisegundos despues, apenas React haga ese render pendiente; solo un cierre del
      // navegador exactamente en esa ventana microscopica podria perder esa UNA edicion.
      const cachePersistido = reconciliarPostPush(cacheRef.current);
      cacheRef.current = cachePersistido;
      // conflictos que encontro este push: el espejo se adelanta ya (como en pull) para que el
      // re-push encadenado de abajo no suba un torneo en conflicto
      conflictosRef.current = new Set(cachePersistido.conflictos);
      for (const f of frescos) ultimoVisto.current[f.torneo.id] = f.updatedAt;
      const refusionados = frescos
        .map((f) => f.torneo.id)
        .filter((id) => cachePersistido.sucios.includes(id) && !cachePersistido.conflictos.includes(id));
      if (refusionados.length > 0 && fusionesSeguidas.current < 3) {
        // fusionado contra la version nueva del server: subirlo ya (con la base nueva). El tope
        // evita un ciclo si el server se mueve sin parar; el reintento de 30s sigue igual.
        fusionesSeguidas.current += 1;
        repetirPorFusion = true;
      } else if (frescos.length === 0) {
        fusionesSeguidas.current = 0;
      }
      try {
        localStorage.setItem(CLAVE_CACHE, JSON.stringify(cachePersistido));
      } catch (e) {
        console.error('[torneos sync] no se pudo persistir bookkeeping post-push en localStorage', e);
        avisarLimitado('No se pudieron guardar los cambios en este navegador (almacenamiento lleno o bloqueado).');
      }
      setCache(reconciliarPostPush);

      if (huboErrorGeneral) {
        ultimoPushFallo.current = true;
        avisarLimitado('No se pudo sincronizar todo con la nube. Se reintenta solo; tus cambios siguen guardados en este navegador.');
      }
      // exito limpio (sin huboErrorGeneral): nada mas que hacer aca, la derivacion la hace el
      // effect de persistencia en reaccion al `cache` que acabamos de setear (si el
      // componente sigue montado) o ya quedo escrita arriba a mano (si no).
    } catch (err) {
      console.error('[torneos sync] push fallo', err);
      ultimoPushFallo.current = true;
      // caso excepcional no cubierto por el manejo por seccion de arriba (todas esas
      // ramas capturan su propio error sin relanzar): `cache` no cambio en este catch,
      // asi que el effect no se dispara solo; fallback directo para no dejar la UI
      // mostrando un estado viejo mientras algo realmente se rompio.
      setEstadoSync('sinConexion');
      avisarLimitado('No se pudo sincronizar con la nube. Tus cambios quedan guardados en este navegador y se reintenta solo.');
    } finally {
      enVuelo.current = false;
      if (pullPendiente.current) {
        // un pull pedido mientras subiamos: va primero (al terminar empuja lo que quede)
        pullPendiente.current = false;
        pedidoReentrada.current = false;
        void pullRef.current();
      } else if (pedidoReentrada.current || repetirPorFusion) {
        pedidoReentrada.current = false;
        void push();
      }
    }
  }, [avisarLimitado]);

  // ---- PULL: baja todo y mergea ----
  const pull = useCallback(async () => {
    if (!supabase) { setEstadoSync('sinConexion'); return; }
    if (pullEnVuelo.current || enVuelo.current) { pullPendiente.current = true; return; }
    pullEnVuelo.current = true;
    let ok = false;
    try {
      const [rt, rj, rc] = await Promise.all([
        conTechoSync(supabase.from('rk_torneos').select('id, data, updated_at')),
        conTechoSync(supabase.from('rk_jugadores').select('id, nombre, alias')),
        conTechoSync(supabase.from('rk_config').select('data').eq('id', 1).maybeSingle()),
      ]);
      if (rt.error) throw rt.error;
      if (rj.error) throw rj.error;
      if (rc.error) throw rc.error;
      const remotos = (rt.data ?? []).map((f) => ({ torneo: f.data as Torneo, updatedAt: f.updated_at as string }));
      const jugadoresDelServer = (rj.data ?? []).map((f) => ({ id: f.id as string, nombre: f.nombre as string, alias: (f.alias as string[]) ?? [] }));
      // Funcion pura (mismo patron que reconciliarPostPush en push(), mas abajo): se llama DOS
      // veces - una directa sobre cacheRef.current (para escribir cacheRef/conflictosRef de
      // forma sincronica, YA) y otra como updater de setCache (para el estado React, si el
      // componente sigue montado).
      const aplicarPull = (prev: Cache): Cache => {
        const m = mergeTorneos({
          locales: prev.estado.torneos,
          remotos,
          sucios: new Set(prev.sucios),
          borrados: new Set(prev.borrados),
          base: prev.base,
          baseDatos: prev.baseDatos,
        });
        const limpios = new Set(m.limpios);
        const jugadores = prev.jugadoresSucios ? prev.estado.jugadores : jugadoresDelServer;
        const configPuntos = prev.configSucia ? prev.estado.configPuntos : ((rc.data?.data as EstadoTorneos['configPuntos']) ?? prev.estado.configPuntos);
        return {
          ...prev,
          estado: { torneos: m.torneos, jugadores, configPuntos },
          base: m.base,
          baseDatos: m.baseDatos,
          // fusionados que quedaron iguales al server: ya no hay nada que subir
          sucios: limpios.size > 0 ? prev.sucios.filter((id) => !limpios.has(id)) : prev.sucios,
          jugadoresBase: jugadoresDelServer.map((j) => j.id), // siempre la verdad del server
          conflictos: m.conflictos,
          conflictosDetalle: m.detalles,
        };
      };
      // Mirror sincronico ANTES de push() (linea de abajo, mismo tick): push() se dispara sin
      // esperar el render+effect de React que normalmente actualiza cacheRef/conflictosRef (ver
      // comentario de conflictosRef, arriba). Sin esto, un pull que recien detecta un conflicto
      // nuevo dispara un push que todavia lee conflictosRef desactualizado (sin el id nuevo) y
      // sube igual el torneo en conflicto, pisando al server - exactamente lo que el conflicto
      // debia impedir.
      // Mismo limite que el persist directo de push() (arriba): cacheRef.current es el ultimo
      // estado COMMITEADO — un setEstado encolado pero sin renderear no se ve aca, asi que el
      // push encadenado puede saltearse esa edicion. Se auto-cura: el debounce de ese mismo
      // setEstado sigue pendiente, y React re-aplica el updater sobre aplicarPull al commitear.
      const cacheNuevo = aplicarPull(cacheRef.current);
      cacheRef.current = cacheNuevo;
      conflictosRef.current = new Set(cacheNuevo.conflictos);
      const visto: Record<string, string> = {};
      for (const r of remotos) visto[r.torneo.id] = r.updatedAt;
      ultimoVisto.current = visto;
      setCache(aplicarPull);
      setEstadoSync((s) => (s === 'sinConexion' ? 'pendiente' : s));
      ok = true;
    } catch (err) {
      console.error('[torneos sync] pull fallo', err);
      setEstadoSync('sinConexion');
    } finally {
      pullEnVuelo.current = false;
    }
    if (pullPendiente.current) {
      pullPendiente.current = false;
      void pullRef.current();
    } else if (ok || pedidoReentrada.current) {
      pedidoReentrada.current = false;
      void push(); // si habia sucios, empujarlos ahora
    }
  }, [push]);
  pullRef.current = pull;

  // ---- setEstado del gestor: escribe cache + marca sucios/borrados + agenda push ----
  const setEstado = useCallback((cambio: (e: EstadoTorneos) => EstadoTorneos) => {
    // estadoSync no se toca aca: el effect de persistencia lo deriva de `cache` apenas
    // este setCache haga efecto (siempre queda algo sucio recien editado => 'pendiente').
    setCache((prev) => aplicarEdicion(prev, cambio(prev.estado)));
    if (timerPush.current !== null) window.clearTimeout(timerPush.current);
    timerPush.current = window.setTimeout(() => {
      // Limpiar la ref ANTES de empujar: asi timerPush.current !== null significa "hay un
      // debounce pendiente de disparar" (lo que el cleanup de desmontaje necesita para decidir
      // si hace falta flushear), no "se edito en algun momento de este mount".
      timerPush.current = null;
      void push();
    }, 1500);
  }, [push]);

  // ---- resolver conflicto ----
  // 'local' ("Mi versión"): se trae la version del server y se FUSIONA prefiriendo lo de aca en
  //   lo que choca (lo que el otro equipo cargo en otros partidos se conserva). Si el choque es
  //   de estructura (cuadro rearmado, parejas, …) gana el torneo de aca entero. La base pasa a ser
  //   la del server, asi el push condicionado sube encima de ESA version (y si el server se movio
  //   de nuevo en el medio, se vuelve a fusionar o a avisar: nunca se pisa a ciegas).
  // 'server' ("La del server"): se descartan los cambios de aca sin subir de ese torneo.
  // `conflictos` vive en el cache: se edita via setCache (y el mismo calculo sobre cacheRef, para
  // que el push encadenado ya lo vea fuera de conflicto - patron de pull/push).
  const resolverConflicto = useCallback(async (id: string, eleccion: 'local' | 'server') => {
    if (!supabase) return;
    const { data, error } = await conTechoSync(supabase.from('rk_torneos').select('data, updated_at').eq('id', id).maybeSingle());
    if (error) { avisarLimitado('No se pudo traer la versión del server. Probá de nuevo.'); return; }
    const fila = data as { data: Torneo; updated_at: string } | null;
    let cambio: (prev: Cache) => Cache;
    if (eleccion === 'local') {
      cambio = (prev) => {
        const local = prev.estado.torneos.find((t) => t.id === id);
        let elegido = local;
        const copia = prev.baseDatos[id];
        if (local && fila && copia) {
          const f = fusionarTorneo(copia, local, fila.data, { preferir: 'local' });
          if (f.ok) elegido = f.torneo;
        }
        const base = { ...prev.base };
        const baseDatos = { ...prev.baseDatos };
        if (fila) { base[id] = fila.updated_at; baseDatos[id] = fila.data; } else { delete base[id]; delete baseDatos[id]; }
        const detalle = { ...prev.conflictosDetalle };
        delete detalle[id];
        return {
          ...prev,
          estado: { ...prev.estado, torneos: prev.estado.torneos.map((t) => (t.id === id && elegido ? elegido : t)) },
          base,
          baseDatos,
          conflictos: prev.conflictos.filter((x) => x !== id),
          conflictosDetalle: detalle,
          sucios: prev.sucios.includes(id) ? prev.sucios : [...prev.sucios, id],
        };
      };
    } else {
      if (!fila) { avisarLimitado('Ese torneo ya no está en el server.'); return; }
      cambio = (prev) => {
        const baseDatos = { ...prev.baseDatos };
        delete baseDatos[id];
        const detalle = { ...prev.conflictosDetalle };
        delete detalle[id];
        return {
          ...prev,
          estado: { ...prev.estado, torneos: prev.estado.torneos.map((t) => (t.id === id ? fila.data : t)) },
          base: { ...prev.base, [id]: fila.updated_at },
          baseDatos,
          sucios: prev.sucios.filter((x) => x !== id),
          conflictos: prev.conflictos.filter((x) => x !== id),
          conflictosDetalle: detalle,
        };
      };
    }
    const nuevo = cambio(cacheRef.current);
    cacheRef.current = nuevo;
    conflictosRef.current = new Set(nuevo.conflictos);
    if (fila) ultimoVisto.current[id] = fila.updated_at;
    setCache(cambio);
    if (eleccion === 'local') void push();
  }, [avisarLimitado, push]);

  // ---- enterarse solo de lo que cargan otros (arbitros, otra tablet, En vivo) ----
  // Antes el gestor solo releia al abrir y al volver la conexion: no veia nada de los demas
  // hasta tocar la pildora. Ahora: Realtime sobre rk_torneos (mismo patron que En vivo), un
  // chequeo liviano periodico con la pestaña visible, y otro al volver la pestaña al frente.
  // Nunca dos pulls a la vez (pull() se encola), ni mientras se esta tipeando un resultado.
  const esperandoFoco = useRef(false);
  const pullAutomatico = useCallback(() => {
    if (editandoTexto()) {
      if (esperandoFoco.current) return;
      esperandoFoco.current = true;
      const alSoltar = () => {
        document.removeEventListener('focusout', alSoltar);
        // el blur de la caja guarda el resultado (setEstado): se relee un toque despues
        window.setTimeout(() => { esperandoFoco.current = false; pullAutomatico(); }, 300);
      };
      document.addEventListener('focusout', alSoltar);
      return;
    }
    void pullRef.current();
  }, []);

  // ¿Cambio algo en el server desde lo que ya vimos? Solo `id, updated_at` (liviano).
  const chequearCambios = useCallback(async () => {
    if (!supabase || chequeoEnVuelo.current || pullEnVuelo.current || enVuelo.current) return;
    chequeoEnVuelo.current = true;
    try {
      const { data, error } = await conTechoSync(supabase.from('rk_torneos').select('id, updated_at'));
      if (error || !data) return;
      const filas = data as { id: string; updated_at: string }[];
      const visto = ultimoVisto.current;
      const borrados = new Set(cacheRef.current.borrados);
      const enServer = new Set(filas.map((f) => f.id));
      const cambio = filas.some((f) => !borrados.has(f.id) && !mismoInstante(visto[f.id], f.updated_at))
        || Object.keys(visto).some((id) => !enServer.has(id) && !borrados.has(id));
      if (cambio) pullAutomatico();
    } finally {
      chequeoEnVuelo.current = false;
    }
  }, [pullAutomatico]);

  // ---- arranque + reconexion + reintento periodico + limpieza al desmontar ----
  useEffect(() => {
    void pull();
    const onOnline = () => { void pull(); };
    window.addEventListener('online', onOnline);
    const intervalo = window.setInterval(() => {
      const c = cacheRef.current;
      if (c.sucios.length > 0 || c.borrados.length > 0 || c.jugadoresSucios || c.configSucia) void push();
    }, 30000);
    const chequeo = window.setInterval(() => {
      if (document.visibilityState === 'visible') void chequearCambios();
    }, CHEQUEO_MS);
    const alVolver = () => { if (document.visibilityState === 'visible') void chequearCambios(); };
    document.addEventListener('visibilitychange', alVolver);

    // Realtime: el aviso trae la fila nueva. Se junta lo que llega (400 ms) y al disparar se
    // descarta lo que ya vimos: el eco de nuestro propio push suele llegar ANTES que la respuesta
    // HTTP del push, asi que se espera a que no haya push/pull en vuelo para comparar contra
    // `ultimoVisto` ya actualizado. Si el canal no anda, queda el chequeo periodico.
    const sb = supabase;
    let timerRt: number | undefined;
    const avisados = new Map<string, string | undefined>(); // id -> updated_at avisado (undefined: borrado o sin dato)
    const procesarAvisos = () => {
      if (enVuelo.current || pullEnVuelo.current) { timerRt = window.setTimeout(procesarAvisos, 400); return; }
      const nuevos = [...avisados].some(([id, ts]) => ts === undefined || !mismoInstante(ultimoVisto.current[id], ts));
      avisados.clear();
      if (nuevos) pullAutomatico();
    };
    const canal = sb
      ? sb.channel('gestor-torneos')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rk_torneos' }, (payload: { new?: unknown; old?: unknown }) => {
          const n = (payload.new ?? {}) as { id?: string; updated_at?: string };
          const o = (payload.old ?? {}) as { id?: string };
          const id = n.id ?? o.id ?? '?';
          avisados.set(id, n.id ? n.updated_at : undefined);
          window.clearTimeout(timerRt);
          timerRt = window.setTimeout(procesarAvisos, 400);
        })
        .subscribe()
      : null;

    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(intervalo);
      window.clearInterval(chequeo);
      document.removeEventListener('visibilitychange', alVolver);
      window.clearTimeout(timerRt);
      if (sb && canal) void sb.removeChannel(canal);
      if (timerPush.current !== null) {
        // Flush en vez de solo cancelar: si no, una edicion recien debounceada se queda
        // esperando un remount que puede no llegar nunca (el admin no tiene por que volver
        // a la pestaña Torneos). push() sigue corriendo aunque este componente ya se haya
        // desmontado - es un closure sobre refs, no depende del ciclo de vida de React - y
        // su propia persistencia directa a localStorage (mas arriba) evita que el
        // bookkeeping se pierda cuando termine.
        window.clearTimeout(timerPush.current);
        timerPush.current = null;
        void push();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    estado: cache.estado,
    setEstado,
    estadoSync,
    conflictos,
    detallesConflicto: cache.conflictosDetalle,
    resolverConflicto,
    refrescar: pull,
  };
}
