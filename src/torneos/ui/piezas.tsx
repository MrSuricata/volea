import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, Check, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { limpiarPuntos, marcadorCambio, puntosDeTexto, textoDeMarcador, type TextoMarcador } from './marcador';

// Piezas del gestor de torneos del admin (rediseño 24/09): carga de resultados con
// borrador, pie de cada paso y avisos. Todo Tailwind; lo que tiene que pisar las reglas
// genéricas de torneos.css (inputs) vive en .rk.rk--admin (ver .caja-puntos).

// ─── Borrador de resultado ───────────────────────────────────────────────────

type Guardar = (puntosA: number | null, puntosB: number | null) => void | Promise<unknown>;

/**
 * Resultado que se tipea en local y se guarda una vez: al salir de la fila (las dos
 * cajas son una unidad), con Enter o con ✓. `guardar` es el MISMO camino de antes
 * (onCargar → confirmación de borradosSiCorrijo si toca → actualizar). Si se cancela
 * la confirmación, la fila vuelve a lo guardado.
 */
export function useBorradorMarcador(puntosA: number | null, puntosB: number | null, guardar: Guardar) {
  const [borrador, setEstadoBorrador] = useState<TextoMarcador | null>(null);
  // Espejo en ref: blur y click llegan en el mismo toque y tienen que ver lo último tipeado.
  const ref = useRef<TextoMarcador | null>(null);
  // Guardando (en la llave puede estar abierta la confirmación): no se dispara dos veces
  // aunque el foco se vaya al modal y la fila "pierda" el foco.
  const enCurso = useRef(false);
  const setBorrador = (b: TextoMarcador | null) => { ref.current = b; setEstadoBorrador(b); };

  const mostrado = borrador ?? textoDeMarcador(puntosA, puntosB);
  const sucio = borrador !== null && marcadorCambio(borrador, puntosA, puntosB);

  function cambiar(lado: 'a' | 'b', texto: string) {
    const base = ref.current ?? textoDeMarcador(puntosA, puntosB);
    setBorrador({ ...base, [lado]: limpiarPuntos(texto) });
  }

  async function confirmar() {
    const b = ref.current;
    if (enCurso.current || b === null) return;
    if (!marcadorCambio(b, puntosA, puntosB)) { setBorrador(null); return; }
    enCurso.current = true;
    try {
      await guardar(puntosDeTexto(b.a), puntosDeTexto(b.b));
    } finally {
      enCurso.current = false;
      setBorrador(null);
    }
  }

  function descartar() { if (!enCurso.current) setBorrador(null); }

  /** onBlur del contenedor de la fila: guarda solo si el foco se fue FUERA de la fila. */
  function alSalirDeLaFila(e: FocusEvent<HTMLElement>) {
    const destino = e.relatedTarget;
    if (destino instanceof Node && e.currentTarget.contains(destino)) return;
    void confirmar();
  }

  function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); void confirmar(); e.currentTarget.blur(); }
    else if (e.key === 'Escape') { descartar(); e.currentTarget.blur(); }
  }

  // Si el celular se bloquea (o se cambia de app) con un resultado a medio guardar, se
  // guarda igual: sin esto quedaba solo en la pantalla y nadie más lo veía.
  const confirmarRef = useRef(confirmar);
  confirmarRef.current = confirmar;
  useEffect(() => {
    if (!sucio) return;
    const alOcultar = () => { if (document.visibilityState === 'hidden') void confirmarRef.current(); };
    document.addEventListener('visibilitychange', alOcultar);
    return () => document.removeEventListener('visibilitychange', alOcultar);
  }, [sucio]);

  return { mostrado, sucio, cambiar, confirmar, alSalirDeLaFila, alTeclear };
}

/** Caja de puntos: teclado numérico, 48px, selecciona todo al entrar (se pisa de un toque). */
export function CajaPuntos({ valor, alCambiar, alTeclear, etiqueta, gana, sinGuardar }: {
  valor: string;
  alCambiar: (texto: string) => void;
  alTeclear: (e: KeyboardEvent<HTMLInputElement>) => void;
  etiqueta: string;
  gana?: boolean;
  sinGuardar?: boolean;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      enterKeyHint="done"
      maxLength={2}
      aria-label={etiqueta}
      className={cn('caja-puntos', gana && 'gana', sinGuardar && 'sin-guardar')}
      value={valor}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => alCambiar(e.target.value)}
      onKeyDown={alTeclear}
    />
  );
}

/** Columna derecha de una fila de resultado: ✓ para guardar si hay borrador, o el tilde de guardado. */
export function EstadoGuardado({ sucio, guardado, alGuardar }: { sucio: boolean; guardado: boolean; alGuardar: () => void }) {
  if (sucio) {
    return (
      <button
        type="button"
        onClick={alGuardar}
        aria-label="Guardar resultado"
        title="Guardar resultado"
        className="flex h-full min-h-[44px] w-11 items-center justify-center rounded-lg bg-navy-700 text-white transition-transform active:scale-95"
      >
        <Check size={22} strokeWidth={3} aria-hidden />
      </button>
    );
  }
  if (guardado) return <CheckCircle2 size={22} className="text-emerald-600" role="img" aria-label="Guardado" />;
  return null;
}

/**
 * Un partido como dos renglones "nombre ↔ su caja": en el celular queda claro qué caja
 * es de quién (antes: nombre, caja, guion, caja, nombre en una línea que se partía).
 */
export function FilaMarcador({ nombreA, nombreB, puntosA, puntosB, ganador, valido, aviso, encabezado, onGuardar }: {
  nombreA: string;
  nombreB: string;
  puntosA: number | null;
  puntosB: number | null;
  ganador: 'A' | 'B' | null;
  valido: boolean;
  /** "empate no vale", etc. (sobre lo guardado). */
  aviso?: string | null;
  encabezado?: ReactNode;
  onGuardar: Guardar;
}) {
  const b = useBorradorMarcador(puntosA, puntosB, onGuardar);
  const lado = (l: 'a' | 'b') => {
    const nombre = l === 'a' ? nombreA : nombreB;
    const gana = !b.sucio && ganador === (l === 'a' ? 'A' : 'B');
    return (
      <label className="flex min-h-[48px] cursor-text items-center gap-3">
        <span className={cn('min-w-0 flex-1 break-words text-[15px] leading-snug', gana ? 'font-bold text-navy-700' : 'font-medium text-gray-700')}>
          {nombre}
        </span>
        <CajaPuntos
          valor={b.mostrado[l]}
          alCambiar={(t) => b.cambiar(l, t)}
          alTeclear={b.alTeclear}
          etiqueta={`Puntos de ${nombre}`}
          gana={gana}
          sinGuardar={b.sucio}
        />
      </label>
    );
  };
  return (
    <div
      onBlur={b.alSalirDeLaFila}
      className={cn(
        'rounded-xl border bg-white px-3 py-2.5 transition-colors',
        b.sucio ? 'border-amber-500 ring-1 ring-amber-500' : 'border-gray-200',
      )}
    >
      {encabezado && <div className="mb-1.5 flex flex-wrap items-center gap-1.5">{encabezado}</div>}
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          {lado('a')}
          {lado('b')}
        </div>
        <div className="flex w-11 shrink-0 items-center justify-center">
          <EstadoGuardado sucio={b.sucio} guardado={valido} alGuardar={() => void b.confirmar()} />
        </div>
      </div>
      {b.sucio && <p className="mt-1.5 text-[13px] font-semibold text-amber-800">Sin guardar: tocá ✓, Enter o salí de la fila.</p>}
      {!b.sucio && aviso && <p className="mt-1.5 text-[13px] font-semibold text-red-700">{aviso}</p>}
    </div>
  );
}

// ─── Pie de cada paso y avisos ───────────────────────────────────────────────

/** Volver a la izquierda, seguir a la derecha; en el celular, seguir arriba y a lo ancho. */
export function PiePaso({ izquierda, derecha }: { izquierda?: ReactNode; derecha?: ReactNode }) {
  return (
    <footer className="mt-6 flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-2 sm:flex-row">{izquierda}</div>
      <div className="flex flex-col gap-2 sm:flex-row">{derecha}</div>
    </footer>
  );
}

/** Aviso ámbar (algo a revisar) o rojo (algo que no vale). */
export function Nota({ children, tono = 'atencion', accion, className }: {
  children: ReactNode;
  tono?: 'atencion' | 'alerta' | 'info';
  accion?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tono === 'info' ? undefined : 'alert'}
      className={cn(
        'flex flex-col gap-3 rounded-lg border px-3.5 py-3 text-sm leading-relaxed sm:flex-row sm:items-center',
        tono === 'atencion' && 'border-amber-200 bg-amber-50 text-amber-900',
        tono === 'alerta' && 'border-red-200 bg-red-50 text-red-800',
        tono === 'info' && 'border-gray-200 bg-gray-50 text-gray-700',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {tono !== 'info' && <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {accion && <div className="shrink-0">{accion}</div>}
    </div>
  );
}
