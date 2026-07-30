import TorneosApp from '../torneos/TorneosApp';
import { useSyncTorneos } from '../torneos/useSyncTorneos';
import '../torneos/torneos.css';

const ETIQUETA_SYNC: Record<string, { texto: string; clase: string }> = {
  sincronizado: { texto: '✓ Sincronizado', clase: 'text-lime-500' },
  pendiente: { texto: '⏳ Sincronizando…', clase: 'text-amber-400' },
  sinConexion: { texto: '⚠ Sin conexión — trabajando local', clase: 'text-red-400' },
};

export function AdminTorneosTab({ avisar }: { avisar: (mensaje: string) => void }) {
  const { estado, setEstado, estadoSync, conflictos, resolverConflicto, refrescar } = useSyncTorneos(avisar);
  const et = ETIQUETA_SYNC[estadoSync];

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className={`text-sm font-semibold ${et.clase}`}>{et.texto}</span>
        <button className="text-sm underline text-navy-500 hover:text-navy-700" onClick={() => void refrescar()}>Refrescar</button>
      </div>
      {conflictos.map((id) => {
        const t = estado.torneos.find((x) => x.id === id);
        return (
          <div key={id} className="mb-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-navy-800">
            ⚠ <strong>{t?.nombre ?? id}</strong> fue modificado por otro admin mientras vos tenías cambios sin subir. ¿Con cuál te quedás?
            <div className="mt-2 flex gap-2">
              <button className="rounded bg-navy-700 px-3 py-1 text-white" onClick={() => void resolverConflicto(id, 'local')}>Mi versión</button>
              <button className="rounded border border-navy-700 px-3 py-1" onClick={() => void resolverConflicto(id, 'server')}>La del server</button>
            </div>
          </div>
        );
      })}
      <div className="rk">
        <TorneosApp estado={estado} setEstado={setEstado} />
      </div>
    </div>
  );
}
