import { Trophy } from 'lucide-react';
import type { StandingEntry } from '../types';

const formatPrice = (n: number) => '$ ' + n.toLocaleString('es-UY', { maximumFractionDigits: 0 });
void formatPrice;

const formatPoints = (n: number) => n.toLocaleString('es-UY', { maximumFractionDigits: 0 });

function groupByCategory(standings: StandingEntry[]): [string, StandingEntry[]][] {
  const groups = new Map<string, StandingEntry[]>();
  for (const entry of standings) {
    const cat = entry.category || 'General';
    const list = groups.get(cat);
    if (list) {
      list.push(entry);
    } else {
      groups.set(cat, [entry]);
    }
  }
  const names = Array.from(groups.keys()).sort((a, b) => {
    if (a === 'General') return -1;
    if (b === 'General') return 1;
    return a.localeCompare(b, 'es');
  });
  return names.map(name => [
    name,
    [...(groups.get(name) || [])].sort((a, b) => a.position - b.position),
  ]);
}

function PositionBadge({ position }: { position: number }) {
  if (position <= 3) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-lime-400 text-navy-700 font-bold text-sm shrink-0">
          {position}
        </span>
        {position === 1 && <Trophy size={16} className="text-lime-600 shrink-0" aria-label="Primer puesto" />}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-8 h-8 text-gray-400 font-semibold text-sm">
      {position}
    </span>
  );
}

function StandingsTable({ entries }: { entries: StandingEntry[] }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-3 font-display text-xs font-bold uppercase tracking-wider text-gray-500 w-16">
                Pos
              </th>
              <th className="px-4 py-3 font-display text-xs font-bold uppercase tracking-wider text-gray-500">
                Jugador/a
              </th>
              <th className="px-4 py-3 font-display text-xs font-bold uppercase tracking-wider text-gray-500 text-right">
                Puntos
              </th>
              <th className="px-4 py-3 font-display text-xs font-bold uppercase tracking-wider text-gray-500 hidden sm:table-cell">
                Notas
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <tr
                key={entry.id}
                className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors"
              >
                <td className="px-4 py-3">
                  <PositionBadge position={entry.position} />
                </td>
                <td className="px-4 py-3 font-semibold text-navy-700">
                  {entry.playerName}
                </td>
                <td className="px-4 py-3 text-right font-display font-bold text-navy-700">
                  {formatPoints(entry.points)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500 hidden sm:table-cell">
                  {entry.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StandingsPage({ standings }: { standings: StandingEntry[] }) {
  const groups = groupByCategory(standings);
  const showCategoryTitles = groups.length > 1 || (groups.length === 1 && groups[0][0] !== 'General');

  return (
    <div className="fade-in max-w-5xl mx-auto px-4 py-12">
      {/* Header */}
      <p className="font-display text-sm font-bold tracking-[0.2em] text-lime-600 mb-2">
        CAMINO AL MUNDIAL
      </p>
      <h1 className="font-display text-3xl md:text-4xl font-bold text-navy-700">Clasificación</h1>
      <div className="w-16 h-1 bg-lime-400 mb-8" />
      <p className="text-gray-500 mb-10 max-w-2xl">
        Ranking de jugadores y jugadoras rumbo al Mundial de pickleball, actualizado por el equipo VOLEA.
      </p>

      {groups.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <div className="w-16 h-16 bg-lime-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trophy size={32} className="text-lime-600" />
          </div>
          <p className="font-display font-semibold text-navy-700">
            Todavía no hay posiciones cargadas. El camino al Mundial empieza muy pronto.
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {groups.map(([category, entries]) => (
            <section key={category}>
              {showCategoryTitles && (
                <h2 className="font-display text-xl font-bold text-navy-700 mb-4">{category}</h2>
              )}
              <StandingsTable entries={entries} />
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 text-center mt-10">
        Los puntos se actualizan después de cada torneo oficial.
      </p>
    </div>
  );
}
