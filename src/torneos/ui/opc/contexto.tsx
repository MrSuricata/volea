import { createContext, useContext, type ReactNode } from 'react';
import type { Torneo } from '../../engine/tipos';

// Lo que la pantalla de control del OPC necesita de afuera del torneo abierto: los otros
// torneos (para saltar de una llave a otra sin volver a la lista) y el estado de la
// sincronización (para mostrar si el último toque ya quedó guardado en el server).
// Lo provee TorneosApp; sin proveedor la pantalla funciona igual (sin selector ni estado).

/** Mismos valores que EstadoSync de useSyncTorneos (no se importa para no acoplar el hook). */
export type EstadoSyncOpc = 'sincronizado' | 'pendiente' | 'sinConexion' | 'conflicto';
export type InfoSync = { estado: EstadoSyncOpc; refrescar?: () => void; refrescando?: boolean };

export type ContextoOpc = {
  torneos: Torneo[];
  irATorneo: (id: string) => void;
  sync?: InfoSync;
};

const Ctx = createContext<ContextoOpc | null>(null);

export function ProveedorOpc({ valor, children }: { valor: ContextoOpc; children: ReactNode }) {
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useContextoOpc(): ContextoOpc | null {
  return useContext(Ctx);
}
