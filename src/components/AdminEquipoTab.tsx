import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle, Crown, Info, KeyRound, Loader2, Lock, Paintbrush, Pencil,
  RefreshCw, ShieldCheck, Undo2, UserMinus, UserPlus, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { MiembroEquipo, RolAdmin } from '../types';
import { SupabaseService } from '../services/supabaseService';

/** La tabla `admins` guarda los emails en minúscula: comparamos siempre así. */
const normEmail = (e: string) => e.trim().toLowerCase();

/** Chequeo de forma nomás. El filtro serio lo hace Supabase al crear la cuenta. */
const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normEmail(e));

/**
 * Cómo se muestra y qué puede hacer cada rol. Fuente única para los chips, los
 * encabezados de sección, el selector del modal y el panel de ayuda: si mañana
 * cambia lo que puede un rol, se toca acá y queda parejo en toda la pantalla.
 */
type InfoRol = {
  id: RolAdmin;
  chip: string;
  grupo: string;
  corto: string;
  resumen: string;
  puede: string[];
  Icono: LucideIcon;
  claseChip: string;
  claseIcono: string;
};

const ROLES: InfoRol[] = [
  {
    id: 'owner',
    chip: 'Dueño',
    grupo: 'Dueño',
    corto: 'Dueño — todo, incluida esta pantalla',
    resumen: 'Manda en todo y es el único que ve y toca esta pantalla.',
    puede: ['Todo lo del rol Equipo', 'Dar y quitar accesos', 'Cambiarle el rol a los demás'],
    Icono: Crown,
    claseChip: 'bg-navy-700 text-lime-400',
    claseIcono: 'text-navy-700',
  },
  {
    id: 'admin',
    chip: 'Equipo',
    grupo: 'Equipo',
    corto: 'Equipo — todo lo operativo',
    resumen: 'Todo el día a día del negocio, pero no gestiona quién entra al panel.',
    puede: ['Caja, pedidos y stock', 'Torneos, inscripciones y ranking', 'Blog, galería y contenido de la web'],
    Icono: ShieldCheck,
    claseChip: 'bg-lime-400 text-navy-700',
    claseIcono: 'text-lime-600',
  },
  {
    id: 'sublimacion',
    chip: 'Taller',
    grupo: 'Taller (sublimación)',
    corto: 'Taller — solo su pantalla de trabajos',
    resumen: 'Proveedor externo: entra únicamente a su pantalla de trabajos, no ve nada más.',
    puede: ['Ver los trabajos de sublimación', 'Marcar el estado de cada trabajo'],
    Icono: Paintbrush,
    claseChip: 'bg-amber-100 text-amber-800',
    claseIcono: 'text-amber-500',
  },
];

const infoDe = (rol: RolAdmin): InfoRol => ROLES.find(r => r.id === rol) ?? ROLES[1];

type EditorState =
  | { modo: 'alta' }
  | { modo: 'editar'; miembro: MiembroEquipo };

/**
 * Pestaña Equipo (solo la ve el owner): quién entra al panel, con qué rol, y el
 * alta/baja. Las bajas no borran — dejan el registro con `activo: false` para no
 * perder el historial.
 */
export default function AdminEquipoTab({ miEmail }: { miEmail: string }) {
  const [miembros, setMiembros] = useState<MiembroEquipo[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const yo = normEmail(miEmail);

  const cargar = async () => {
    setCargando(true);
    try {
      const data = await SupabaseService.getEquipo();
      // null = no pudimos leer. Nunca mostrar "no hay nadie" por un error de lectura.
      if (data === null) { setFallo(true); return; }
      setFallo(false);
      setMiembros(data);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { void cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const activos = useMemo(() => (miembros ?? []).filter(m => m.activo), [miembros]);
  const inactivos = useMemo(() => (miembros ?? []).filter(m => !m.activo), [miembros]);
  const ownersActivos = activos.filter(m => m.role === 'owner');

  /**
   * Motivo por el que NO se le puede sacar el acceso a alguien (null = se puede).
   * Dos reglas duras: nadie se saca el acceso a sí mismo, y el sistema nunca
   * puede quedarse sin un dueño activo (si no, no hay quien administre esto).
   */
  const bloqueoAcceso = (m: MiembroEquipo): string | null => {
    const esMio = normEmail(m.email) === yo;
    const ultimoDueno = m.activo && m.role === 'owner' && ownersActivos.length <= 1;
    if (esMio && ultimoDueno) {
      return 'Sos vos y además el único dueño activo: si te sacás el acceso, nadie puede volver a entrar a esta pantalla.';
    }
    if (esMio) return 'No podés quitarte el acceso a vos mismo. Te lo tiene que sacar otro dueño.';
    if (ultimoDueno) return 'Es el único dueño activo. Nombrá dueño a otra persona antes de sacarle el acceso.';
    return null;
  };

  const escribir = async (m: MiembroEquipo, exito: string) => {
    if (trabajando !== null) return;
    setTrabajando(normEmail(m.email));
    try {
      const ok = await SupabaseService.saveMiembro(m);
      if (!ok) {
        toast.error('No se pudo guardar. Esta pantalla la maneja solo el dueño — revisá tu sesión.');
        return;
      }
      toast.success(exito);
      setConfirmando(null);
      await cargar();
    } finally {
      setTrabajando(null);
    }
  };

  const quitarAcceso = (m: MiembroEquipo) => {
    // Doble red: la UI ya deshabilita el botón, pero el motivo se revalida al ejecutar.
    const motivo = bloqueoAcceso(m);
    if (motivo !== null) { toast.error(motivo); return; }
    void escribir({ ...m, activo: false }, `${m.name || m.email} quedó sin acceso`);
  };

  const devolverAcceso = (m: MiembroEquipo) => {
    void escribir({ ...m, activo: true }, `${m.name || m.email} vuelve a tener acceso`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold text-navy-700">
          <Users size={22} /> Equipo
        </h2>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void cargar()}
            disabled={cargando}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-navy-700 transition-colors hover:border-navy-700 disabled:opacity-50"
          >
            <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /> Actualizar
          </button>
          <button
            onClick={() => setEditor({ modo: 'alta' })}
            disabled={miembros === null}
            title={miembros === null ? 'Esperá a que cargue la lista para no dar de alta a alguien repetido.' : undefined}
            className="inline-flex items-center gap-2 rounded-lg bg-lime-400 px-4 py-1.5 font-display text-sm font-bold text-navy-700 transition-colors hover:bg-lime-500 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
          >
            <UserPlus size={16} /> Dar acceso
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-500">
        Quién entra al panel de VOLEA y con qué permisos. Los cambios de acá corren al toque.
      </p>

      <PanelRoles />

      {miembros !== null && ownersActivos.length === 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            <b className="font-display">No queda ningún dueño activo.</b> Nadie puede dar ni quitar accesos
            desde acá: hay que arreglarlo a mano en Supabase, en la tabla <code>admins</code>.
          </span>
        </div>
      )}

      {fallo && !cargando && (
        <div className="rounded-xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <AlertCircle size={40} strokeWidth={1} className="mx-auto mb-3 text-gray-300" />
          <p className="font-display font-bold text-gray-500">No se pudo leer el equipo</p>
          <p className="mt-1 text-xs text-gray-400">
            Puede ser la sesión vencida.
            {miembros !== null && ' Lo de abajo es lo último que sí pudimos leer, puede estar viejo.'}
          </p>
          <button
            onClick={() => void cargar()}
            className="mt-2 text-sm font-semibold text-lime-600 hover:underline"
          >
            Reintentar
          </button>
        </div>
      )}

      {cargando && miembros === null && !fallo && (
        <div className="rounded-xl border border-gray-100 bg-white p-10 text-center shadow-sm">
          <Loader2 size={28} strokeWidth={1.5} className="mx-auto mb-2 animate-spin text-gray-300" />
          <p className="font-display text-sm font-bold text-gray-500">Cargando el equipo…</p>
        </div>
      )}

      {miembros !== null && miembros.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <p className="font-display text-sm font-bold text-gray-500">Todavía no hay nadie cargado</p>
          <p className="mt-1 text-xs text-gray-400">Dale a «Dar acceso» para sumar a la primera persona.</p>
        </div>
      )}

      {miembros !== null && miembros.length > 0 && (
        <div className="space-y-5">
          {ROLES.map(r => {
            const gente = activos.filter(m => m.role === r.id);
            const { Icono } = r;
            return (
              <section key={r.id}>
                <h3 className="mb-2 flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wide text-gray-400">
                  <Icono size={14} className={r.claseIcono} /> {r.grupo}
                  <span className="rounded-full bg-gray-100 px-1.5 text-[11px] font-bold text-gray-500">
                    {gente.length}
                  </span>
                </h3>
                {gente.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-400">
                    Nadie con este rol por ahora.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {gente.map(m => (
                      <FilaMiembro
                        key={m.email}
                        miembro={m}
                        soyYo={normEmail(m.email) === yo}
                        bloqueo={bloqueoAcceso(m)}
                        confirmando={confirmando === normEmail(m.email)}
                        trabajando={trabajando === normEmail(m.email)}
                        onEditar={() => setEditor({ modo: 'editar', miembro: m })}
                        onConfirmar={v => setConfirmando(v ? normEmail(m.email) : null)}
                        onQuitar={() => quitarAcceso(m)}
                        onDevolver={() => devolverAcceso(m)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          {inactivos.length > 0 && (
            <section>
              <h3 className="mb-1 flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wide text-gray-400">
                <Lock size={14} className="text-gray-300" /> Sin acceso
                <span className="rounded-full bg-gray-100 px-1.5 text-[11px] font-bold text-gray-500">
                  {inactivos.length}
                </span>
              </h3>
              <p className="mb-2 text-xs text-gray-400">
                No los borramos: quedan guardados para no perder el historial. Podés devolverles el acceso cuando quieras.
              </p>
              <div className="space-y-2">
                {inactivos.map(m => (
                  <FilaMiembro
                    key={m.email}
                    miembro={m}
                    soyYo={normEmail(m.email) === yo}
                    bloqueo={null}
                    confirmando={false}
                    trabajando={trabajando === normEmail(m.email)}
                    onEditar={() => setEditor({ modo: 'editar', miembro: m })}
                    onConfirmar={() => undefined}
                    onQuitar={() => quitarAcceso(m)}
                    onDevolver={() => devolverAcceso(m)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {editor !== null && (
        <EditorMiembroModal
          estado={editor}
          equipo={miembros ?? []}
          miEmail={miEmail}
          onCerrar={() => setEditor(null)}
          onGuardado={() => { setEditor(null); void cargar(); }}
        />
      )}
    </div>
  );
}

// ─── Ayuda de roles ──────────────────────────────────────────────────────────

/** Panel fijo con qué puede hacer cada rol: es para consultar antes de asignar. */
function PanelRoles() {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-bold text-navy-700">
        <Info size={16} className="text-lime-600" /> Qué puede hacer cada rol
      </h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {ROLES.map(r => {
          const { Icono } = r;
          return (
            <div key={r.id} className="rounded-lg border border-gray-100 p-3">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${r.claseChip}`}>
                <Icono size={11} /> {r.chip}
              </span>
              <p className="mt-2 text-xs text-gray-500">{r.resumen}</p>
              <ul className="mt-2 space-y-1">
                {r.puede.map(p => (
                  <li key={p} className="flex items-start gap-1.5 text-xs text-navy-700">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime-400" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-3 flex items-start gap-2 rounded-lg bg-navy-50 p-2.5 text-xs text-navy-700">
        <KeyRound size={14} className="mt-0.5 shrink-0 text-navy-400" />
        <span>
          <b className="font-display">Dar acceso acá no crea la cuenta.</b> Esta pantalla guarda el permiso y el rol.
          La cuenta con contraseña se crea aparte, en Supabase → Authentication → Users, con el mismo email.
        </span>
      </p>
    </div>
  );
}

// ─── Fila ────────────────────────────────────────────────────────────────────

function FilaMiembro({
  miembro, soyYo, bloqueo, confirmando, trabajando,
  onEditar, onConfirmar, onQuitar, onDevolver,
}: {
  miembro: MiembroEquipo;
  soyYo: boolean;
  /** Motivo por el que no se le puede sacar el acceso, o null si sí se puede. */
  bloqueo: string | null;
  confirmando: boolean;
  trabajando: boolean;
  onEditar: () => void;
  onConfirmar: (abrir: boolean) => void;
  onQuitar: () => void;
  onDevolver: () => void;
}) {
  const info = infoDe(miembro.role);
  const { Icono } = info;

  return (
    <div className={`rounded-xl border border-gray-100 bg-white p-3 shadow-sm ${miembro.activo ? '' : 'opacity-70'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${
          miembro.activo ? 'bg-navy-700/10 text-navy-700' : 'bg-gray-100 text-gray-400'
        }`}>
          {(miembro.name || miembro.email).charAt(0).toUpperCase()}
        </span>

        <div className="min-w-0 flex-1">
          <p className={`flex items-center gap-1.5 truncate font-display text-sm font-bold ${
            miembro.activo ? 'text-navy-700' : 'text-gray-400'
          }`}>
            {miembro.name || <span className="italic text-gray-400">sin nombre</span>}
            {soyYo && (
              <span className="rounded-full bg-navy-700/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-navy-700">
                vos
              </span>
            )}
          </p>
          <p className="truncate text-xs text-gray-500">{miembro.email}</p>
        </div>

        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
            miembro.activo ? info.claseChip : 'bg-gray-100 text-gray-400'
          }`}>
            <Icono size={11} /> {info.chip}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
            miembro.activo ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {miembro.activo ? 'activo' : 'sin acceso'}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {trabajando ? (
            <Loader2 size={18} className="animate-spin text-gray-300" />
          ) : confirmando ? (
            <>
              <span className="text-xs font-semibold text-gray-500">¿Le sacamos el acceso?</span>
              <button
                onClick={onQuitar}
                className="rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-red-600"
              >
                Sí, quitar
              </button>
              <button
                onClick={() => onConfirmar(false)}
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-500 transition-colors hover:border-gray-400"
              >
                No
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onEditar}
                title="Cambiar el nombre o el rol"
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-navy-700 transition-colors hover:border-navy-700"
              >
                <Pencil size={13} /> Editar
              </button>

              {!miembro.activo ? (
                <button
                  onClick={onDevolver}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-lime-400 bg-lime-50 px-2.5 py-1.5 text-xs font-bold text-navy-700 transition-colors hover:bg-lime-100"
                >
                  <Undo2 size={13} /> Devolver acceso
                </button>
              ) : bloqueo !== null ? (
                // Un <span> y no un <button disabled>: sobre un botón deshabilitado el
                // navegador no muestra el title, y acá el motivo es lo importante.
                <span
                  title={bloqueo}
                  aria-disabled="true"
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-100 px-2.5 py-1.5 text-xs font-semibold text-gray-300"
                >
                  <Lock size={13} /> Quitar acceso
                </span>
              ) : (
                <button
                  onClick={() => onConfirmar(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50"
                >
                  <UserMinus size={13} /> Quitar acceso
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {miembro.activo && bloqueo !== null && (
        <p className="mt-2 flex items-start gap-1.5 border-t border-gray-100 pt-2 text-[11px] text-gray-400">
          <Lock size={11} className="mt-0.5 shrink-0" /> {bloqueo}
        </p>
      )}
    </div>
  );
}

// ─── Alta / edición ──────────────────────────────────────────────────────────

function EditorMiembroModal({ estado, equipo, miEmail, onCerrar, onGuardado }: {
  estado: EditorState;
  equipo: MiembroEquipo[];
  miEmail: string;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const editando = estado.modo === 'editar' ? estado.miembro : null;
  const [nombre, setNombre] = useState(editando?.name ?? '');
  const [email, setEmail] = useState(editando?.email ?? '');
  const [rol, setRol] = useState<RolAdmin>(editando?.role ?? 'admin');
  const [guardando, setGuardando] = useState(false);

  const ownersActivos = equipo.filter(m => m.activo && m.role === 'owner');
  // Bajarle el rol al último dueño activo dejaría el panel sin nadie que lo administre.
  const esUltimoDueno = editando !== null && editando.activo && editando.role === 'owner'
    && ownersActivos.length <= 1;

  // En el alta, el email es la clave: si ya existe hay que editar o reactivar, no crear.
  const yaExiste = editando === null
    ? equipo.find(m => normEmail(m.email) === normEmail(email)) ?? null
    : null;

  const soyYo = editando !== null && normEmail(editando.email) === normEmail(miEmail);
  const meBajoElRol = editando !== null && soyYo && editando.role === 'owner' && rol !== 'owner';

  const nombreOk = nombre.trim().length >= 2;
  const emailOk = emailValido(email);
  const rolProhibido = esUltimoDueno && rol !== 'owner';
  const puedeGuardar = nombreOk && emailOk && yaExiste === null && !rolProhibido && !guardando;

  const guardar = async () => {
    if (!puedeGuardar) return;
    setGuardando(true);
    try {
      const nuevo: MiembroEquipo = {
        email: normEmail(email),
        name: nombre.trim(),
        role: rol,
        // Editar no reactiva: para eso está «Devolver acceso» en la lista.
        activo: editando !== null ? editando.activo : true,
      };
      const ok = await SupabaseService.saveMiembro(nuevo);
      if (!ok) {
        toast.error('No se pudo guardar. Esta pantalla la maneja solo el dueño — revisá tu sesión.');
        return;
      }
      if (editando !== null) {
        toast.success(`${nuevo.name} actualizado ✓`);
      } else {
        toast.success(`${nuevo.name} ya figura en el equipo ✓`);
        toast.info('Ojo: falta crearle la cuenta', {
          description: `${nuevo.email} todavía no puede entrar. Acá guardamos el permiso y el rol; la cuenta con contraseña se crea en Supabase → Authentication → Users, con ese mismo email.`,
          duration: 12000,
        });
      }
      onGuardado();
    } finally {
      setGuardando(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => !guardando && onCerrar()} />
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h3 className="font-display text-lg font-bold text-navy-700">
            {editando !== null ? 'Editar miembro' : 'Dar acceso al panel'}
          </h3>
          <button onClick={onCerrar} aria-label="Cerrar" className="text-gray-400 hover:text-navy-700">✕</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div>
            <label htmlFor="equipo-nombre" className="mb-1 block font-display text-xs font-semibold uppercase text-gray-500">
              Nombre
            </label>
            <input
              id="equipo-nombre"
              type="text"
              value={nombre}
              autoFocus
              onChange={e => setNombre(e.target.value)}
              placeholder="Pauli"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-lime-400"
            />
            <p className="mt-1 text-[11px] text-gray-400">Es el nombre con el que la vas a ver en el panel.</p>
          </div>

          <div>
            <label htmlFor="equipo-email" className="mb-1 block font-display text-xs font-semibold uppercase text-gray-500">
              Email
            </label>
            <input
              id="equipo-email"
              type="email"
              value={email}
              disabled={editando !== null}
              onChange={e => setEmail(e.target.value)}
              placeholder="pauli@volea.uy"
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none ${
                editando !== null
                  ? 'border-gray-100 bg-gray-50 text-gray-400'
                  : email.trim() !== '' && !emailOk
                    ? 'border-red-300'
                    : 'border-gray-200 focus:border-lime-400'
              }`}
            />
            {editando !== null && (
              <p className="mt-1 text-[11px] text-gray-400">
                El email no se cambia: es la llave del acceso. Si está mal escrito, sacale el acceso a este y
                dá de alta el correcto.
              </p>
            )}
            {editando === null && email.trim() !== '' && !emailOk && (
              <p className="mt-1 text-xs text-red-500">Eso no tiene forma de email.</p>
            )}
            {yaExiste !== null && (
              <p className="mt-1 text-xs text-amber-600">
                Ese email ya está en la lista ({yaExiste.name || 'sin nombre'}
                {yaExiste.activo ? '' : ', sin acceso'}).{' '}
                {yaExiste.activo
                  ? 'Editalo desde la lista en vez de darlo de alta de nuevo.'
                  : 'Cerrá esto y usá «Devolver acceso».'}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="equipo-rol" className="mb-1 block font-display text-xs font-semibold uppercase text-gray-500">
              Rol
            </label>
            <select
              id="equipo-rol"
              value={rol}
              onChange={e => setRol(e.target.value as RolAdmin)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-navy-700 outline-none focus:border-lime-400"
            >
              {ROLES.map(r => (
                <option key={r.id} value={r.id} disabled={esUltimoDueno && r.id !== 'owner'}>
                  {r.corto}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">{infoDe(rol).resumen}</p>

            {esUltimoDueno && (
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
                <Lock size={14} className="mt-0.5 shrink-0" />
                <span>
                  Es el único dueño activo, así que el rol queda trabado en Dueño: si se lo bajás, el sistema
                  se queda sin nadie que pueda administrar accesos. Nombrá dueño a otra persona primero.
                </span>
              </p>
            )}
            {meBajoElRol && !esUltimoDueno && (
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>Sos vos: si te bajás de Dueño, perdés esta pantalla y te lo tiene que devolver otro dueño.</span>
              </p>
            )}
          </div>

          {editando === null && (
            <div className="flex items-start gap-2 rounded-lg bg-navy-50 p-3 text-xs text-navy-700">
              <KeyRound size={14} className="mt-0.5 shrink-0 text-navy-400" />
              <span>
                <b className="font-display">Esto es solo el permiso.</b> Para que pueda entrar de verdad, la cuenta
                con contraseña se crea aparte, en Supabase → Authentication → Users, con este mismo email.
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-gray-200 p-4">
          <button
            onClick={onCerrar}
            disabled={guardando}
            className="rounded-lg border border-gray-200 px-4 py-2.5 font-display text-sm font-bold text-gray-500 transition-colors hover:border-gray-400 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => void guardar()}
            disabled={!puedeGuardar}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-lime-400 py-2.5 font-display text-sm font-bold text-navy-700 transition-colors hover:bg-lime-500 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
          >
            {guardando ? (
              <><Loader2 size={16} className="animate-spin" /> Guardando…</>
            ) : editando !== null ? (
              <><Pencil size={15} /> Guardar cambios</>
            ) : (
              <><UserPlus size={16} /> Dar acceso</>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
