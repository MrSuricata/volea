import { createContext, useContext, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Boton, Dialogo, Entrada } from '../../admin/ui';
import { cn } from '../../lib/cn';
import { normalizar } from '../../utils/nombres';

// Diálogos propios (in-app), no window.prompt/confirm/alert: los navegadores pueden
// suprimir los diálogos nativos (sobre todo por file://) y dejar la app "muda".
// API basada en promesas: el llamador hace `await confirmar(...)` y sigue.
//
// Desde el rediseño del admin (24/09) se dibujan con el Dialogo del kit: portal a
// <body> (el .fade-in del panel deja un transform que corría los `fixed`), Escape,
// foco adentro y botones fijos abajo en el celular (con el teclado abierto seguían
// quedando a mano). La API no cambió.

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
type OpcionesLista = {
  titulo: string;
  mensaje?: string;
  opciones: OpcionElegible[];
  textoConfirmar?: string;
  /** Nada elegido de entrada: para acciones sin vuelta atrás (unir jugadores) un Enter apurado no elige al primero. */
  sinPreseleccion?: boolean;
  /** Buscador arriba de la lista (padrones largos). */
  buscador?: boolean;
  /** Botón en rojo (la acción no se puede deshacer). */
  peligro?: boolean;
};

export type Dialogos = {
  confirmar: (o: OpcionesConfirmar) => Promise<boolean>;
  pedirTexto: (o: OpcionesTexto) => Promise<string | null>;
  avisar: (o: OpcionesAviso) => Promise<void>;
  pedirTextoConOpcion: (o: OpcionesTextoConOpcion) => Promise<{ texto: string; opcion: string } | null>;
  elegirDeLista: (o: OpcionesLista) => Promise<string | null>;
};

// `n`: número de apertura. Es la key del modal: dos diálogos seguidos con el mismo título
// (la reconciliación pregunta "Vincular jugador" varias veces) se remontan limpios en vez
// de heredar la opción elegida en el anterior.
type Estado =
  | { n: number; kind: 'confirm'; titulo?: string; mensaje: string; textoConfirmar: string; peligro: boolean; resolve: (v: boolean) => void }
  | { n: number; kind: 'texto'; titulo: string; valorInicial: string; placeholder?: string; textoConfirmar: string; resolve: (v: string | null) => void }
  | { n: number; kind: 'aviso'; titulo?: string; mensaje: string; resolve: () => void }
  | {
      n: number;
      kind: 'textoOpcion';
      titulo: string;
      valorInicial: string;
      placeholder?: string;
      textoConfirmar: string;
      etiquetaOpciones: string;
      opciones: OpcionElegible[];
      resolve: (v: { texto: string; opcion: string } | null) => void;
    }
  | ({ n: number; kind: 'lista'; textoConfirmar: string; resolve: (v: string | null) => void } & Omit<OpcionesLista, 'textoConfirmar'>);

const Ctx = createContext<Dialogos | null>(null);

export function useDialogos(): Dialogos {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDialogos usado fuera de <DialogosProvider>');
  return ctx;
}

export function DialogosProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const pendiente = useRef<Estado | null>(null);
  const aperturas = useRef(0);

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
    const n = () => ++aperturas.current;
    return {
      confirmar: (o) =>
        new Promise<boolean>((resolve) =>
          abrir({ n: n(), kind: 'confirm', titulo: o.titulo, mensaje: o.mensaje, textoConfirmar: o.textoConfirmar ?? 'Sí', peligro: o.peligro ?? false, resolve }),
        ),
      pedirTexto: (o) =>
        new Promise<string | null>((resolve) =>
          abrir({ n: n(), kind: 'texto', titulo: o.titulo, valorInicial: o.valorInicial ?? '', placeholder: o.placeholder, textoConfirmar: o.textoConfirmar ?? 'Aceptar', resolve }),
        ),
      avisar: (o) => new Promise<void>((resolve) => abrir({ n: n(), kind: 'aviso', titulo: o.titulo, mensaje: o.mensaje, resolve })),
      pedirTextoConOpcion: (o) =>
        new Promise<{ texto: string; opcion: string } | null>((resolve) =>
          abrir({
            n: n(),
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
          abrir({ ...o, n: n(), kind: 'lista', textoConfirmar: o.textoConfirmar ?? 'Elegir', resolve }),
        ),
    };
  }, []);

  // Cierra el modal actual con su valor. Cada rama llama a su propio resolve (tipado por kind).
  function cerrar<E extends Estado>(estadoActual: E, resolver: () => void) {
    if (pendiente.current === estadoActual) pendiente.current = null;
    resolver();
    setEstado((e) => (e === estadoActual ? null : e));
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      {estado?.kind === 'confirm' && (
        <ModalConfirm key={estado.n} estado={estado} onResolver={(v) => cerrar(estado, () => estado.resolve(v))} />
      )}
      {estado?.kind === 'texto' && (
        <ModalTexto key={estado.n} estado={estado} onResolver={(v) => cerrar(estado, () => estado.resolve(v))} />
      )}
      {estado?.kind === 'aviso' && <ModalAviso key={estado.n} estado={estado} onCerrar={() => cerrar(estado, () => estado.resolve())} />}
      {estado?.kind === 'textoOpcion' && (
        <ModalTextoOpcion key={estado.n} estado={estado} onResolver={(v) => cerrar(estado, () => estado.resolve(v))} />
      )}
      {estado?.kind === 'lista' && (
        <ModalLista key={estado.n} estado={estado} onResolver={(v) => cerrar(estado, () => estado.resolve(v))} />
      )}
    </Ctx.Provider>
  );
}

function Mensaje({ children }: { children: ReactNode }) {
  return <p className="whitespace-pre-line text-[15px] leading-relaxed text-gray-700">{children}</p>;
}

function ModalConfirm({ estado, onResolver }: { estado: Extract<Estado, { kind: 'confirm' }>; onResolver: (v: boolean) => void }) {
  return (
    <Dialogo
      abierto
      titulo={estado.titulo ?? 'Confirmar'}
      alCerrar={() => onResolver(false)}
      ancho="sm"
      pie={(
        <>
          <Boton variante="secundario" onClick={() => onResolver(false)}>Cancelar</Boton>
          {/* data-autofoco: Enter confirma, como antes (el foco arranca en este botón). */}
          <Boton variante={estado.peligro ? 'peligro' : 'primario'} onClick={() => onResolver(true)} data-autofoco>
            {estado.textoConfirmar}
          </Boton>
        </>
      )}
    >
      <Mensaje>{estado.mensaje}</Mensaje>
    </Dialogo>
  );
}

function ModalTexto({ estado, onResolver }: { estado: Extract<Estado, { kind: 'texto' }>; onResolver: (v: string | null) => void }) {
  const [valor, setValor] = useState(estado.valorInicial);
  const idForm = useId();
  function aceptar() {
    const limpio = valor.trim();
    onResolver(limpio ? limpio : null);
  }
  return (
    <Dialogo
      abierto
      titulo={estado.titulo}
      alCerrar={() => onResolver(null)}
      ancho="sm"
      pie={(
        <>
          <Boton variante="secundario" onClick={() => onResolver(null)}>Cancelar</Boton>
          <Boton type="submit" form={idForm}>{estado.textoConfirmar}</Boton>
        </>
      )}
    >
      <form id={idForm} onSubmit={(e) => { e.preventDefault(); aceptar(); }}>
        <Entrada
          type="text"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder={estado.placeholder}
          aria-label={estado.placeholder ?? estado.titulo}
          autoComplete="off"
        />
      </form>
    </Dialogo>
  );
}

function ModalAviso({ estado, onCerrar }: { estado: Extract<Estado, { kind: 'aviso' }>; onCerrar: () => void }) {
  return (
    <Dialogo
      abierto
      titulo={estado.titulo ?? 'Aviso'}
      alCerrar={onCerrar}
      ancho="sm"
      pie={<Boton onClick={onCerrar} data-autofoco>Entendido</Boton>}
    >
      <Mensaje>{estado.mensaje}</Mensaje>
    </Dialogo>
  );
}

/** Opciones tipo tarjeta con radio (formato del torneo, categoría, a quién vincular…). */
function OpcionesRadio({ nombre, opciones, elegida, alElegir, etiqueta }: {
  nombre: string;
  opciones: OpcionElegible[];
  elegida: string;
  alElegir: (clave: string) => void;
  etiqueta: string;
}) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="grid gap-2">
      {opciones.map((o) => {
        const activa = elegida === o.clave;
        return (
          <label
            key={o.clave}
            className={cn(
              'flex min-h-[52px] cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors',
              activa ? 'border-navy-700 bg-navy-50 ring-1 ring-inset ring-navy-700' : 'border-gray-300 bg-white hover:border-navy-700',
            )}
          >
            <input
              type="radio"
              name={nombre}
              checked={activa}
              onChange={() => alElegir(o.clave)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-navy-700"
            />
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold leading-snug text-navy-700">{o.etiqueta}</span>
              {o.ayuda && <span className="mt-0.5 block text-[13px] text-gray-500">{o.ayuda}</span>}
            </span>
          </label>
        );
      })}
    </div>
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
  const idForm = useId();
  const idNombre = useId();
  function aceptar() {
    const limpio = valor.trim();
    if (!limpio) return onResolver(null);
    onResolver({ texto: limpio, opcion });
  }
  return (
    <Dialogo
      abierto
      titulo={estado.titulo}
      alCerrar={() => onResolver(null)}
      pie={(
        <>
          <Boton variante="secundario" onClick={() => onResolver(null)}>Cancelar</Boton>
          <Boton type="submit" form={idForm}>{estado.textoConfirmar}</Boton>
        </>
      )}
    >
      <form id={idForm} onSubmit={(e) => { e.preventDefault(); aceptar(); }} className="space-y-4">
        <div>
          <label htmlFor={idNombre} className="mb-1.5 block text-[13px] font-semibold text-navy-700">Nombre</label>
          <Entrada
            id={idNombre}
            type="text"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder={estado.placeholder}
            autoComplete="off"
          />
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-navy-700">{estado.etiquetaOpciones}</p>
          <OpcionesRadio nombre={`${idForm}-op`} opciones={estado.opciones} elegida={opcion} alElegir={setOpcion} etiqueta={estado.etiquetaOpciones} />
        </div>
      </form>
    </Dialogo>
  );
}

function ModalLista({
  estado,
  onResolver,
}: {
  estado: Extract<Estado, { kind: 'lista' }>;
  onResolver: (v: string | null) => void;
}) {
  const [opcion, setOpcion] = useState(estado.sinPreseleccion ? '' : (estado.opciones[0]?.clave ?? ''));
  const [busqueda, setBusqueda] = useState('');
  const idForm = useId();
  const q = normalizar(busqueda);
  const visibles = q === ''
    ? estado.opciones
    : estado.opciones.filter((o) => normalizar(o.etiqueta).includes(q) || (o.ayuda ? normalizar(o.ayuda).includes(q) : false));
  return (
    <Dialogo
      abierto
      titulo={estado.titulo}
      descripcion={estado.mensaje}
      alCerrar={() => onResolver(null)}
      pie={(
        <>
          <Boton variante="secundario" onClick={() => onResolver(null)}>Cancelar</Boton>
          <Boton type="submit" form={idForm} variante={estado.peligro ? 'peligro' : 'primario'} disabled={!opcion}>
            {estado.textoConfirmar}
          </Boton>
        </>
      )}
    >
      <form id={idForm} onSubmit={(e) => { e.preventDefault(); if (opcion) onResolver(opcion); }} className="space-y-3">
        {estado.buscador && (
          <div className="relative">
            <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
            <Entrada
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar…"
              aria-label="Buscar en la lista"
              autoComplete="off"
              className="pl-10"
            />
          </div>
        )}
        {visibles.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">Nadie coincide con «{busqueda.trim()}».</p>
        ) : (
          <OpcionesRadio nombre={`${idForm}-op`} opciones={visibles} elegida={opcion} alElegir={setOpcion} etiqueta={estado.titulo} />
        )}
      </form>
    </Dialogo>
  );
}
