import { Link } from 'react-router-dom';
import '../torneos.css';

// Pestañas comunes de las páginas públicas de torneos: de un cuadro se puede ir a la agenda,
// a lo que se está jugando o al ranking sin pasar por el menú del sitio. No va en el modo TV.
// Es la única puerta a Agenda y Ranking desde que salieron del menú principal (24/11): si se
// agrega o saca una, repetirlo en PestanasTorneosClaras (App.tsx), que es la versión clara.
const PESTANAS = [
  { clave: 'torneos', to: '/torneos', texto: 'Torneos' },
  { clave: 'agenda', to: '/eventos', texto: 'Agenda' },
  { clave: 'programacion', to: '/programacion', texto: 'En vivo' },
  { clave: 'ranking', to: '/ranking', texto: 'Ranking' },
] as const;

export default function NavPublica({ activa }: { activa: (typeof PESTANAS)[number]['clave'] }) {
  return (
    <nav className="nav-publica" aria-label="Torneos">
      {PESTANAS.map((p) => (
        <Link key={p.clave} to={p.to} className={p.clave === activa ? 'activa' : undefined}
          aria-current={p.clave === activa ? 'page' : undefined}>
          {p.texto}
        </Link>
      ))}
    </nav>
  );
}
