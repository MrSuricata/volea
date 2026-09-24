import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Shuffle } from 'lucide-react';
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
import { Boton, Campo, Insignia, Interruptor, Selector } from '../../admin/ui';
import { Nota, PiePaso } from './piezas';

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

  // Hay algo armado que se perdería (sorteado o asignado a mano).
  const hayAsignadas = torneo.grupos.some((g) => g.parejaIds.length > 0);

  // Cambiar la cantidad rehace los grupos vacíos: si ya había parejas asignadas, se pregunta
  // antes (un toque de más en el selector borraba el reparto entero sin aviso).
  async function cambiarCantidad(cantidad: number) {
    if (cantidad === cantidadVisible && torneo.grupos.length === cantidad) return;
    if (hayAsignadas) {
      const ok = await dialogos.confirmar({
        titulo: 'Cambiar cantidad de grupos',
        mensaje: `Pasar a ${cantidad} grupo${cantidad > 1 ? 's' : ''} vacía los grupos armados: vas a tener que volver a sortear o asignar. ¿Seguir?`,
        textoConfirmar: 'Cambiar',
        peligro: true,
      });
      if (!ok) return;
    }
    crearGruposVacios(cantidad);
  }

  async function sortear() {
    // Re-sortear pisa el reparto actual (quizás acomodado a mano): se confirma antes.
    if (hayAsignadas) {
      const ok = await dialogos.confirmar({
        titulo: 'Volver a sortear',
        mensaje: 'El sorteo reemplaza los grupos armados ahora (incluidos los cambios a mano). ¿Sortear de nuevo?',
        textoConfirmar: 'Sortear',
      });
      if (!ok) return;
    }
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
      // el flag vive en el torneo: si se rearma el fixture (acá o volviendo de otro paso) se re-aplica
      partidosGrupo: generarPartidosGrupos(t.grupos, { idaYVuelta: t.idaYVuelta }),
      configLlave: null,
      partidosLlave: null,
      fase: 'faseGrupos',
    }));
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Campo etiqueta="Cantidad de grupos" className="sm:w-56">
            <Selector value={cantidadVisible} onChange={(e) => void cambiarCantidad(Number(e.target.value))}>
              {opciones.map((o) => (
                <option key={o} value={o}>
                  {o} {o === sugerida ? '(sugerido)' : ''}
                </option>
              ))}
            </Selector>
          </Campo>
          <Boton icono={<Shuffle size={18} />} onClick={() => void sortear()} disabled={opciones.length === 0}>
            {hayAsignadas ? 'Volver a sortear' : 'Sortear grupos'}
          </Boton>
        </div>
        <div className="mt-3 border-t border-gray-100 pt-1">
          <Interruptor
            activo={torneo.idaYVuelta ?? false}
            alCambiar={(marcado) => actualizar((t) => ({ ...t, idaYVuelta: marcado }))}
            etiqueta="Ida y vuelta (doble rueda)"
            descripcion="Cada cruce se juega dos veces."
          />
        </div>
        <div className="mt-2 space-y-2 empty:hidden">
          {opciones.length === 0 && <Nota tono="alerta">Con {cantParejas} parejas no se puede armar ningún grupo válido (mínimo 3).</Nota>}
          {opciones.length > 0 && !opciones.includes(cantidadActual) && (
            <Nota>
              La cantidad de grupos actual ({torneo.grupos.length}) ya no sirve para {cantParejas} parejas: elegí una nueva y volvé a sortear.
            </Nota>
          )}
          {sinAsignar.length > 0 && (
            <Nota>Faltan asignar {sinAsignar.length}: usá el selector de cada pareja o el sorteo.</Nota>
          )}
          {grupoChico && sinAsignar.length === 0 && (
            <Nota>El grupo {grupoChico.nombre} tiene menos de 3 parejas: mové alguna.</Nota>
          )}
        </div>
      </div>

      {sinAsignar.length > 0 && (
        <BloqueGrupo titulo="Sin grupo" cantidad={sinAsignar.length} resaltado>
          {sinAsignar.map((p) => (
            <FilaAsignacion key={p.id} torneo={torneo} parejaId={p.id} onAsignar={asignar} onQuitar={quitar} />
          ))}
        </BloqueGrupo>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {torneo.grupos.map((g) => (
          <BloqueGrupo key={g.id} titulo={`Grupo ${g.nombre}`} cantidad={g.parejaIds.length} chico={g.parejaIds.length > 0 && g.parejaIds.length < 3}>
            {g.parejaIds.map((id) => (
              <FilaAsignacion key={id} torneo={torneo} parejaId={id} onAsignar={asignar} onQuitar={quitar} />
            ))}
            {g.parejaIds.length === 0 && <p className="px-3 py-4 text-center text-sm text-gray-500">Vacío</p>}
          </BloqueGrupo>
        ))}
      </div>

      <PiePaso
        izquierda={(
          <Boton variante="secundario" icono={<ArrowLeft size={18} />} onClick={() => actualizar((t) => ({ ...t, fase: 'parejas' }))}>
            Parejas
          </Boton>
        )}
        derecha={(
          <Boton disabled={!listo} onClick={() => void confirmar()} icono={<ArrowRight size={18} />} className="flex-row-reverse">
            Confirmar grupos y armar fixture
          </Boton>
        )}
      />
    </section>
  );
}

function BloqueGrupo({ titulo, cantidad, resaltado, chico, children }: {
  titulo: string;
  cantidad: number;
  resaltado?: boolean;
  chico?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={resaltado ? 'rounded-xl border border-amber-300 bg-amber-50/40' : 'rounded-xl border border-gray-200 bg-white'}>
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy-700">{titulo}</h3>
        <Insignia tono={chico ? 'atencion' : resaltado ? 'atencion' : 'neutro'}>{cantidad} {cantidad === 1 ? 'pareja' : 'parejas'}</Insignia>
      </div>
      <div className="divide-y divide-gray-100">{children}</div>
    </div>
  );
}

function FilaAsignacion({ torneo, parejaId, onAsignar, onQuitar }: {
  torneo: Torneo;
  parejaId: string;
  onAsignar: (parejaId: string, grupoId: string) => void;
  onQuitar: (parejaId: string) => void;
}) {
  const nombre = nombreDe(torneo, parejaId);
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <span className="min-w-0 flex-1 break-words text-[15px] font-semibold text-navy-700">{nombre}</span>
      <SelectorGrupo torneo={torneo} parejaId={parejaId} nombre={nombre} onAsignar={onAsignar} onQuitar={onQuitar} />
    </div>
  );
}

function SelectorGrupo({ torneo, parejaId, nombre, onAsignar, onQuitar }: {
  torneo: Torneo;
  parejaId: string;
  nombre: string;
  onAsignar: (parejaId: string, grupoId: string) => void;
  onQuitar: (parejaId: string) => void;
}) {
  const actual = torneo.grupos.find((g) => g.parejaIds.includes(parejaId))?.id ?? '';
  return (
    <Selector
      value={actual}
      aria-label={`Grupo de ${nombre}`}
      className="w-36 shrink-0"
      onChange={(e) => (e.target.value === '' ? onQuitar(parejaId) : onAsignar(parejaId, e.target.value))}
    >
      <option value="">— sin grupo —</option>
      {torneo.grupos.map((g) => (
        <option key={g.id} value={g.id}>Grupo {g.nombre}</option>
      ))}
    </Selector>
  );
}
