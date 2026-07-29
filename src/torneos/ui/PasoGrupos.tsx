import { useEffect, useRef } from 'react';
import type { PropsPaso } from '../TorneosApp';
import type { Torneo } from '../engine/tipos';
import { nuevoId } from '../engine/tipos';
import { crearRng } from '../engine/rng';
import {
  generarPartidosGrupos,
  opcionesCantidadGrupos,
  repartirEnGrupos,
  sugerirCantidadGrupos,
} from '../engine/grupos';
import { nombreDe } from './util';
import { useDialogos } from './dialogos';

const LETRAS = 'ABCDEFGHIJKL';

export default function PasoGrupos({ torneo, actualizar }: PropsPaso) {
  const dialogos = useDialogos();
  const cantParejas = torneo.parejas.length;
  const opciones = opcionesCantidadGrupos(cantParejas);
  const sugerida = sugerirCantidadGrupos(cantParejas);
  // si Brian volvió a Parejas y cambió la cantidad, los grupos armados pueden quedar fuera de las opciones válidas
  const cantidadActual = torneo.grupos.length || sugerida;
  const cantidadVisible = opciones.includes(cantidadActual) ? cantidadActual : (opciones[0] ?? 0);

  // solo en el primer mount: bajo StrictMode el efecto corre dos veces y duplicaría la creación
  const inicializado = useRef(false);
  useEffect(() => {
    if (inicializado.current) return;
    inicializado.current = true;
    if (torneo.grupos.length === 0 && sugerida > 0) crearGruposVacios(sugerida);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intencional: solo inicialización de mount
  }, []);

  function crearGruposVacios(cantidad: number) {
    actualizar((t) => ({
      ...t,
      grupos: Array.from({ length: cantidad }, (_, i) => ({ id: nuevoId(), nombre: LETRAS[i], parejaIds: [] })),
    }));
  }

  function sortear() {
    // usa la cantidad acotada: si la actual quedó inválida, "volvé a sortear" recupera solo
    const cantidad = cantidadVisible || sugerida;
    const repartidos = repartirEnGrupos(
      torneo.parejas.map((p) => p.id),
      cantidad,
      crearRng(Math.floor(Math.random() * 2 ** 31)),
    );
    actualizar((t) => ({
      ...t,
      grupos: repartidos.map((ids, i) => ({ id: nuevoId(), nombre: LETRAS[i], parejaIds: ids })),
    }));
  }

  function asignar(parejaId: string, grupoId: string) {
    actualizar((t) => ({
      ...t,
      grupos: t.grupos.map((g) => ({
        ...g,
        parejaIds:
          g.id === grupoId
            ? [...g.parejaIds.filter((id) => id !== parejaId), parejaId]
            : g.parejaIds.filter((id) => id !== parejaId),
      })),
    }));
  }

  function quitar(parejaId: string) {
    actualizar((t) => ({
      ...t,
      grupos: t.grupos.map((g) => ({ ...g, parejaIds: g.parejaIds.filter((id) => id !== parejaId) })),
    }));
  }

  const asignados = new Set(torneo.grupos.flatMap((g) => g.parejaIds));
  const sinAsignar = torneo.parejas.filter((p) => !asignados.has(p.id));
  const grupoChico = torneo.grupos.find((g) => g.parejaIds.length > 0 && g.parejaIds.length < 3);
  const grupoVacio = torneo.grupos.some((g) => g.parejaIds.length === 0);
  const listo = torneo.grupos.length > 0 && sinAsignar.length === 0 && !grupoChico && !grupoVacio;

  async function confirmar() {
    if (!listo) return;
    const teniaResultados = torneo.partidosGrupo.some((p) => p.puntosA !== null || p.puntosB !== null);
    if (teniaResultados) {
      const ok = await dialogos.confirmar({ titulo: 'Regenerar fixture', mensaje: 'Ya había resultados cargados: regenerar el fixture los borra (y también la llave). ¿Seguir?', textoConfirmar: 'Regenerar', peligro: true });
      if (!ok) return;
    }
    actualizar((t) => ({
      ...t,
      partidosGrupo: generarPartidosGrupos(t.grupos),
      configLlave: null,
      partidosLlave: null,
      fase: 'faseGrupos',
    }));
  }

  return (
    <section>
      <div className="carta">
        <div className="acciones" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <label>
            Cantidad de grupos:{' '}
            <select
              value={cantidadVisible}
              onChange={(e) => crearGruposVacios(Number(e.target.value))}
            >
              {opciones.map((o) => (
                <option key={o} value={o}>
                  {o} {o === sugerida ? '(sugerido)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button className="boton" onClick={sortear}>🎲 Sortear grupos</button>
        </div>
        {opciones.length === 0 && <div className="aviso">Con {cantParejas} parejas no se puede armar ningún grupo válido (mínimo 3).</div>}
        {opciones.length > 0 && !opciones.includes(cantidadActual) && (
          <div className="aviso">
            La cantidad de grupos actual ({torneo.grupos.length}) ya no sirve para {cantParejas} parejas: elegí una nueva y volvé a sortear.
          </div>
        )}
        {sinAsignar.length > 0 && (
          <div className="aviso">Faltan asignar {sinAsignar.length}: usá el selector de cada pareja o el sorteo.</div>
        )}
        {grupoChico && sinAsignar.length === 0 && (
          <div className="aviso">El grupo {grupoChico.nombre} tiene menos de 3 parejas: mové alguna.</div>
        )}
      </div>

      {sinAsignar.length > 0 && (
        <div className="carta" style={{ marginTop: 12 }}>
          <div className="grupo-titulo"><h3>Sin grupo</h3><span className="chip">{sinAsignar.length}</span></div>
          {sinAsignar.map((p) => (
            <div key={p.id} className="fila-partido">
              <span className="lado">{nombreDe(torneo, p.id)}</span>
              <SelectorGrupo torneo={torneo} parejaId={p.id} onAsignar={asignar} onQuitar={quitar} />
            </div>
          ))}
        </div>
      )}

      {torneo.grupos.map((g) => (
        <div key={g.id} className="carta" style={{ marginTop: 12 }}>
          <div className="grupo-titulo">
            <h3>Grupo {g.nombre}</h3>
            <span className="chip">{g.parejaIds.length} parejas</span>
          </div>
          {g.parejaIds.map((id) => (
            <div key={id} className="fila-partido">
              <span className="lado">{nombreDe(torneo, id)}</span>
              <SelectorGrupo torneo={torneo} parejaId={id} onAsignar={asignar} onQuitar={quitar} />
            </div>
          ))}
          {g.parejaIds.length === 0 && <p className="vacio" style={{ padding: '10px 0' }}>Vacío</p>}
        </div>
      ))}

      <footer className="pie-paso">
        <button className="boton secundario" onClick={() => actualizar((t) => ({ ...t, fase: 'parejas' }))}>← Parejas</button>
        <button className="boton" disabled={!listo} onClick={confirmar}>Confirmar grupos → Fixture</button>
      </footer>
    </section>
  );
}

function SelectorGrupo({ torneo, parejaId, onAsignar, onQuitar }: {
  torneo: Torneo;
  parejaId: string;
  onAsignar: (parejaId: string, grupoId: string) => void;
  onQuitar: (parejaId: string) => void;
}) {
  const actual = torneo.grupos.find((g) => g.parejaIds.includes(parejaId))?.id ?? '';
  return (
    <select
      value={actual}
      onChange={(e) => (e.target.value === '' ? onQuitar(parejaId) : onAsignar(parejaId, e.target.value))}
    >
      <option value="">— sin grupo —</option>
      {torneo.grupos.map((g) => (
        <option key={g.id} value={g.id}>Grupo {g.nombre}</option>
      ))}
    </select>
  );
}
