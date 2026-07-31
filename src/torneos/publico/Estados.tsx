import type { ReactNode } from 'react';
import '../torneos.css';

// Estados compartidos por las tres páginas públicas (ranking, lista, detalle). Usados
// DESPUÉS de que el chunk lazy (con torneos.css) ya cargó, así que acá adentro .rk ya
// tiene estilos — no confundir con el fallback de <Suspense> en App.tsx, que se muestra
// ANTES de eso y por eso usa clases Tailwind sueltas, no .rk.

export function RkCargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="rk">
      <main className="contenedor">
        <p className="vacio">{texto}</p>
      </main>
    </div>
  );
}

export function RkError({ mensaje, onReintentar }: { mensaje: string; onReintentar: () => void }) {
  return (
    <div className="rk">
      <main className="contenedor">
        <div className="aviso" role="alert">⚠ {mensaje}</div>
        <button className="boton secundario" onClick={onReintentar} style={{ marginTop: 12 }}>
          Reintentar
        </button>
      </main>
    </div>
  );
}

// Tarjeta chica centrada para avisos puntuales (p. ej. "torneo no encontrado").
export function RkAviso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rk">
      <main className="contenedor">
        <div className="carta" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <h2 style={{ marginTop: 0 }}>{titulo}</h2>
          {children}
        </div>
      </main>
    </div>
  );
}
