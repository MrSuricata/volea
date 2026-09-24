import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { PropsPaso } from '../TorneosApp';
import type { PartidoGrupo, Torneo } from '../engine/tipos';
import { resultadoValido } from '../engine/tipos';
import { calcularTabla } from '../engine/tabla';
import { ordenDeJuego } from '../engine/canchas';
import { nombreDe } from './util';
import { useDialogos } from './dialogos';
import { Boton, Insignia, Segmentado, Selector } from '../../admin/ui';
import { FilaMarcador, Nota, PiePaso } from './piezas';

export default function PasoFaseGrupos({ torneo, actualizar }: PropsPaso) {
  const dialogos = useDialogos();
  const [vista, setVista] = useState<'rondas' | 'grupos'>('rondas');
  const canchas = torneo.canchas ?? 2;

  function cargarResultado(partidoId: string, puntosA: number | null, puntosB: number | null) {
    actualizar((t) => ({
      ...t,
      partidosGrupo: t.partidosGrupo.map((p) => (p.id === partidoId ? { ...p, puntosA, puntosB } : p)),
    }));
  }

  const total = torneo.partidosGrupo.length;
  const jugados = torneo.partidosGrupo.filter((p) => resultadoValido(p.puntosA, p.puntosB)).length;
  const faltan = total - jugados;

  async function irALlave() {
    if (faltan > 0) {
      const ok = await dialogos.confirmar({
        titulo: torneo.partidosLlave ? 'Ver la llave' : 'Armar la llave',
        mensaje: torneo.partidosLlave
          ? `Faltan ${faltan} partido${faltan > 1 ? 's' : ''} por jugar. ¿Ver la llave igual?`
          : `Faltan ${faltan} partido${faltan > 1 ? 's' : ''} por jugar y la tabla puede cambiar. ¿Armar la llave igual?`,
        textoConfirmar: torneo.partidosLlave ? 'Ver' : 'Armar',
      });
      if (!ok) return;
    }
    actualizar((t) => ({ ...t, fase: 'llave' }));
  }

  async function rearmarLlave() {
    const llave = torneo.partidosLlave;
    if (!llave) return;
    const teniaResultados = llave.some((p) => resultadoValido(p.puntosA, p.puntosB));
    const ok = await dialogos.confirmar({
      titulo: 'Rearmar llave',
      mensaje: teniaResultados
        ? 'La llave ya tiene partidos jugados: rearmarla borra esos resultados. ¿Seguir?'
        : '¿Rearmar la llave con las posiciones actuales?',
      textoConfirmar: 'Rearmar',
      peligro: teniaResultados,
    });
    if (!ok) return;
    actualizar((t) => ({ ...t, configLlave: null, partidosLlave: null, fase: 'llave' }));
  }

  const rondas = [...new Set(torneo.partidosGrupo.map((p) => p.ronda))].sort((a, b) => a - b);
  const porcentaje = total > 0 ? Math.round((jugados / total) * 100) : 0;

  return (
    <section className="space-y-4">
      {/* Barra de control: vista, canchas y avance (con barra: se lee de lejos). */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmentado
            etiqueta="Ver partidos"
            valor={vista}
            alCambiar={setVista}
            opciones={[{ valor: 'rondas', texto: 'Por rondas' }, { valor: 'grupos', texto: 'Por grupo' }]}
          />
          <label className="flex items-center gap-2 text-sm font-semibold text-navy-700">
            Canchas
            <Selector
              value={canchas}
              onChange={(e) => { const n = Number(e.target.value); actualizar((t) => ({ ...t, canchas: n })); }}
              className="w-20"
            >
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </Selector>
          </label>
        </div>
        <div className="mt-3">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold text-navy-700">{jugados} de {total} jugados</span>
            <span className="text-[13px] text-gray-500">{faltan > 0 ? `faltan ${faltan}` : 'todos cargados'}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden>
            <div className="h-full rounded-full bg-navy-700 transition-[width]" style={{ width: `${porcentaje}%` }} />
          </div>
        </div>
      </div>

      {torneo.partidosLlave && (
        <Nota accion={<Boton variante="secundario" onClick={() => void rearmarLlave()}>Rearmar llave</Boton>}>
          La llave se armó con las posiciones de antes. Si corregiste algún resultado acá, rearmala para que tome las posiciones nuevas.
        </Nota>
      )}

      {vista === 'rondas' &&
        rondas.map((r) => {
          const partidosDeLaRonda = torneo.partidosGrupo.filter((p) => p.ronda === r);
          const turnos = ordenDeJuego(partidosDeLaRonda, canchas);
          const partidoPorId = new Map(partidosDeLaRonda.map((p) => [p.id, p]));
          const maxTanda = turnos.length > 0 ? turnos[turnos.length - 1].tanda : 0;
          const tandas = [...new Set(turnos.map((t) => t.tanda))];
          return (
            <div key={r} className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 sm:p-4">
              <h3 className="mb-3 font-display text-base font-bold uppercase tracking-wide text-navy-700">Ronda {r}</h3>
              <div className="space-y-4">
                {tandas.map((tanda) => (
                  <div key={tanda}>
                    {maxTanda > 1 && (
                      <p className="mb-2 font-display text-[12px] font-bold uppercase tracking-[0.15em] text-gray-600">Tanda {tanda}</p>
                    )}
                    <div className="grid gap-2 md:grid-cols-2">
                      {turnos.filter((t) => t.tanda === tanda).map((turno) => (
                        <FilaPartido
                          key={turno.partidoId}
                          torneo={torneo}
                          partido={partidoPorId.get(turno.partidoId)!}
                          onCargar={cargarResultado}
                          conGrupo
                          cancha={turno.cancha}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

      {vista === 'grupos' &&
        torneo.grupos.map((g) => (
          <div key={g.id} className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 sm:p-4">
            <h3 className="mb-3 font-display text-base font-bold uppercase tracking-wide text-navy-700">Grupo {g.nombre}</h3>
            <TablaGrupo torneo={torneo} grupoId={g.id} />
            <div className="grid gap-2 md:grid-cols-2">
              {torneo.partidosGrupo
                .filter((p) => p.grupoId === g.id)
                .map((p) => (
                  <FilaPartido key={p.id} torneo={torneo} partido={p} onCargar={cargarResultado} />
                ))}
            </div>
          </div>
        ))}

      <PiePaso
        izquierda={(
          <Boton variante="secundario" icono={<ArrowLeft size={18} />} onClick={() => actualizar((t) => ({ ...t, fase: 'grupos' }))}>
            Grupos
          </Boton>
        )}
        derecha={(
          <Boton onClick={() => void irALlave()} icono={<ArrowRight size={18} />} className="flex-row-reverse">
            {torneo.partidosLlave ? 'Ver llave' : 'Armar llave'}
          </Boton>
        )}
      />
    </section>
  );
}

function FilaPartido({ torneo, partido, onCargar, conGrupo, cancha }: {
  torneo: Torneo;
  partido: PartidoGrupo;
  onCargar: (id: string, a: number | null, b: number | null) => void;
  conGrupo?: boolean;
  cancha?: number;
}) {
  const grupo = torneo.grupos.find((g) => g.id === partido.grupoId);
  const valido = resultadoValido(partido.puntosA, partido.puntosB);
  const ganaA = valido && (partido.puntosA as number) > (partido.puntosB as number);
  const invalido = partido.puntosA !== null && partido.puntosB !== null && !valido;
  const encabezado = (cancha !== undefined || (conGrupo && grupo)) ? (
    <>
      {cancha !== undefined && <Insignia tono="navy" className="bg-navy-700 text-white ring-0">Cancha {cancha}</Insignia>}
      {conGrupo && grupo && <Insignia>Grupo {grupo.nombre}</Insignia>}
    </>
  ) : undefined;
  return (
    <FilaMarcador
      nombreA={nombreDe(torneo, partido.aId)}
      nombreB={nombreDe(torneo, partido.bId)}
      puntosA={partido.puntosA}
      puntosB={partido.puntosB}
      ganador={valido ? (ganaA ? 'A' : 'B') : null}
      valido={valido}
      aviso={invalido ? (partido.puntosA === partido.puntosB ? 'Empate: no vale (en pickleball no hay empate).' : 'Resultado que no vale.') : null}
      encabezado={encabezado}
      onGuardar={(a, b) => onCargar(partido.id, a, b)}
    />
  );
}

function TablaGrupo({ torneo, grupoId }: { torneo: Torneo; grupoId: string }) {
  const grupo = torneo.grupos.find((g) => g.id === grupoId);
  if (!grupo) return null;
  const filas = calcularTabla(grupo.parejaIds, torneo.partidosGrupo.filter((p) => p.grupoId === grupoId));
  return (
    <div className="tabla-scroll" style={{ marginBottom: 14 }}>
    <table>
      <thead>
        <tr>
          <th>#</th><th className="nombre">Pareja</th><th>PJ</th><th>PG</th><th>PP</th><th>PF</th><th>PC</th><th>Dif</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.parejaId}>
            <td>{f.posicion}{f.desempatePorSorteo ? '*' : ''}</td>
            <td className="nombre">{nombreDe(torneo, f.parejaId)}</td>
            <td>{f.pj}</td><td>{f.pg}</td><td>{f.pp}</td><td>{f.pf}</td><td>{f.pc}</td>
            <td>{f.dif > 0 ? `+${f.dif}` : f.dif}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
