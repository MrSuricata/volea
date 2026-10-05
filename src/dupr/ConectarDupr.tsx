import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { conectarConDupr, leerMensajeDeLogin } from './dupr';
import type { ConexionDupr } from './dupr';

const rating = (n: number | null) => (n === null ? 'sin rating' : n.toFixed(3));

/**
 * "Conectar con DUPR": abre la página de login de DUPR en un iframe (así lo exige DUPR: el
 * DUPR ID no se escribe a mano), espera el mensaje con la sesión y se lo pasa al servidor
 * para que compruebe de quién es. Devuelve la cuenta ya comprobada, con su rating.
 */
export default function ConectarDupr({ login, conexion, alConectar, comoEquipo = false, etiqueta = 'Conectar con DUPR', discreto = false }: {
  /** Página de login de DUPR (la da /api/dupr/config). */
  login: string;
  conexion: ConexionDupr | null;
  alConectar: (c: ConexionDupr) => void;
  /** La cuenta es de alguien del equipo: queda guardada para subir partidos a nombre del club. */
  comoEquipo?: boolean;
  etiqueta?: string;
  /** Botón chico de borde, para cuando ya hay una cuenta conectada a la vista. */
  discreto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [comprobando, setComprobando] = useState(false);
  const [error, setError] = useState('');
  const botonCerrar = useRef<HTMLButtonElement>(null);
  // DUPR puede mandar el mensaje más de una vez: mientras se comprueba uno, los demás se ignoran
  const ocupado = useRef(false);

  useEffect(() => {
    if (!abierto) return;
    const alMensaje = (e: MessageEvent) => {
      const sesion = leerMensajeDeLogin(e, login);
      if (!sesion || ocupado.current) return;
      ocupado.current = true;
      setComprobando(true);
      setError('');
      void conectarConDupr(sesion, { comoEquipo }).then((r) => {
        ocupado.current = false;
        setComprobando(false);
        if (!r.ok) { setError(r.error); return; }
        alConectar(r.datos);
        setAbierto(false);
      });
    };
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    window.addEventListener('message', alMensaje);
    window.addEventListener('keydown', alTeclear);
    const desborde = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    botonCerrar.current?.focus();
    return () => {
      window.removeEventListener('message', alMensaje);
      window.removeEventListener('keydown', alTeclear);
      document.body.style.overflow = desborde;
    };
  }, [abierto, login, comoEquipo, alConectar]);

  const abrir = () => { setError(''); setAbierto(true); };

  return (
    <>
      {conexion ? (
        <div className="rounded-xl border border-lime-500/50 bg-lime-400/10 p-3">
          <p className="flex items-center gap-2 text-sm font-bold text-navy-700">
            <CheckCircle2 size={18} className="shrink-0 text-lime-800" aria-hidden />
            DUPR conectado{conexion.nombre ? ` · ${conexion.nombre}` : ''}
          </p>
          <p className="mt-1 text-sm text-navy-700">
            Dobles <strong>{rating(conexion.dobles)}</strong> · Singles <strong>{rating(conexion.singles)}</strong>
            <span className="text-gray-500"> · ID {conexion.duprId}</span>
          </p>
          {conexion.habilitado === false && (
            <p className="mt-1 text-xs font-semibold text-red-700">
              DUPR indica que esta cuenta no está habilitada para partidos con rating. Revisalo en tu cuenta de DUPR.
            </p>
          )}
          <button type="button" onClick={abrir} className="mt-2 text-xs font-semibold text-lime-800 hover:underline">
            Usar otra cuenta
          </button>
        </div>
      ) : (
        <button type="button" onClick={abrir}
          className={discreto
            ? 'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-navy-700 transition-colors hover:border-navy-700'
            : 'w-full rounded-xl bg-navy-700 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-navy-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400'}>
          {etiqueta}
        </button>
      )}

      {abierto && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-navy-900/70 p-3"
          role="dialog" aria-modal="true" aria-label="Iniciar sesión en DUPR"
          onClick={(e) => { if (e.target === e.currentTarget) setAbierto(false); }}>
          <div className="flex h-[min(720px,92vh)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
              <span className="text-sm font-bold text-navy-700">Conectar con DUPR</span>
              <button ref={botonCerrar} type="button" aria-label="Cerrar" onClick={() => setAbierto(false)}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-navy-700">
                <X size={20} />
              </button>
            </div>
            {comprobando ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-navy-700" role="status">
                <Loader2 size={32} className="animate-spin" aria-hidden />
                <span className="text-sm font-semibold">Comprobando tu cuenta con DUPR…</span>
              </div>
            ) : (
              // allow="payment": lo pide DUPR (desde su login se puede contratar DUPR+)
              <iframe src={login} title="Iniciar sesión en DUPR" allow="payment" className="w-full flex-1 border-0" />
            )}
            {error && (
              <p role="alert" className="border-t border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700">{error}</p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
