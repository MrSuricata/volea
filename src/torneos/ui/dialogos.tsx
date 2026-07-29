import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

let contadorId = 0;

// Diálogos propios (in-app), no window.prompt/confirm/alert: los navegadores pueden
// suprimir los diálogos nativos (sobre todo por file://) y dejar la app "muda".
// API basada en promesas: el llamador hace `await confirmar(...)` y sigue.

type OpcionesConfirmar = { titulo?: string; mensaje: string; textoConfirmar?: string; peligro?: boolean };
type OpcionesTexto = { titulo: string; valorInicial?: string; placeholder?: string; textoConfirmar?: string };
type OpcionesAviso = { titulo?: string; mensaje: string };
type OpcionElegible = { clave: string; etiqueta: string; ayuda?: string };
type OpcionesTextoConOpcion = {
  titulo: string;
  valorInicial?: string;
  placeholder?: string;
  textoConfirmar?: string;
  etiquetaOpciones: string;
  opciones: OpcionElegible[]; // al menos una; la primera queda elegida por defecto
};

export type Dialogos = {
  confirmar: (o: OpcionesConfirmar) => Promise<boolean>;
  pedirTexto: (o: OpcionesTexto) => Promise<string | null>;
  avisar: (o: OpcionesAviso) => Promise<void>;
  pedirTextoConOpcion: (o: OpcionesTextoConOpcion) => Promise<{ texto: string; opcion: string } | null>;
  elegirDeLista: (o: { titulo: string; mensaje?: string; opciones: OpcionElegible[]; textoConfirmar?: string }) => Promise<string | null>;
};

type Estado =
  | { kind: 'confirm'; titulo?: string; mensaje: string; textoConfirmar: string; peligro: boolean; resolve: (v: boolean) => void }
  | { kind: 'texto'; titulo: string; valorInicial: string; placeholder?: string; textoConfirmar: string; resolve: (v: string | null) => void }
  | { kind: 'aviso'; titulo?: string; mensaje: string; resolve: () => void }
  | {
      kind: 'textoOpcion';
      titulo: string;
      valorInicial: string;
      placeholder?: string;
      textoConfirmar: string;
      etiquetaOpciones: string;
      opciones: OpcionElegible[];
      resolve: (v: { texto: string; opcion: string } | null) => void;
    }
  | { kind: 'lista'; titulo: string; mensaje?: string; opciones: OpcionElegible[]; textoConfirmar: string; resolve: (v: string | null) => void };

const Ctx = createContext<Dialogos | null>(null);

export function useDialogos(): Dialogos {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDialogos usado fuera de <DialogosProvider>');
  return ctx;
}

export function DialogosProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const pendiente = useRef<Estado | null>(null);

  const api = useMemo<Dialogos>(() => {
    // Si ya había un diálogo abierto, se cancela antes de abrir otro (evita promesas colgadas)
    function cancelarPendiente() {
      const p = pendiente.current;
      if (!p) return;
      if (p.kind === 'confirm') p.resolve(false);
      else if (p.kind === 'texto') p.resolve(null);
      else if (p.kind === 'textoOpcion') p.resolve(null);
      else if (p.kind === 'lista') p.resolve(null);
      else p.resolve();
    }
    function abrir(nuevo: Estado) {
      cancelarPendiente();
      pendiente.current = nuevo;
      setEstado(nuevo);
    }
    return {
      confirmar: (o) =>
        new Promise<boolean>((resolve) =>
          abrir({ kind: 'confirm', titulo: o.titulo, mensaje: o.mensaje, textoConfirmar: o.textoConfirmar ?? 'Sí', peligro: o.peligro ?? false, resolve }),
        ),
      pedirTexto: (o) =>
        new Promise<string | null>((resolve) =>
          abrir({ kind: 'texto', titulo: o.titulo, valorInicial: o.valorInicial ?? '', placeholder: o.placeholder, textoConfirmar: o.textoConfirmar ?? 'Aceptar', resolve }),
        ),
      avisar: (o) => new Promise<void>((resolve) => abrir({ kind: 'aviso', titulo: o.titulo, mensaje: o.mensaje, resolve })),
      pedirTextoConOpcion: (o) =>
        new Promise<{ texto: string; opcion: string } | null>((resolve) =>
          abrir({
            kind: 'textoOpcion',
            titulo: o.titulo,
            valorInicial: o.valorInicial ?? '',
            placeholder: o.placeholder,
            textoConfirmar: o.textoConfirmar ?? 'Aceptar',
            etiquetaOpciones: o.etiquetaOpciones,
            opciones: o.opciones,
            resolve,
          }),
        ),
      elegirDeLista: (o) =>
        new Promise<string | null>((resolve) =>
          abrir({ kind: 'lista', titulo: o.titulo, mensaje: o.mensaje, opciones: o.opciones, textoConfirmar: o.textoConfirmar ?? 'Elegir', resolve }),
        ),
    };
  }, []);

  function cerrarConfirm(estadoActual: Extract<Estado, { kind: 'confirm' }>, valor: boolean) {
    pendiente.current = null;
    estadoActual.resolve(valor);
    setEstado(null);
  }
  function cerrarTexto(estadoActual: Extract<Estado, { kind: 'texto' }>, valor: string | null) {
    pendiente.current = null;
    estadoActual.resolve(valor);
    setEstado(null);
  }
  function cerrarAviso(estadoActual: Extract<Estado, { kind: 'aviso' }>) {
    pendiente.current = null;
    estadoActual.resolve();
    setEstado(null);
  }
  function cerrarTextoOpcion(estadoActual: Extract<Estado, { kind: 'textoOpcion' }>, valor: { texto: string; opcion: string } | null) {
    pendiente.current = null;
    estadoActual.resolve(valor);
    setEstado(null);
  }
  function cerrarLista(estadoActual: Extract<Estado, { kind: 'lista' }>, valor: string | null) {
    pendiente.current = null;
    estadoActual.resolve(valor);
    setEstado(null);
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      {estado?.kind === 'confirm' && (
        <ModalConfirm estado={estado} onResolver={(v) => cerrarConfirm(estado, v)} />
      )}
      {estado?.kind === 'texto' && (
        <ModalTexto key={estado.titulo + estado.valorInicial} estado={estado} onResolver={(v) => cerrarTexto(estado, v)} />
      )}
      {estado?.kind === 'aviso' && <ModalAviso estado={estado} onCerrar={() => cerrarAviso(estado)} />}
      {estado?.kind === 'textoOpcion' && (
        <ModalTextoOpcion key={estado.titulo} estado={estado} onResolver={(v) => cerrarTextoOpcion(estado, v)} />
      )}
      {estado?.kind === 'lista' && (
        <ModalLista key={estado.titulo} estado={estado} onResolver={(v) => cerrarLista(estado, v)} />
      )}
    </Ctx.Provider>
  );
}

function Fondo({ children, onFondo, tituloId, etiqueta }: { children: ReactNode; onFondo: () => void; tituloId?: string; etiqueta?: string }) {
  return (
    <div
      className="modal-fondo"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onFondo(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
      aria-label={tituloId ? undefined : etiqueta}
    >
      <div className="modal">{children}</div>
    </div>
  );
}

function ModalConfirm({ estado, onResolver }: { estado: Extract<Estado, { kind: 'confirm' }>; onResolver: (v: boolean) => void }) {
  const tituloId = useMemo(() => (estado.titulo ? `dlg-${++contadorId}` : undefined), [estado.titulo]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onResolver(false);
      if (e.key === 'Enter') onResolver(true);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onResolver]);
  return (
    <Fondo onFondo={() => onResolver(false)} tituloId={tituloId} etiqueta={estado.mensaje}>
      {estado.titulo && <h3 id={tituloId}>{estado.titulo}</h3>}
      <p className="modal-mensaje">{estado.mensaje}</p>
      <div className="modal-acciones">
        <button className="boton secundario" onClick={() => onResolver(false)}>Cancelar</button>
        <button className={`boton ${estado.peligro ? 'peligro' : ''}`} onClick={() => onResolver(true)} autoFocus>
          {estado.textoConfirmar}
        </button>
      </div>
    </Fondo>
  );
}

function ModalTexto({ estado, onResolver }: { estado: Extract<Estado, { kind: 'texto' }>; onResolver: (v: string | null) => void }) {
  const [valor, setValor] = useState(estado.valorInicial);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onResolver(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onResolver]);
  const tituloId = useMemo(() => `dlg-${++contadorId}`, []);
  function aceptar() {
    const limpio = valor.trim();
    onResolver(limpio ? limpio : null);
  }
  return (
    <Fondo onFondo={() => onResolver(null)} tituloId={tituloId}>
      <h3 id={tituloId}>{estado.titulo}</h3>
      <form onSubmit={(e) => { e.preventDefault(); aceptar(); }}>
        <input
          type="text"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder={estado.placeholder}
          style={{ width: '100%' }}
          autoFocus
        />
        <div className="modal-acciones">
          <button type="button" className="boton secundario" onClick={() => onResolver(null)}>Cancelar</button>
          <button type="submit" className="boton">{estado.textoConfirmar}</button>
        </div>
      </form>
    </Fondo>
  );
}

function ModalAviso({ estado, onCerrar }: { estado: Extract<Estado, { kind: 'aviso' }>; onCerrar: () => void }) {
  const tituloId = useMemo(() => (estado.titulo ? `dlg-${++contadorId}` : undefined), [estado.titulo]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') onCerrar(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCerrar]);
  return (
    <Fondo onFondo={onCerrar} tituloId={tituloId} etiqueta={estado.mensaje}>
      {estado.titulo && <h3 id={tituloId}>{estado.titulo}</h3>}
      <p className="modal-mensaje">{estado.mensaje}</p>
      <div className="modal-acciones">
        <button className="boton" onClick={onCerrar} autoFocus>Entendido</button>
      </div>
    </Fondo>
  );
}

function ModalTextoOpcion({
  estado,
  onResolver,
}: {
  estado: Extract<Estado, { kind: 'textoOpcion' }>;
  onResolver: (v: { texto: string; opcion: string } | null) => void;
}) {
  const [valor, setValor] = useState(estado.valorInicial);
  const [opcion, setOpcion] = useState(estado.opciones[0]?.clave ?? '');
  const tituloId = useMemo(() => `dlg-${++contadorId}`, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onResolver(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onResolver]);
  function aceptar() {
    const limpio = valor.trim();
    if (!limpio) return onResolver(null);
    onResolver({ texto: limpio, opcion });
  }
  return (
    <Fondo onFondo={() => onResolver(null)} tituloId={tituloId}>
      <h3 id={tituloId}>{estado.titulo}</h3>
      <form onSubmit={(e) => { e.preventDefault(); aceptar(); }}>
        <input
          type="text"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder={estado.placeholder}
          style={{ width: '100%' }}
          autoFocus
        />
        <p className="modal-mensaje" style={{ marginTop: 14, marginBottom: 4 }}>{estado.etiquetaOpciones}</p>
        <div className="opciones-clasificacion">
          {estado.opciones.map((o) => (
            <label key={o.clave} className={`opcion-clasificacion ${opcion === o.clave ? 'elegida' : ''}`}>
              <input type="radio" name="opcion-modal" checked={opcion === o.clave} onChange={() => setOpcion(o.clave)} />
              <span>
                <strong>{o.etiqueta}</strong>
                {o.ayuda && <><br /><span style={{ color: 'var(--texto-suave)', fontSize: '0.9rem' }}>{o.ayuda}</span></>}
              </span>
            </label>
          ))}
        </div>
        <div className="modal-acciones">
          <button type="button" className="boton secundario" onClick={() => onResolver(null)}>Cancelar</button>
          <button type="submit" className="boton">{estado.textoConfirmar}</button>
        </div>
      </form>
    </Fondo>
  );
}

function ModalLista({
  estado,
  onResolver,
}: {
  estado: Extract<Estado, { kind: 'lista' }>;
  onResolver: (v: string | null) => void;
}) {
  const [opcion, setOpcion] = useState(estado.opciones[0]?.clave ?? '');
  const tituloId = useMemo(() => `dlg-${++contadorId}`, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onResolver(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onResolver]);
  return (
    <Fondo onFondo={() => onResolver(null)} tituloId={tituloId}>
      <h3 id={tituloId}>{estado.titulo}</h3>
      <form onSubmit={(e) => { e.preventDefault(); if (opcion) onResolver(opcion); }}>
        {estado.mensaje && <p className="modal-mensaje">{estado.mensaje}</p>}
        <div className="opciones-clasificacion">
          {estado.opciones.map((o) => (
            <label key={o.clave} className={`opcion-clasificacion ${opcion === o.clave ? 'elegida' : ''}`}>
              <input type="radio" name="opcion-lista" checked={opcion === o.clave} onChange={() => setOpcion(o.clave)} />
              <span>
                <strong>{o.etiqueta}</strong>
                {o.ayuda && <><br /><span style={{ color: 'var(--texto-suave)', fontSize: '0.9rem' }}>{o.ayuda}</span></>}
              </span>
            </label>
          ))}
        </div>
        <div className="modal-acciones">
          <button type="button" className="boton secundario" onClick={() => onResolver(null)}>Cancelar</button>
          <button type="submit" className="boton">{estado.textoConfirmar}</button>
        </div>
      </form>
    </Fondo>
  );
}
