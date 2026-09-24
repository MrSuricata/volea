import { Fragment, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, Trophy } from 'lucide-react';
import type { ConfigPuntos, Escalon, Jugador, Torneo } from '../engine/tipos';
import { calcularRanking } from '../engine/ranking';
import { Boton, EncabezadoPagina, Insignia, Segmentado, Vacio } from '../../admin/ui';
import { cn } from '../../lib/cn';
import { Nota } from './piezas';

const NOMBRE_ESCALON: Record<Escalon, string> = {
  CAMPEON: 'Campeón', FINALISTA: 'Finalista', SEMI: 'Semi', CUARTOS: 'Cuartos', OCTAVOS: 'Octavos', PARTICIPO: 'Participó',
};

type Props = {
  torneos: Torneo[];
  jugadores: Jugador[];
  config: ConfigPuntos;
  onVincular: (torneoId: string) => void;
  onVolver: () => void;
};

export default function PantallaRanking({ torneos, jugadores, config, onVincular, onVolver }: Props) {
  const [historico, setHistorico] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const anio = new Date().getFullYear();

  const filas = useMemo(
    () => calcularRanking(torneos, jugadores, config, historico ? undefined : { desde: `${anio}-01-01T00:00:00.000Z` }),
    [torneos, jugadores, config, historico, anio],
  );

  const pendientes = torneos.filter(
    (t) => t.fase === 'terminado' && t.cuentaParaRanking !== false && (!t.categoria || t.parejas.some((p) => !(p.jugadorIds && p.jugadorIds.length))),
  );

  return (
    <main className="contenedor">
      <Boton variante="fantasma" icono={<ArrowLeft size={18} />} onClick={onVolver} className="-ml-3 mb-1">Torneos</Boton>
      <EncabezadoPagina
        rotulo="Torneos"
        titulo="Ranking VOLEA"
        acciones={(
          <Segmentado
            etiqueta="Período del ranking"
            valor={historico ? 'historico' : 'anio'}
            alCambiar={(v) => setHistorico(v === 'historico')}
            opciones={[{ valor: 'anio', texto: String(anio) }, { valor: 'historico', texto: 'Histórico' }]}
          />
        )}
      />

      {pendientes.length > 0 && (
        <Nota className="mb-4">
          <span className="font-semibold">
            {pendientes.length} torneo{pendientes.length > 1 ? 's' : ''} terminado{pendientes.length > 1 ? 's' : ''} todavía no suma{pendientes.length > 1 ? 'n' : ''} (falta categoría o vincular jugadores):
          </span>
          <ul className="mt-2 space-y-2">
            {pendientes.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="min-w-0 flex-1">
                  <strong>{t.nombre}</strong>{!t.categoria ? ' — sin categoría' : ' — jugadores sin vincular'}
                </span>
                <Boton variante="secundario" onClick={() => onVincular(t.id)}>Completar</Boton>
              </li>
            ))}
          </ul>
        </Nota>
      )}

      {filas.length === 0 ? (
        <Vacio icono={<Trophy size={22} />} titulo="Todavía no hay puntos" descripcion="Terminá un torneo, ponele categoría A/B y vinculá los jugadores." />
      ) : (
        <div className="tabla-scroll">
          <table>
            <thead>
              <tr><th>#</th><th className="nombre">Jugador</th><th>Puntos</th><th>Torneos</th><th aria-label="Detalle" /></tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <Fragment key={f.jugadorId}>
                  {/* La fila entera abre el detalle (y con teclado: Enter/Espacio sobre la fila). */}
                  <tr
                    onClick={() => setAbierto(abierto === f.jugadorId ? null : f.jugadorId)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAbierto(abierto === f.jugadorId ? null : f.jugadorId); } }}
                    tabIndex={0}
                    aria-expanded={abierto === f.jugadorId}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="font-semibold">{i + 1}</td>
                    <td className="nombre">{f.nombre}</td>
                    <td><strong className="font-display text-base text-navy-700">{f.puntos}</strong></td>
                    <td>{f.torneosJugados}</td>
                    <td><ChevronDown size={16} aria-hidden className={cn('inline text-gray-400 transition-transform', abierto === f.jugadorId && 'rotate-180')} /></td>
                  </tr>
                  {abierto === f.jugadorId && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'left', background: 'var(--navy-1)' }}>
                        <ul className="space-y-1.5">
                          {f.aportes.map((a, k) => (
                            <li key={k} className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-sm', a.descartadoPorEvento && 'opacity-60')}>
                              <span className="text-navy-700">{a.torneoNombre}</span>
                              <Insignia>Cat {a.categoria}</Insignia>
                              <span className="text-gray-600">{NOMBRE_ESCALON[a.escalon]} →</span>
                              <strong className={cn('tabular-nums text-navy-700', a.descartadoPorEvento && 'line-through')}>{a.puntos}</strong>
                              {a.descartadoPorEvento && <span className="text-[13px] text-gray-500">(no cuenta: ya suma el mejor del mismo evento)</span>}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
