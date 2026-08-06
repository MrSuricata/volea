import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Boundary raíz: sin esto, cualquier excepción de render dejaba la web en blanco. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
