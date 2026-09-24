import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, RotateCw } from 'lucide-react';
import TorneosApp from '../torneos/TorneosApp';
import { useSyncTorneos, type EstadoSync } from '../torneos/useSyncTorneos';
import { Boton } from '../admin/ui';
import { cn } from '../lib/cn';
import '../torneos/torneos.css';

// Píldora fija con el estado de la sincronización (rediseño 24/09). Antes era un texto
// chico arriba de todo ("✓ Sincronizado" en lima sobre blanco: al sol no se veía) y al
// bajar por la llave se perdía de vista. Ahora queda siempre a mano, con colores de alto
// contraste, y tocarla refresca desde el server. Solo muestra el estado que ya expone
// useSyncTorneos: el "hace X" se mide acá, desde que el estado pasó a sincronizado.
const PILDORA: Record<EstadoSync, { texto: string; clase: string; icono: ReactNode }> = {
  sincronizado: { texto: 'Sincronizado', clase: 'bg-emerald-700 text-white', icono: <CheckCircle2 size={17} aria-hidden /> },
  pendiente: { texto: 'Guardando…', clase: 'bg-navy-700 text-white', icono: <Loader2 size={17} className="animate-spin" aria-hidden /> },
  sinConexion: { texto: 'Sin conexión · queda en este equipo', clase: 'bg-red-700 text-white', icono: <CloudOff size={17} aria-hidden /> },
  conflicto: { texto: 'Cambios sin subir · elegí versión', clase: 'bg-amber-400 text-navy-900', icono: <AlertTriangle size={17} aria-hidden /> },
};

function haceCuanto(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'recién';
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.round(m / 60)} h`;
}

function PildoraSync({ estado, refrescando, alRefrescar }: { estado: EstadoSync; refrescando: boolean; alRefrescar: () => void }) {
  const desde = useRef(Date.now());
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    if (estado === 'sincronizado') desde.current = Date.now();
    setAhora(Date.now());
  }, [estado]);
  useEffect(() => {
    if (estado !== 'sincronizado') return;
    const t = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [estado]);

  const p = PILDORA[estado];
  const detalle = estado === 'sincronizado' ? ` · ${haceCuanto(ahora - desde.current)}` : '';
  // Portal a <body>: el .fade-in del panel deja un transform y `fixed` quedaría relativo a él.
  return createPortal(
    <>
      {/* El lector de pantalla oye el cambio de estado, no el reloj que corre cada segundo. */}
      <span className="sr-only" aria-live="polite">{p.texto}</span>
      <button
        type="button"
        onClick={alRefrescar}
        disabled={refrescando}
        title="Tocá para traer lo último del server"
        aria-label={`${p.texto}. Refrescar desde el server`}
        className={cn(
          'fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-30 inline-flex h-11 max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full pl-3.5 pr-3 font-display text-[13px] font-bold shadow-lg ring-1 ring-black/10 transition-transform active:scale-[0.97] lg:left-auto lg:right-6',
          p.clase,
        )}
      >
        {p.icono}
        <span className="truncate tabular-nums">{p.texto}{detalle}</span>
        <span aria-hidden className="ml-1 border-l border-current pl-2 opacity-70">
          <RotateCw size={15} className={refrescando ? 'animate-spin' : ''} />
        </span>
      </button>
    </>,
    document.body,
  );
}

export function AdminTorneosTab({ avisar }: { avisar: (mensaje: string) => void }) {
  const { estado, setEstado, estadoSync, conflictos, resolverConflicto, refrescar } = useSyncTorneos(avisar);
  const [refrescando, setRefrescando] = useState(false);

  async function onRefrescar() {
    setRefrescando(true);
    try {
      await refrescar();
    } finally {
      setRefrescando(false);
    }
  }

  return (
    <div>
      <PildoraSync estado={estadoSync} refrescando={refrescando} alRefrescar={() => void onRefrescar()} />
      {conflictos.map((id) => {
        const t = estado.torneos.find((x) => x.id === id);
        return (
          <div key={id} role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="flex items-start gap-2 text-sm text-amber-900">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />
              <span>
                <strong className="font-bold">{t?.nombre ?? id}</strong>: hay una versión distinta en el server y vos tenés cambios sin subir acá. ¿Con cuál te quedás?
              </span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Boton onClick={() => void resolverConflicto(id, 'local')}>Mi versión</Boton>
              <Boton variante="secundario" onClick={() => void resolverConflicto(id, 'server')}>La del server</Boton>
            </div>
          </div>
        );
      })}
      <div className="rk rk--admin">
        <TorneosApp estado={estado} setEstado={setEstado} />
      </div>
    </div>
  );
}
