import { useMemo, useState } from 'react';
import { ArrowLeft, Merge, Pencil, Search, Trash2, Users } from 'lucide-react';
import type { ConfigPuntos, Jugador, Torneo } from '../engine/tipos';
import { calcularRanking, reasignarJugador, unirJugadores } from '../engine/ranking';
import { useDialogos } from './dialogos';
import { Boton, BotonIcono, EncabezadoPagina, Vacio } from '../../admin/ui';
import { normalizar } from '../../utils/nombres';

type Props = {
  jugadores: Jugador[];
  torneos: Torneo[];
  config: ConfigPuntos;
  setJugadores: (js: Jugador[]) => void;
  setTorneos: (ts: Torneo[]) => void;
  onVolver: () => void;
};

export default function PantallaJugadores({ jugadores, torneos, config, setJugadores, setTorneos, onVolver }: Props) {
  const dialogos = useDialogos();
  const [busqueda, setBusqueda] = useState('');
  const puntosPorJugador = useMemo(() => {
    const m = new Map<string, { puntos: number; torneos: number }>();
    for (const f of calcularRanking(torneos, jugadores, config)) m.set(f.jugadorId, { puntos: f.puntos, torneos: f.torneosJugados });
    return m;
  }, [torneos, jugadores, config]);

  async function renombrar(j: Jugador) {
    const nuevo = await dialogos.pedirTexto({ titulo: 'Renombrar jugador', valorInicial: j.nombre, placeholder: 'Nombre', textoConfirmar: 'Guardar' });
    if (!nuevo) return;
    setJugadores(jugadores.map((x) => (x.id === j.id ? { ...x, nombre: nuevo } : x)));
  }

  async function unirCon(absorbido: Jugador) {
    const otros = jugadores.filter((x) => x.id !== absorbido.id);
    if (otros.length === 0) return;
    // Sin nadie elegido de entrada y con buscador: antes venía marcado el primero de la
    // lista y un Enter apurado unía con cualquiera (no se puede deshacer).
    const quedaId = await dialogos.elegirDeLista({
      titulo: `Unir "${absorbido.nombre}" con…`,
      mensaje: 'Los puntos y torneos se combinan en el jugador que elijas. No se puede deshacer.',
      opciones: [...otros]
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
        .map((x) => ({ clave: x.id, etiqueta: x.nombre, ayuda: x.alias?.length ? `alias: ${x.alias.join(', ')}` : undefined })),
      textoConfirmar: 'Unir',
      sinPreseleccion: true,
      buscador: true,
      peligro: true,
    });
    if (!quedaId) return;
    setJugadores(unirJugadores(jugadores, quedaId, absorbido.id));
    setTorneos(reasignarJugador(torneos, absorbido.id, quedaId));
  }

  async function borrar(j: Jugador) {
    const ok = await dialogos.confirmar({ titulo: 'Borrar jugador', mensaje: `¿Borrar a "${j.nombre}" del padrón? Sus torneos no se tocan.`, textoConfirmar: 'Borrar', peligro: true });
    if (!ok) return;
    setJugadores(jugadores.filter((x) => x.id !== j.id));
  }

  const ordenados = [...jugadores].sort(
    (a, b) => (puntosPorJugador.get(b.id)?.puntos ?? 0) - (puntosPorJugador.get(a.id)?.puntos ?? 0) || a.nombre.localeCompare(b.nombre),
  );
  const q = normalizar(busqueda);
  const visibles = q === '' ? ordenados : ordenados.filter((j) => normalizar(j.nombre).includes(q) || (j.alias ?? []).some((a) => normalizar(a).includes(q)));

  return (
    <main className="contenedor">
      <Boton variante="fantasma" icono={<ArrowLeft size={18} />} onClick={onVolver} className="-ml-3 mb-1">Torneos</Boton>
      <EncabezadoPagina
        rotulo="Torneos"
        titulo="Jugadores"
        descripcion="El padrón del ranking. Se llena solo al vincular torneos; acá se corrigen nombres y se unen duplicados."
      />
      {jugadores.length === 0 ? (
        <Vacio icono={<Users size={22} />} titulo="El padrón está vacío" descripcion="Se llena solo al vincular torneos al ranking." />
      ) : (
        <>
          <div className="relative mb-3">
            <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar jugador o alias…"
              aria-label="Buscar jugador"
              className="h-11 w-full rounded-lg border border-gray-300 bg-white pl-10 pr-3 text-base text-navy-700 placeholder:text-gray-400 focus:border-navy-700 focus:outline-none focus:ring-2 focus:ring-navy-700/15 sm:text-sm"
            />
          </div>
          <p className="mb-2 text-[13px] text-gray-500">{visibles.length} de {jugadores.length} jugadores</p>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {visibles.map((j) => {
              const p = puntosPorJugador.get(j.id);
              return (
                <li key={j.id} className="flex items-center gap-2 py-2 pl-4 pr-1">
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-[15px] font-semibold text-navy-700">{j.nombre}</span>
                    <span className="block text-[13px] text-gray-500">
                      {p ? `${p.puntos} pts · ${p.torneos} ${p.torneos === 1 ? 'torneo' : 'torneos'}` : 'sin torneos'}
                      {j.alias?.length ? ` · alias: ${j.alias.join(', ')}` : ''}
                    </span>
                  </span>
                  <BotonIcono etiqueta={`Renombrar ${j.nombre}`} icono={<Pencil size={18} />} onClick={() => void renombrar(j)} />
                  <BotonIcono etiqueta={`Unir ${j.nombre} con otro jugador`} icono={<Merge size={18} />} onClick={() => void unirCon(j)} />
                  <BotonIcono etiqueta={`Borrar ${j.nombre}`} icono={<Trash2 size={18} />} tono="peligro" onClick={() => void borrar(j)} />
                </li>
              );
            })}
          </ul>
          {visibles.length === 0 && <p className="py-6 text-center text-sm text-gray-500">Nadie coincide con «{busqueda.trim()}».</p>}
        </>
      )}
    </main>
  );
}
