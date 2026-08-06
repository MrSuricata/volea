import React from 'react';

// Error boundary raíz: sin esto, cualquier excepción de render (un dato con forma
// inesperada, un chunk que evaluó mal) dejaba la web EN BLANCO, sin mensaje ni salida.
// Las clases Tailwind ya están disponibles cuando esto renderiza (el CDN cargó antes que
// React), pero por las dudas cada elemento lleva también estilos inline mínimos de
// respaldo: si Tailwind no llegó, el fallback se ve igual (centrado, tipografía system).
type State = { hasError: boolean };

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] excepción de render sin capturar', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        className="min-h-screen bg-white flex flex-col items-center justify-center gap-4 px-4 text-center"
        style={{ minHeight: '100vh', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '16px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}
      >
        {/* /logo.png es texto navy + pelota lima sobre fondo transparente: se ve bien sobre blanco */}
        <img src="/logo.png" alt="VOLEA" style={{ height: '48px' }} />
        <h1 className="font-display text-2xl font-bold text-navy-700" style={{ color: '#001F3F', fontSize: '24px', fontWeight: 700, margin: 0 }}>
          Algo salió mal
        </h1>
        <p className="text-gray-500" style={{ color: '#6b7280', margin: 0 }}>Recargá la página para seguir.</p>
        <button
          onClick={() => window.location.reload()}
          className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-8 rounded-lg transition-colors"
          style={{ background: '#ccff00', color: '#001F3F', fontWeight: 700, padding: '12px 32px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '16px' }}
        >
          Recargar
        </button>
      </div>
    );
  }
}
