// Hoja de códigos de árbitro del cuadro: para imprimir o copiar por WhatsApp.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Torneo } from '../engine/tipos';
import { Boton, Dialogo } from '../../admin/ui';
import { ladosDelPartido, partidosArbitrables } from './partido';
import { codigosDelTorneo } from './servicio';

export default function HojaCodigos({ torneo, onCerrar }: { torneo: Torneo; onCerrar: () => void }) {
  const [codigos, setCodigos] = useState<Map<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void codigosDelTorneo(torneo).then((r) => (r.ok ? setCodigos(r.valor) : setError(r.error)));
  }, [torneo]);

  const filas = partidosArbitrables(torneo).map(({ partidoId }) => {
    const d = ladosDelPartido(torneo, partidoId);
    return { partidoId, codigo: codigos?.get(partidoId) ?? null, titulo: d?.titulo ?? '', a: d?.a?.nombre ?? 'A definir', b: d?.b?.nombre ?? 'A definir', jugado: d?.jugado ?? false };
  }).filter((f) => !f.jugado);

  const texto = [`Árbitros · ${torneo.nombre}`, 'Entrar en volea.vercel.app/arbitro', '',
    ...filas.filter((f) => f.codigo).map((f) => `${f.codigo} · ${f.titulo} · ${f.a} vs ${f.b}`)].join('\n');

  return (
    <Dialogo abierto titulo="Códigos de árbitro" descripcion="Un código por partido. Se entra en volea.vercel.app/arbitro." alCerrar={onCerrar} ancho="lg"
      pie={(
        <>
          <Boton variante="secundario" onClick={() => window.print()} disabled={!codigos}>Imprimir</Boton>
          <Boton disabled={!codigos} onClick={() => void navigator.clipboard.writeText(texto).then(() => toast.success('Copiado: pegalo en WhatsApp'))}>Copiar para WhatsApp</Boton>
        </>
      )}>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!codigos && !error && <p className="text-sm text-gray-500">Generando códigos…</p>}
      {codigos && (
        <ul className="divide-y divide-gray-100">
          {filas.map((f) => (
            <li key={f.partidoId} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-16 font-mono text-xl font-black tracking-widest text-navy-700">{f.codigo ?? '—'}</span>
              <span className="min-w-0 flex-1"><span className="text-gray-500">{f.titulo} · </span>{f.a} <b>vs</b> {f.b}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialogo>
  );
}
