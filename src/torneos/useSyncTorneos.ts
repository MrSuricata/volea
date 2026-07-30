import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import type { EstadoTorneos } from './TorneosApp';
import type { Torneo } from './engine/tipos';
import { mergeTorneos } from './sync';
import { CLAVE_CACHE } from './cacheTorneos';
import type { Cache } from './cacheTorneos';

export type EstadoSync = 'sincronizado' | 'pendiente' | 'sinConexion';

function cacheVacia(): Cache {
  return { estado: { torneos: [], jugadores: [] }, base: {}, sucios: [], borrados: [], jugadoresBase: [], jugadoresSucios: false, configSucia: false, conflictos: [] };
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
    if (!hayAlgoSucio) {
      setEstadoSync('sincronizado');
    } else {
      setEstadoSync(ultimoPushFallo.current ? 'sinConexion' : 'pendiente');
    }
  }, [cache, avisarLimitado]);

  // ---- PUSH: sube sucios + borrados + jugadores + config, con guard de reentrada ----
  const push = useCallback(async () => {
    if (enVuelo.current) { pedidoReentrada.current = true; return; }
    if (!supabase) { ultimoPushFallo.current = true; setEstadoSync('sinConexion'); return; }
    enVuelo.current = true;
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
      let huboErrorGeneral = false;

      // ---- torneos: validar (poison-pill) y subir; batch primero, fila por fila si falla ----
      const validos: Torneo[] = [];
      for (const [id, t] of snapshotTorneos) {
        if (esTorneoValido(t)) {
          validos.push(t);
        } else {
          avisarLimitado(`El torneo "${t.nombre || id}" tiene datos incompletos y no se pudo sincronizar. Revisalo o borralo.`, `poison:${id}`);
        }
      }
      if (validos.length > 0) {
        const filas = validos.map((t) => ({
          id: t.id,
          nombre: t.nombre,
          fase: t.fase,
          categoria: t.categoria ?? null,
          visible: t.visible !== false,
          cuenta_ranking: t.cuentaParaRanking !== false,
          data: t,
          creado_el: t.creadoEl,
          updated_at: ahora,
        }));
        const { error } = await supabase.from('rk_torneos').upsert(filas);
        if (!error) {
          for (const f of filas) { baseDelta[f.id] = ahora; idsSubidos.add(f.id); }
        } else {
          // reintento fila por fila; se excluye (y avisa) la que vuelva a fallar
          for (const f of filas) {
            const { error: e2 } = await supabase.from('rk_torneos').upsert([f]);
            if (!e2) {
              baseDelta[f.id] = ahora;
              idsSubidos.add(f.id);
            } else {
              // sin esto, un torneo que nunca logra subir (p.ej. sin conexion) deja
              // ultimoPushFallo en false: el effect de persistencia ve `sucios` no vacio
              // y muestra 'pendiente' (Sincronizando...) para siempre en vez de 'sinConexion'
              // (Sin conexion - trabajando local), el estado real. Mismo tratamiento que
              // ya reciben los fallos de borrados/jugadores/config mas abajo.
              huboErrorGeneral = true;
              console.error('[torneos sync] fila de torneo fallo', f.id, e2);
              avisarLimitado(`No se pudo sincronizar el torneo "${f.nombre}".`, `fila:${f.id}`);
            }
          }
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
          const { error } = await supabase.from('rk_torneos').delete().in('id', aBorrar);
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
            const { error } = await supabase.from('rk_jugadores').upsert(filasJ);
            if (error) throw error;
          }
          const idsLocales = new Set(snapshotJugadores.map((j) => j.id));
          const idsBorrarJ = c.jugadoresBase.filter((id) => !idsLocales.has(id));
          if (idsBorrarJ.length > 0) {
            const { error } = await supabase.from('rk_jugadores').delete().in('id', idsBorrarJ);
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
        const { error } = await supabase.from('rk_config').upsert({ id: 1, data: snapshotConfig, updated_at: ahora });
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
        const jugadoresSuciosRestante = jugadoresOk && prev.estado.jugadores === snapshotJugadores ? false : prev.jugadoresSucios;
        const configSuciaRestante = configOk && prev.estado.configPuntos === snapshotConfig ? false : prev.configSucia;
        const jugadoresBaseNueva = jugadoresOk ? snapshotJugadores.map((j) => j.id) : prev.jugadoresBase;
        return {
          ...prev,
          base: nuevaBase,
          sucios: suciosRestantes,
          borrados: borradosRestantes,
          jugadoresSucios: jugadoresSuciosRestante,
          configSucia: configSuciaRestante,
          jugadoresBase: jugadoresBaseNueva,
        };
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
      if (pedidoReentrada.current) {
        pedidoReentrada.current = false;
        void push();
      }
    }
  }, [avisarLimitado]);

  // ---- PULL: baja todo y mergea ----
  const pull = useCallback(async () => {
    if (!supabase) { setEstadoSync('sinConexion'); return; }
    try {
      const [rt, rj, rc] = await Promise.all([
        supabase.from('rk_torneos').select('id, data, updated_at'),
        supabase.from('rk_jugadores').select('id, nombre, alias'),
        supabase.from('rk_config').select('data').eq('id', 1).maybeSingle(),
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
        });
        const jugadores = prev.jugadoresSucios ? prev.estado.jugadores : jugadoresDelServer;
        const configPuntos = prev.configSucia ? prev.estado.configPuntos : ((rc.data?.data as EstadoTorneos['configPuntos']) ?? prev.estado.configPuntos);
        return {
          ...prev,
          estado: { torneos: m.torneos, jugadores, configPuntos },
          base: m.base,
          jugadoresBase: jugadoresDelServer.map((j) => j.id), // siempre la verdad del server
          conflictos: m.conflictos,
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
      setCache(aplicarPull);
      setEstadoSync((s) => (s === 'sinConexion' ? 'pendiente' : s));
      void push(); // si habia sucios, empujarlos ahora
    } catch (err) {
      console.error('[torneos sync] pull fallo', err);
      setEstadoSync('sinConexion');
    }
  }, [push]);

  // ---- setEstado del gestor: escribe cache + marca sucios/borrados + agenda push ----
  const setEstado = useCallback((cambio: (e: EstadoTorneos) => EstadoTorneos) => {
    setCache((prev) => {
      const estadoNuevo = cambio(prev.estado);
      const suciosNuevos = new Set(prev.sucios);
      const borradosNuevos = new Set(prev.borrados);
      const baseNueva = { ...prev.base };
      const antesPorId = new Map(prev.estado.torneos.map((t) => [t.id, t]));
      const idsAhora = new Set(estadoNuevo.torneos.map((t) => t.id));
      for (const t of estadoNuevo.torneos) {
        if (antesPorId.get(t.id) !== t) suciosNuevos.add(t.id); // referencia cambio: contenido editado
        borradosNuevos.delete(t.id); // reaparecio (p.ej. reimport de un id previamente borrado): ya no es tombstone
      }
      for (const t of prev.estado.torneos) {
        if (!idsAhora.has(t.id)) {
          // desaparecio: es un borrado, no un "sucio" con contenido (no hay contenido que subir)
          suciosNuevos.delete(t.id);
          borradosNuevos.add(t.id);
          delete baseNueva[t.id];
        }
      }
      // estadoSync no se toca aca: el effect de persistencia lo deriva de `cache` apenas
      // este setCache haga efecto (siempre queda algo sucio recien editado => 'pendiente').
      return {
        ...prev,
        estado: estadoNuevo,
        sucios: [...suciosNuevos],
        borrados: [...borradosNuevos],
        base: baseNueva,
        jugadoresSucios: prev.jugadoresSucios || estadoNuevo.jugadores !== prev.estado.jugadores,
        configSucia: prev.configSucia || estadoNuevo.configPuntos !== prev.estado.configPuntos,
      };
    });
    if (timerPush.current !== null) window.clearTimeout(timerPush.current);
    timerPush.current = window.setTimeout(() => {
      // Limpiar la ref ANTES de empujar: asi timerPush.current !== null significa "hay un
      // debounce pendiente de disparar" (lo que el cleanup de desmontaje necesita para decidir
      // si hace falta flushear), no "se edito en algun momento de este mount".
      timerPush.current = null;
      void push();
    }, 1500);
  }, [push]);

  // ---- resolver conflicto: 'local' re-empuja lo mio; 'server' trae lo del server ----
  // `conflictos` vive en el cache: se edita via setCache, nunca con un setConflictos/ref
  // directo aca (ese es el trabajo exclusivo del effect de persistencia, que corre
  // garantizado despues de que este setCache haga efecto).
  const resolverConflicto = useCallback(async (id: string, eleccion: 'local' | 'server') => {
    if (eleccion === 'local') {
      setCache((prev) => ({
        ...prev,
        conflictos: prev.conflictos.filter((x) => x !== id),
        sucios: prev.sucios.includes(id) ? prev.sucios : [...prev.sucios, id],
      }));
      void push(); // una vez que el effect propague esto a conflictosRef, el push lo incluye y pisa al server
      return;
    }
    if (!supabase) return;
    const { data, error } = await supabase.from('rk_torneos').select('data, updated_at').eq('id', id).maybeSingle();
    if (error || !data) { avisarLimitado('No se pudo traer la versión del server.'); return; }
    setCache((prev) => ({
      ...prev,
      estado: { ...prev.estado, torneos: prev.estado.torneos.map((t) => (t.id === id ? (data.data as Torneo) : t)) },
      base: { ...prev.base, [id]: data.updated_at as string },
      sucios: prev.sucios.filter((x) => x !== id),
      conflictos: prev.conflictos.filter((x) => x !== id),
    }));
  }, [avisarLimitado, push]);

  // ---- arranque + reconexion + reintento periodico + limpieza al desmontar ----
  useEffect(() => {
    void pull();
    const onOnline = () => { void pull(); };
    window.addEventListener('online', onOnline);
    const intervalo = window.setInterval(() => {
      const c = cacheRef.current;
      if (c.sucios.length > 0 || c.borrados.length > 0 || c.jugadoresSucios || c.configSucia) void push();
    }, 30000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(intervalo);
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

  return { estado: cache.estado, setEstado, estadoSync, conflictos, resolverConflicto, refrescar: pull };
}
