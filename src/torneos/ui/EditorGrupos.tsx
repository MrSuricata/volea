import { ArrowRightLeft, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import type { Torneo } from '../engine/tipos';
import { agregarDupla, agregarVuelta, grupoConVuelta, jugadosDe, moverDupla, quitarDupla, quitarVuelta, renombrarDupla } from '../engine/editarGrupos';
import { nombreDe } from './util';
import { useDialogos } from './dialogos';
import { Boton, BotonIcono, Insignia } from '../../admin/ui';

// Cambios de último momento con los grupos en juego: otro jugador en una dupla, sumar, sacar o
// mover una dupla, y agregar la vuelta. Solo se rehacen los partidos del grupo tocado y los
// resultados que siguen teniendo sentido quedan.
export default function EditorGrupos({ torneo, actualizar }: {
  torneo: Torneo;
  actualizar: (cambio: (t: Torneo) => Torneo) => void;
}) {
  const dialogos = useDialogos();
  const llaveArmada = !!torneo.partidosLlave && torneo.partidosLlave.length > 0;

  async function cambiar(parejaId: string) {
    const nombre = await dialogos.pedirTexto({
      titulo: 'Cambiar la dupla',
      valorInicial: nombreDe(torneo, parejaId),
      placeholder: 'NOMBRE APELLIDO y NOMBRE APELLIDO',
      textoConfirmar: 'Guardar',
    });
    if (!nombre || !nombre.trim()) return;
    actualizar((t) => renombrarDupla(t, parejaId, nombre.trim().toUpperCase()));
  }

  async function sacar(parejaId: string) {
    const jugados = jugadosDe(torneo, parejaId);
    const ok = await dialogos.confirmar({
      titulo: 'Sacar la dupla',
      mensaje: jugados > 0
        ? `${nombreDe(torneo, parejaId)} ya jugó ${jugados} partido${jugados > 1 ? 's' : ''}: se borran esos resultados y los rivales quedan con un partido menos. ¿Seguir?`
        : `Sacar a ${nombreDe(torneo, parejaId)} del torneo. Sus partidos sin jugar se borran.`,
      textoConfirmar: 'Sacar',
      peligro: jugados > 0,
    });
    if (ok) actualizar((t) => quitarDupla(t, parejaId));
  }

  async function mover(parejaId: string) {
    const actual = torneo.grupos.find((g) => g.parejaIds.includes(parejaId));
    const destino = await dialogos.elegirDeLista({
      titulo: 'Mover a otro grupo',
      mensaje: `${nombreDe(torneo, parejaId)} juega contra todos los del grupo nuevo. Sus partidos del grupo ${actual?.nombre ?? ''} se borran.`,
      opciones: torneo.grupos.filter((g) => g.id !== actual?.id).map((g) => ({ clave: g.id, etiqueta: `Grupo ${g.nombre}`, ayuda: `${g.parejaIds.length} duplas` })),
      textoConfirmar: 'Mover',
      sinPreseleccion: true,
    });
    if (!destino) return;
    const jugados = jugadosDe(torneo, parejaId);
    if (jugados > 0) {
      const ok = await dialogos.confirmar({ mensaje: `Se borran ${jugados} resultado${jugados > 1 ? 's' : ''} de su grupo actual. ¿Seguir?`, textoConfirmar: 'Mover', peligro: true });
      if (!ok) return;
    }
    actualizar((t) => moverDupla(t, parejaId, destino));
  }

  async function sumar(grupoId: string) {
    const nombre = await dialogos.pedirTexto({
      titulo: 'Agregar dupla al grupo',
      placeholder: 'NOMBRE APELLIDO y NOMBRE APELLIDO',
      textoConfirmar: 'Agregar',
    });
    if (!nombre || !nombre.trim()) return;
    actualizar((t) => agregarDupla(t, grupoId, nombre.trim().toUpperCase()));
  }

  async function vuelta(grupoId: string, conVuelta: boolean) {
    const ok = await dialogos.confirmar({
      titulo: conVuelta ? 'Sacar la vuelta' : 'Agregar la vuelta',
      mensaje: conVuelta
        ? 'Se borran los partidos de vuelta que todavía no se jugaron.'
        : 'Se agregan los mismos cruces con los lados invertidos, a continuación de los que hay.',
      textoConfirmar: conVuelta ? 'Sacar' : 'Agregar',
    });
    if (ok) actualizar((t) => (conVuelta ? quitarVuelta(t, grupoId) : agregarVuelta(t, grupoId)));
  }

  if (llaveArmada) {
    return (
      <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
        La llave ya está armada. Para cambiar duplas o grupos, primero rearmá la llave.
      </p>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {torneo.grupos.map((g) => {
        const conVuelta = grupoConVuelta(torneo, g.id);
        return (
          <div key={g.id} className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h4 className="font-display text-sm font-bold uppercase tracking-wide text-navy-700">Grupo {g.nombre}</h4>
              <Insignia>{g.parejaIds.length} duplas</Insignia>
              {conVuelta && <Insignia tono="navy">Ida y vuelta</Insignia>}
            </div>
            <ul className="divide-y divide-gray-100">
              {g.parejaIds.map((id) => {
                const jugados = jugadosDe(torneo, id);
                return (
                  <li key={id} className="flex items-center gap-1 py-1.5">
                    <span className="min-w-0 flex-1 text-[14px] text-navy-700">
                      {nombreDe(torneo, id)}
                      {jugados > 0 && <span className="ml-1 text-[12px] text-gray-500">· {jugados} jugado{jugados > 1 ? 's' : ''}</span>}
                    </span>
                    <BotonIcono etiqueta={`Cambiar ${nombreDe(torneo, id)}`} icono={<Pencil size={16} />} onClick={() => void cambiar(id)} />
                    {torneo.grupos.length > 1 && (
                      <BotonIcono etiqueta={`Mover ${nombreDe(torneo, id)} a otro grupo`} icono={<ArrowRightLeft size={16} />} onClick={() => void mover(id)} />
                    )}
                    <BotonIcono etiqueta={`Sacar ${nombreDe(torneo, id)}`} icono={<Trash2 size={16} />} tono="peligro" onClick={() => void sacar(id)} />
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              <Boton variante="secundario" icono={<Plus size={16} />} onClick={() => void sumar(g.id)}>Agregar dupla</Boton>
              <Boton variante="secundario" icono={<Repeat size={16} />} onClick={() => void vuelta(g.id, conVuelta)}>
                {conVuelta ? 'Sacar la vuelta' : 'Agregar la vuelta'}
              </Boton>
            </div>
          </div>
        );
      })}
    </div>
  );
}
