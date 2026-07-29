import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import type { EstadoTorneos } from './TorneosApp';
import type { Torneo } from './engine/tipos';
import { mergeTorneos } from './sync';

const CLAVE_CACHE = 'volea-torneos:cache';

type Cache = {
  estado: EstadoTorneos;
  base: Record<string, string>; // torneoId -> updated_at visto del server
  sucios: string[];
  jugadoresSucios: boolean;
  configSucia: boolean;
};

type EstadoSync = 'sincronizado' | 'pendiente' | 'sinConexion';

function leerCache(): Cache {
  try {
    const crudo = localStorage.getItem(CLAVE_CACHE);
    if (crudo) {
      const c = JSON.parse(crudo) as Partial<Cache>;
      if (c && c.estado && Array.isArray(c.estado.torneos)) {
        return { estado: c.estado, base: c.base ?? {}, sucios: c.sucios ?? [], jugadoresSucios: c.jugadoresSucios ?? false, configSucia: c.configSucia ?? false };
      }
    }
  } catch { /* cache corrupto: arrancar limpio */ }
  return { estado: { torneos: [], jugadores: [] }, base: {}, sucios: [], jugadoresSucios: false, configSucia: false };
}

export function useSyncTorneos(avisarError: (mensaje: string) => void) {
  const [cache, setCache] = useState<Cache>(() => leerCache());
  const [estadoSync, setEstadoSync] = useState<EstadoSync>('pendiente');
  const [conflictos, setConflictos] = useState<string[]>([]);
  const timerPush = useRef<number | null>(null);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  const persistir = useCallback((c: Cache) => {
    try { localStorage.setItem(CLAVE_CACHE, JSON.stringify(c)); } catch (e) { console.error(e); }
  }, []);

  // ---- PUSH: sube sucios (torneos, jugadores, config) ----
  const push = useCallback(async () => {
    const c = cacheRef.current;
    if (!supabase) { setEstadoSync('sinConexion'); return; }
    if (c.sucios.length === 0 && !c.jugadoresSucios && !c.configSucia) { setEstadoSync('sincronizado'); return; }
    try {
      const ahora = new Date().toISOString();
      const nuevaBase = { ...c.base };
      // upsert de torneos sucios existentes (los sucios que ya no existen se borran mas abajo)
      const filas = c.sucios
        .map((id) => c.estado.torneos.find((x) => x.id === id))
        .filter((t): t is Torneo => !!t)
        .map((t) => ({
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
      if (filas.length > 0) {
        const { error } = await supabase.from('rk_torneos').upsert(filas);
        if (error) throw error;
        for (const f of filas) nuevaBase[f.id] = ahora;
      }
      // borrados: ids sucios que ya no estan en el estado
      const idsBorrar = c.sucios.filter((id) => !c.estado.torneos.some((t) => t.id === id));
      if (idsBorrar.length > 0) {
        const { error } = await supabase.from('rk_torneos').delete().in('id', idsBorrar);
        if (error) throw error;
        for (const id of idsBorrar) delete nuevaBase[id];
      }
      if (c.jugadoresSucios) {
        const filasJ = c.estado.jugadores.map((j) => ({ id: j.id, nombre: j.nombre, alias: j.alias ?? [], updated_at: ahora }));
        if (filasJ.length > 0) {
          const { error } = await supabase.from('rk_jugadores').upsert(filasJ);
          if (error) throw error;
        }
      }
      if (c.configSucia && c.estado.configPuntos) {
        const { error } = await supabase.from('rk_config').upsert({ id: 1, data: c.estado.configPuntos, updated_at: ahora });
        if (error) throw error;
      }
      setCache((prev) => {
        const limpio: Cache = { ...prev, base: nuevaBase, sucios: [], jugadoresSucios: false, configSucia: false };
        persistir(limpio);
        return limpio;
      });
      setEstadoSync('sincronizado');
    } catch (err) {
      console.error('[torneos sync] push fallo', err);
      setEstadoSync('sinConexion');
      avisarError('No se pudo sincronizar con la nube. Tus cambios quedan guardados en este navegador y se reintenta solo.');
    }
  }, [avisarError, persistir]);

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
      setCache((prev) => {
        const remotos = (rt.data ?? []).map((f) => ({ torneo: f.data as Torneo, updatedAt: f.updated_at as string }));
        const m = mergeTorneos({ locales: prev.estado.torneos, remotos, sucios: new Set(prev.sucios), base: prev.base });
        const jugadores = prev.jugadoresSucios
          ? prev.estado.jugadores
          : (rj.data ?? []).map((f) => ({ id: f.id as string, nombre: f.nombre as string, alias: (f.alias as string[]) ?? [] }));
        const configPuntos = prev.configSucia ? prev.estado.configPuntos : ((rc.data?.data as EstadoTorneos['configPuntos']) ?? prev.estado.configPuntos);
        const nuevo: Cache = { ...prev, estado: { torneos: m.torneos, jugadores, configPuntos }, base: m.base };
        persistir(nuevo);
        setConflictos(m.conflictos);
        return nuevo;
      });
      setEstadoSync((s) => (s === 'sinConexion' ? 'pendiente' : s));
      void push(); // si habia sucios, empujarlos ahora
    } catch (err) {
      console.error('[torneos sync] pull fallo', err);
      setEstadoSync('sinConexion');
    }
  }, [persistir, push]);

  // ---- setEstado del gestor: escribe cache + marca sucios + agenda push ----
  const setEstado = useCallback((cambio: (e: EstadoTorneos) => EstadoTorneos) => {
    setCache((prev) => {
      const estadoNuevo = cambio(prev.estado);
      const suciosNuevos = new Set(prev.sucios);
      // torneos que cambiaron de referencia o desaparecieron => sucios
      const antesPorId = new Map(prev.estado.torneos.map((t) => [t.id, t]));
      for (const t of estadoNuevo.torneos) {
        if (antesPorId.get(t.id) !== t) suciosNuevos.add(t.id);
      }
      for (const t of prev.estado.torneos) {
        if (!estadoNuevo.torneos.some((x) => x.id === t.id)) suciosNuevos.add(t.id); // borrado
      }
      const nuevo: Cache = {
        ...prev,
        estado: estadoNuevo,
        sucios: [...suciosNuevos],
        jugadoresSucios: prev.jugadoresSucios || estadoNuevo.jugadores !== prev.estado.jugadores,
        configSucia: prev.configSucia || estadoNuevo.configPuntos !== prev.estado.configPuntos,
      };
      persistir(nuevo);
      return nuevo;
    });
    setEstadoSync('pendiente');
    if (timerPush.current !== null) window.clearTimeout(timerPush.current);
    timerPush.current = window.setTimeout(() => { void push(); }, 1500);
  }, [persistir, push]);

  // ---- resolver conflicto: 'local' re-empuja lo mio; 'server' trae lo del server ----
  const resolverConflicto = useCallback(async (id: string, eleccion: 'local' | 'server') => {
    if (eleccion === 'local') {
      setCache((prev) => {
        const nuevo: Cache = { ...prev, base: { ...prev.base, [id]: '' } }; // base vacia: el proximo push pisa
        persistir(nuevo);
        return nuevo;
      });
      setConflictos((cs) => cs.filter((x) => x !== id));
      void push();
      return;
    }
    if (!supabase) return;
    const { data, error } = await supabase.from('rk_torneos').select('data, updated_at').eq('id', id).maybeSingle();
    if (error || !data) { avisarError('No se pudo traer la versión del server.'); return; }
    setCache((prev) => {
      const nuevo: Cache = {
        ...prev,
        estado: { ...prev.estado, torneos: prev.estado.torneos.map((t) => (t.id === id ? (data.data as Torneo) : t)) },
        base: { ...prev.base, [id]: data.updated_at as string },
        sucios: prev.sucios.filter((x) => x !== id),
      };
      persistir(nuevo);
      return nuevo;
    });
    setConflictos((cs) => cs.filter((x) => x !== id));
  }, [avisarError, persistir, push]);

  // ---- arranque + reconexion + reintento periodico ----
  useEffect(() => {
    void pull();
    const onOnline = () => { void pull(); };
    window.addEventListener('online', onOnline);
    const intervalo = window.setInterval(() => {
      const c = cacheRef.current;
      if (c.sucios.length > 0 || c.jugadoresSucios || c.configSucia) void push();
    }, 30000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(intervalo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { estado: cache.estado, setEstado, estadoSync, conflictos, resolverConflicto, refrescar: pull };
}
