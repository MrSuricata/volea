import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import type { EstadoTorneos } from './TorneosApp';
import type { Torneo } from './engine/tipos';
import { mergeTorneos } from './sync';

const CLAVE_CACHE = 'volea-torneos:cache';

type Cache = {
  estado: EstadoTorneos;
  base: Record<string, string>; // torneoId -> updated_at visto del server
  sucios: string[]; // torneos con contenido editado localmente, pendientes de push
  borrados: string[]; // ids de torneos borrados localmente, pendientes de delete en el server
  jugadoresBase: string[]; // ids de jugadores que sabemos que existen en el server (para poder borrar los que ya no estan)
  jugadoresSucios: boolean;
  configSucia: boolean;
};

type EstadoSync = 'sincronizado' | 'pendiente' | 'sinConexion';

function cacheVacia(): Cache {
  return { estado: { torneos: [], jugadores: [] }, base: {}, sucios: [], borrados: [], jugadoresBase: [], jugadoresSucios: false, configSucia: false };
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
  const conflictosRef = useRef<string[]>([]); // espejo sincronico de `conflictos`, para que push() los excluya sin esperar un render
  const timerPush = useRef<number | null>(null);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const enVuelo = useRef(false); // guard de reentrada: solo un push corriendo a la vez
  const pedidoReentrada = useRef(false); // si llego un pedido mientras habia uno en vuelo, se encola UNA repeticion
  const avisosPorClave = useRef<Set<string>>(new Set()); // evita repetir el mismo aviso de dato invalido para siempre
  const ultimoAvisoGeneral = useRef(0); // rate-limit general (ms epoch de time del ultimo aviso "generico")
  const resultadoPullRef = useRef<{ conflictos: string[] } | null>(null);
  const resultadoPushRef = useRef<{ quedaAlgoSucio: boolean } | null>(null);

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

  // ---- PERSISTENCIA: reacciona a cache, nunca corre dentro de un updater de setCache ----
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_CACHE, JSON.stringify(cache));
    } catch (e) {
      console.error('[torneos sync] no se pudo persistir en localStorage', e);
      avisarLimitado('No se pudieron guardar los cambios en este navegador (almacenamiento lleno o bloqueado).');
    }
  }, [cache, avisarLimitado]);

  // ---- PUSH: sube sucios + borrados + jugadores + config, con guard de reentrada ----
  const push = useCallback(async () => {
    if (enVuelo.current) { pedidoReentrada.current = true; return; }
    if (!supabase) { setEstadoSync('sinConexion'); return; }
    enVuelo.current = true;
    try {
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
        // puede haber sucios igual: son los excluidos por conflicto, que siguen pendientes de resolver
        setEstadoSync(c.sucios.length > 0 ? 'pendiente' : 'sincronizado');
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
              console.error('[torneos sync] fila de torneo fallo', f.id, e2);
              avisarLimitado(`No se pudo sincronizar el torneo "${f.nombre}".`, `fila:${f.id}`);
            }
          }
        }
      }

      // ---- borrados: delete de tombstones locales ----
      let borradosOk: string[] = [];
      if (snapshotBorrados.length > 0) {
        const { error } = await supabase.from('rk_torneos').delete().in('id', snapshotBorrados);
        if (!error) borradosOk = snapshotBorrados;
        else { huboErrorGeneral = true; console.error('[torneos sync] borrado de torneos fallo', error); }
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
      setCache((prev) => {
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
        const quedaAlgoSucio = suciosRestantes.length > 0 || borradosRestantes.length > 0 || jugadoresSuciosRestante || configSuciaRestante;
        resultadoPushRef.current = { quedaAlgoSucio };
        return {
          ...prev,
          base: nuevaBase,
          sucios: suciosRestantes,
          borrados: borradosRestantes,
          jugadoresSucios: jugadoresSuciosRestante,
          configSucia: configSuciaRestante,
          jugadoresBase: jugadoresBaseNueva,
        };
      });

      if (huboErrorGeneral) {
        setEstadoSync('sinConexion');
        avisarLimitado('No se pudo sincronizar todo con la nube. Se reintenta solo; tus cambios siguen guardados en este navegador.');
      } else if (resultadoPushRef.current) {
        setEstadoSync(resultadoPushRef.current.quedaAlgoSucio ? 'pendiente' : 'sincronizado');
      }
    } catch (err) {
      console.error('[torneos sync] push fallo', err);
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
      setCache((prev) => {
        const remotos = (rt.data ?? []).map((f) => ({ torneo: f.data as Torneo, updatedAt: f.updated_at as string }));
        const m = mergeTorneos({
          locales: prev.estado.torneos,
          remotos,
          sucios: new Set(prev.sucios),
          borrados: new Set(prev.borrados),
          base: prev.base,
        });
        const jugadoresDelServer = (rj.data ?? []).map((f) => ({ id: f.id as string, nombre: f.nombre as string, alias: (f.alias as string[]) ?? [] }));
        const jugadores = prev.jugadoresSucios ? prev.estado.jugadores : jugadoresDelServer;
        const configPuntos = prev.configSucia ? prev.estado.configPuntos : ((rc.data?.data as EstadoTorneos['configPuntos']) ?? prev.estado.configPuntos);
        // dentro del updater: nada de side effects (podria correr 2 veces en StrictMode).
        // El resultado se guarda en una ref y se usa DESPUES del setCache.
        resultadoPullRef.current = { conflictos: m.conflictos };
        return {
          ...prev,
          estado: { torneos: m.torneos, jugadores, configPuntos },
          base: m.base,
          jugadoresBase: jugadoresDelServer.map((j) => j.id), // siempre la verdad del server
        };
      });
      if (resultadoPullRef.current) {
        conflictosRef.current = resultadoPullRef.current.conflictos;
        setConflictos(resultadoPullRef.current.conflictos);
      }
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
      }
      for (const t of prev.estado.torneos) {
        if (!idsAhora.has(t.id)) {
          // desaparecio: es un borrado, no un "sucio" con contenido (no hay contenido que subir)
          suciosNuevos.delete(t.id);
          borradosNuevos.add(t.id);
          delete baseNueva[t.id];
        }
      }
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
    setEstadoSync('pendiente');
    if (timerPush.current !== null) window.clearTimeout(timerPush.current);
    timerPush.current = window.setTimeout(() => { void push(); }, 1500);
  }, [push]);

  // ---- resolver conflicto: 'local' re-empuja lo mio; 'server' trae lo del server ----
  const resolverConflicto = useCallback(async (id: string, eleccion: 'local' | 'server') => {
    if (eleccion === 'local') {
      conflictosRef.current = conflictosRef.current.filter((x) => x !== id);
      setConflictos(conflictosRef.current);
      setCache((prev) => (prev.sucios.includes(id) ? prev : { ...prev, sucios: [...prev.sucios, id] }));
      void push(); // ya no esta en conflictos: el proximo push lo incluye y pisa al server
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
    }));
    conflictosRef.current = conflictosRef.current.filter((x) => x !== id);
    setConflictos(conflictosRef.current);
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
      if (timerPush.current !== null) window.clearTimeout(timerPush.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { estado: cache.estado, setEstado, estadoSync, conflictos, resolverConflicto, refrescar: pull };
}
