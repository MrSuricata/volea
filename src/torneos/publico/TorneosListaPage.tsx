import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Torneo } from '../engine/tipos';
import { normalizar } from '../../utils/nombres';
import { nombreDe } from '../ui/util';
import { podioDeTorneo } from './resultado';
import { agruparPorEvento, listarTorneosPublicos, torneoEnVivo } from './datos';
import type { TorneoPublico } from './datos';
import { RkCargando, RkError } from './Estados';
import NavPublica from './NavPublica';
import VitrinaTienda from '../../tienda/VitrinaTienda';
import '../torneos.css';

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

const ETIQUETA_FASE: Record<Torneo['fase'], string> = {
  parejas: 'Inscripción', grupos: 'Armando grupos', faseGrupos: 'Fase de grupos', llave: 'Llave en juego', terminado: 'Terminado',
};
const ETIQUETA_FORMATO: Record<string, string> = { grupos: 'Grupos + Llave', individual: 'One Point Challenge' };

type Estado = 'cargando' | 'ok' | 'error';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** "11 nov" (con el año si no es el actual): sin 11/11/2026, que un extranjero lee como mes/día. */
function fechaEscrita(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MESES[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

const ChipFase = ({ fase }: { fase: Torneo['fase'] }) => <span className={`chip chip-fase fase-${fase}`}>{ETIQUETA_FASE[fase]}</span>;

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
          <span className="meta-torneo">
            <ChipFase fase={t.fase} />
            <span>{fechaEscrita(t.creadoEl)}</span>
            <span>{individual ? plural(t.parejas.length, 'jugador', 'jugadores') : plural(t.parejas.length, 'pareja', 'parejas')}</span>
            <span>{ETIQUETA_FORMATO[t.formato ?? 'grupos']}</span>
            {t.categoria && <span>Cat {t.categoria}</span>}
            {t.fase === 'terminado' && podio.campeon && <span className="campeon-mini">🏆 {nombreDe(t, podio.campeon)}</span>}
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
        <NavPublica activa="torneos" />
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
          // Corto: en el celular el ejemplo largo quedaba cortado a la mitad ("… mixto b, fe").
          enterKeyHint="search"
          placeholder="Buscá tu nombre o categoría…"
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
              const individualUnico = (unico.formato ?? 'grupos') === 'individual';
              const equipos = ev.torneos.reduce((n, t) => n + t.parejas.length, 0);
              const contenido = (
                <>
                  <strong>{ev.nombre}</strong>
                  <span className="meta-torneo">
                    {ev.suelto
                      ? <ChipFase fase={unico.fase} />
                      : <span className={`chip chip-fase fase-${ev.terminado ? 'terminado' : ev.enVivo ? 'llave' : 'faseGrupos'}`}>{ev.terminado ? 'Terminado' : ev.enVivo ? 'En juego' : 'En curso'}</span>}
                    <span>{fechaEscrita(ev.ultimaFecha)}</span>
                    {ev.suelto
                      ? <span>{individualUnico ? plural(unico.parejas.length, 'jugador', 'jugadores') : plural(unico.parejas.length, 'pareja', 'parejas')}</span>
                      : <>
                        <span>{plural(ev.torneos.length, 'categoría', 'categorías')}</span>
                        {jugadores > 0 && <span>{plural(jugadores, 'jugador', 'jugadores')}</span>}
                        <span>{plural(equipos, 'equipo/pareja', 'equipos/parejas')}</span>
                      </>}
                  </span>
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
        <VitrinaTienda />
      </main>
    </div>
  );
}
