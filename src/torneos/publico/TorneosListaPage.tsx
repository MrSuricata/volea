import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Torneo } from '../engine/tipos';
import { normalizar } from '../../utils/nombres';
import { nombreDe } from '../ui/util';
import { podioDeTorneo } from './resultado';
import { listarTorneosPublicos } from './datos';
import { RkCargando, RkError } from './Estados';
import '../torneos.css';

const ETIQUETA_FASE: Record<Torneo['fase'], string> = {
  parejas: 'Inscripción', grupos: 'Armando grupos', faseGrupos: 'Fase de grupos', llave: 'Llave en juego', terminado: 'Terminado',
};
const ETIQUETA_FORMATO: Record<string, string> = { grupos: 'Grupos + Llave', individual: 'One Point Challenge' };

type Estado = 'cargando' | 'ok' | 'error';

// Lista pública de torneos (los que RLS deja ver: visible = true), más recientes primero.
export default function TorneosListaPage() {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [mensajeError, setMensajeError] = useState('');
  const [torneos, setTorneos] = useState<Torneo[]>([]);
  const [busqueda, setBusqueda] = useState('');

  // Filtro por categoría (nombre del torneo) o por jugador: en la cancha la gente
  // se busca a sí misma. Acento- y mayúscula-insensible (mismo normalizar del padrón).
  const filtrados = useMemo(() => {
    const q = normalizar(busqueda);
    if (!q) return torneos;
    return torneos.filter((t) =>
      normalizar(t.nombre).includes(q) ||
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

  return (
    <div className="rk">
      <main className="contenedor">
        <header className="cabecera">
          <h1><span className="marca">TORNEOS</span> VOLEA</h1>
          <div className="acciones">
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
        ) : filtrados.length === 0 ? (
          <p className="vacio">Nada con "{busqueda}". Probá con la categoría (ej: "mixto b") o un apellido.</p>
        ) : (
          <ul className="lista-torneos">
            {filtrados.map((t) => {
              const podio = podioDeTorneo(t);
              const individual = (t.formato ?? 'grupos') === 'individual';
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
                  {t.fase !== 'terminado' && (
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
