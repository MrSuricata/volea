import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Torneo } from '../engine/tipos';
import { normalizar } from '../../utils/nombres';
import { nombreDe } from '../ui/util';
import { podioDeTorneo } from './resultado';
import { agruparPorEvento, listarTorneosPublicos, torneoEnVivo } from './datos';
import type { TorneoPublico } from './datos';
import { RkCargando, RkError } from './Estados';
import '../torneos.css';

const ETIQUETA_FASE: Record<Torneo['fase'], string> = {
  parejas: 'Inscripción', grupos: 'Armando grupos', faseGrupos: 'Fase de grupos', llave: 'Llave en juego', terminado: 'Terminado',
};
const ETIQUETA_FORMATO: Record<string, string> = { grupos: 'Grupos + Llave', individual: 'One Point Challenge' };

type Estado = 'cargando' | 'ok' | 'error';

/**
 * Lista pública de torneos agrupada por EVENTO (pedido de Brian): una carta por
 * torneo real (Racket Roll, +50, etc.); entrás y ves sus categorías. Los que no
 * pertenecen a un evento siguen como carta directa. El buscador salta el
 * agrupado: busca en todas las categorías y jugadores a la vez.
 */
export default function TorneosListaPage() {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [mensajeError, setMensajeError] = useState('');
  const [torneos, setTorneos] = useState<TorneoPublico[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [eventoSel, setEventoSel] = useState<string | null>(null);
  const ahoraMs = Date.now();

  const eventos = useMemo(() => agruparPorEvento(torneos, ahoraMs), [torneos, ahoraMs]);

  // Buscador global: matchea categoría (nombre del torneo), evento o jugador,
  // sin tildes. Al escribir se ignora el nivel de eventos (lista plana).
  const filtrados = useMemo(() => {
    const q = normalizar(busqueda);
    if (!q) return torneos;
    return torneos.filter((t) =>
      normalizar(t.nombre).includes(q) ||
      (t.evento !== null && normalizar(t.evento).includes(q)) ||
      t.parejas.some((p) => normalizar(p.nombre).includes(q)),
    );
  }, [torneos, busqueda]);

  const cargar = useCallback(async () => {
    setEstado('cargando');
    const r = await listarTorneosPublicos();
    if (r.error) {
      setMensajeError(r.error);
      setEstado('error');
      return;
    }
    setTorneos([...r.torneos].sort((a, b) => b.creadoEl.localeCompare(a.creadoEl)));
    setEstado('ok');
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (estado === 'cargando') return <RkCargando texto="Cargando torneos…" />;
  if (estado === 'error') return <RkError mensaje={mensajeError} onReintentar={() => void cargar()} />;

  const q = normalizar(busqueda);
  const grupoSel = eventoSel !== null ? eventos.find((e) => e.nombre === eventoSel) ?? null : null;

  const cartaCategoria = (t: TorneoPublico) => {
    const podio = podioDeTorneo(t);
    const individual = (t.formato ?? 'grupos') === 'individual';
    const enVivo = torneoEnVivo(t, ahoraMs);
    return (
      <li key={t.id} className="carta">
        <Link className="titulo-torneo" to={`/torneos/${t.id}`}>
          <strong>{t.nombre}</strong>
          <span>
            {new Date(t.creadoEl).toLocaleDateString('es-UY')} · {t.parejas.length} {individual ? 'jugadores' : 'parejas'} ·{' '}
            {ETIQUETA_FORMATO[t.formato ?? 'grupos']} · {ETIQUETA_FASE[t.fase]}
            {t.categoria ? ` · Cat ${t.categoria}` : ''}
            {t.fase === 'terminado' && podio.campeon ? ` · 🏆 ${nombreDe(t, podio.campeon)}` : ''}
          </span>
        </Link>
        {enVivo && (
          <span className="en-vivo"><span className="punto-vivo" /> En vivo</span>
        )}
      </li>
    );
  };

  return (
    <div className="rk">
      <main className="contenedor">
        <header className="cabecera">
          <h1><span className="marca">TORNEOS</span> VOLEA</h1>
          <div className="acciones">
            <Link className="boton secundario" to="/programacion">Programación</Link>
            <Link className="boton secundario" to="/ranking">Ver ranking</Link>
          </div>
        </header>

        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar categoría o jugador… (ej: mixto b, femenino, tu nombre)"
          aria-label="Buscar torneo por categoría o jugador"
          style={{ width: '100%', marginBottom: 16 }}
        />

        {torneos.length === 0 ? (
          <p className="vacio">Todavía no hay torneos publicados.</p>
        ) : q !== '' ? (
          filtrados.length === 0 ? (
            <p className="vacio">Nada con "{busqueda}". Probá con la categoría (ej: "mixto b") o un apellido.</p>
          ) : (
            <ul className="lista-torneos">{filtrados.map(cartaCategoria)}</ul>
          )
        ) : grupoSel ? (
          <>
            <button className="boton secundario" style={{ marginBottom: 14 }} onClick={() => setEventoSel(null)}>
              ← Todos los torneos
            </button>
            <h2 style={{ margin: '0 0 12px', fontSize: '1.15rem' }}>
              {grupoSel.nombre}
              {grupoSel.enVivo && <span className="en-vivo" style={{ marginLeft: 10 }}><span className="punto-vivo" /> En vivo</span>}
            </h2>
            <ul className="lista-torneos">{grupoSel.torneos.map(cartaCategoria)}</ul>
          </>
        ) : (
          <ul className="lista-torneos">
            {eventos.map((ev) => {
              const unico = ev.torneos[0];
              const jugadores = new Set(ev.torneos.flatMap((t) => t.parejas.flatMap((p) => p.jugadorIds))).size;
              const resumen = `${new Date(ev.ultimaFecha).toLocaleDateString('es-UY')} · ${
                ev.suelto
                  ? `${unico.parejas.length} ${(unico.formato ?? 'grupos') === 'individual' ? 'jugadores' : 'parejas'} · ${ETIQUETA_FASE[unico.fase]}`
                  : `${ev.torneos.length} categorías · ${jugadores} jugadores${ev.terminado ? ' · Terminado' : ''}`
              }`;
              const contenido = (
                <>
                  <strong>{ev.nombre}</strong>
                  <span>{resumen}</span>
                </>
              );
              return (
                <li key={ev.nombre} className="carta">
                  {ev.suelto ? (
                    <Link className="titulo-torneo" to={`/torneos/${unico.id}`}>{contenido}</Link>
                  ) : (
                    <button
                      className="titulo-torneo"
                      style={{ background: 'none', border: 'none', textAlign: 'left', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }}
                      onClick={() => setEventoSel(ev.nombre)}
                    >
                      {contenido}
                    </button>
                  )}
                  {ev.enVivo && (
                    <span className="en-vivo"><span className="punto-vivo" /> En vivo</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
