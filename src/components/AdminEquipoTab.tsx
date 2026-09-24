import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Crown, Info, KeyRound, Loader2, Lock, Paintbrush, Pencil,
  RefreshCw, ShieldCheck, Undo2, UserMinus, UserPlus, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { MiembroEquipo, RolAdmin } from '../types';
import { SupabaseService } from '../services/supabaseService';
import {
  Boton, Campo, CargandoFilas, Dialogo, EncabezadoPagina, Entrada, ErrorEstado, Insignia,
  Selector, Tarjeta, Vacio, type TonoInsignia,
} from '../admin/ui';
import { cn } from '../lib/cn';

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
  /** Tono de la Insignia del rol (clases fijas del kit, nada armado a mano). */
  tono: TonoInsignia;
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
    tono: 'navy',
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
    tono: 'info',
    claseIcono: 'text-sky-600',
  },
  {
    id: 'sublimacion',
    chip: 'Taller',
    grupo: 'Taller (sublimación)',
    corto: 'Taller — solo su pantalla de trabajos',
    resumen: 'Proveedor externo: entra únicamente a su pantalla de trabajos, no ve nada más.',
    puede: ['Ver los trabajos de sublimación', 'Marcar el estado de cada trabajo'],
    Icono: Paintbrush,
    tono: 'atencion',
    claseIcono: 'text-amber-600',
  },
];

const infoDe = (rol: RolAdmin): InfoRol => ROLES.find(r => r.id === rol) ?? ROLES[1];

type EditorState =
  | { modo: 'alta' }
  | { modo: 'editar'; miembro: MiembroEquipo };

/**
 * Pestaña Equipo → Accesos (solo la ve el owner): quién entra al panel, con qué
 * rol, y el alta/baja. Las bajas no borran — dejan el registro con
 * `activo: false` para no perder el historial.
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
    <div>
      <EncabezadoPagina
        rotulo="Equipo"
        titulo="Accesos"
        descripcion="Quién entra al panel de VOLEA y con qué permisos. Los cambios de acá corren al toque."
        acciones={(
          <>
            <Boton
              variante="secundario"
              onClick={() => void cargar()}
              disabled={cargando}
              icono={<RefreshCw size={16} className={cargando ? 'animate-spin' : undefined} />}
            >
              Actualizar
            </Boton>
            <Boton
              onClick={() => setEditor({ modo: 'alta' })}
              disabled={miembros === null}
              title={miembros === null ? 'Esperá a que cargue la lista para no dar de alta a alguien repetido.' : undefined}
              icono={<UserPlus size={17} />}
            >
              Dar acceso
            </Boton>
          </>
        )}
      />

      <div className="space-y-5">
        {miembros !== null && ownersActivos.length === 0 && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>
              <b className="font-display">No queda ningún dueño activo.</b> Nadie puede dar ni quitar accesos
              desde acá: hay que arreglarlo a mano en Supabase, en la tabla <code>admins</code>.
            </span>
          </div>
        )}

        {fallo && !cargando && (
          <ErrorEstado
            mensaje={`No se pudo leer el equipo. Puede ser la sesión vencida.${
              miembros !== null ? ' Lo de abajo es lo último que sí pudimos leer: puede estar viejo.' : ''
            }`}
            alReintentar={() => void cargar()}
          />
        )}

        {cargando && miembros === null && !fallo && <CargandoFilas filas={3} />}

        {miembros !== null && miembros.length === 0 && (
          <Vacio
            icono={<Users size={22} />}
            titulo="Todavía no hay nadie cargado"
            descripcion="Sumá a la primera persona que va a entrar al panel."
            accion={<Boton onClick={() => setEditor({ modo: 'alta' })} icono={<UserPlus size={17} />}>Dar acceso</Boton>}
          />
        )}

        {miembros !== null && miembros.length > 0 && (
          <>
            {ROLES.map(r => {
              const gente = activos.filter(m => m.role === r.id);
              const { Icono } = r;
              return (
                <section key={r.id} aria-label={r.grupo}>
                  <h2 className="mb-2 flex items-center gap-2 px-1 font-display text-sm font-bold uppercase tracking-wide text-navy-700">
                    <Icono size={15} className={r.claseIcono} /> {r.grupo}
                    <Insignia tono="neutro" className="tabular-nums">{gente.length}</Insignia>
                  </h2>
                  {gente.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-gray-300 px-4 py-4 text-[13px] text-gray-500">
                      Nadie con este rol por ahora.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {gente.map(m => (
                        <li key={m.email}>
                          <FilaMiembro
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
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}

            {inactivos.length > 0 && (
              <section aria-label="Sin acceso">
                <h2 className="mb-1 flex items-center gap-2 px-1 font-display text-sm font-bold uppercase tracking-wide text-gray-500">
                  <Lock size={15} className="text-gray-400" /> Sin acceso
                  <Insignia tono="neutro" className="tabular-nums">{inactivos.length}</Insignia>
                </h2>
                <p className="mb-2 px-1 text-[13px] text-gray-500">
                  No los borramos: quedan guardados para no perder el historial. Podés devolverles el acceso cuando quieras.
                </p>
                <ul className="space-y-2">
                  {inactivos.map(m => (
                    <li key={m.email}>
                      <FilaMiembro
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
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {/* La ayuda va después de la lista: lo que se viene a hacer acá es mirar y
            tocar a la gente; esto se consulta antes de asignar un rol. */}
        <PanelRoles />
      </div>

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
    <Tarjeta
      titulo={<span className="inline-flex items-center gap-2"><Info size={16} className="text-navy-400" /> Qué puede hacer cada rol</span>}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {ROLES.map(r => {
          const { Icono } = r;
          return (
            <div key={r.id} className="rounded-lg border border-gray-200 p-3">
              <Insignia tono={r.tono}><Icono size={12} /> {r.chip}</Insignia>
              <p className="mt-2 text-[13px] text-gray-600">{r.resumen}</p>
              <ul className="mt-2 space-y-1">
                {r.puede.map(p => (
                  <li key={p} className="flex items-start gap-2 text-[13px] text-navy-700">
                    <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-navy-400" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-3 flex items-start gap-2 rounded-lg bg-navy-50 p-3 text-[13px] text-navy-700">
        <KeyRound size={15} className="mt-0.5 shrink-0 text-navy-400" />
        <span>
          <b className="font-display">Dar acceso acá no crea la cuenta.</b> Esta pantalla guarda el permiso y el rol.
          La cuenta con contraseña se crea aparte, en Supabase → Authentication → Users, con el mismo email.
        </span>
      </p>
    </Tarjeta>
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
    <div className={cn('rounded-xl border border-gray-200 bg-white p-3 sm:p-4', !miembro.activo && 'bg-gray-50')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            aria-hidden
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold',
              miembro.activo ? 'bg-navy-700 text-white' : 'bg-gray-200 text-gray-500',
            )}
          >
            {(miembro.name || miembro.email).charAt(0).toUpperCase()}
          </span>

          <div className="min-w-0 flex-1">
            <p className={cn(
              'flex flex-wrap items-center gap-x-2 gap-y-1 font-display text-[15px] font-bold',
              miembro.activo ? 'text-navy-700' : 'text-gray-500',
            )}>
              <span className="min-w-0 truncate">
                {miembro.name || <span className="font-normal italic text-gray-400">sin nombre</span>}
              </span>
              {soyYo && <Insignia tono="navy">vos</Insignia>}
              <Insignia tono={miembro.activo ? info.tono : 'neutro'}><Icono size={12} /> {info.chip}</Insignia>
              {!miembro.activo && <Insignia tono="neutro">sin acceso</Insignia>}
            </p>
            <p className="truncate text-[13px] text-gray-500">{miembro.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:shrink-0 sm:justify-end">
          {trabajando ? (
            <span className="inline-flex h-11 items-center gap-2 px-2 text-[13px] text-gray-500">
              <Loader2 size={17} className="animate-spin" /> Guardando…
            </span>
          ) : confirmando ? (
            <div role="alert" className="flex w-full flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-2 sm:w-auto sm:flex-row sm:items-center">
              <span className="px-1 text-[13px] font-semibold text-red-800">¿Le sacamos el acceso?</span>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Boton variante="secundario" onClick={() => onConfirmar(false)}>No</Boton>
                <Boton variante="peligro" onClick={onQuitar} icono={<UserMinus size={16} />}>Sí, quitar</Boton>
              </div>
            </div>
          ) : (
            // En el celu: Editar a su medida y la acción de acceso ocupa el resto (a
            // mitades, «Devolver acceso» se partía en dos renglones).
            <div className="grid w-full grid-cols-[auto_1fr] gap-2 sm:flex sm:w-auto">
              <Boton
                variante="secundario"
                onClick={onEditar}
                title="Cambiar el nombre o el rol"
                icono={<Pencil size={15} />}
              >
                Editar
              </Boton>

              {!miembro.activo ? (
                <Boton variante="secundario" onClick={onDevolver} icono={<Undo2 size={15} />}>
                  Devolver acceso
                </Boton>
              ) : bloqueo !== null ? (
                // Un <span> y no un <button disabled>: sobre un botón deshabilitado el
                // navegador no muestra el title, y acá el motivo es lo importante.
                <span
                  title={bloqueo}
                  aria-disabled="true"
                  className="inline-flex h-11 cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-gray-200 px-4 font-display text-sm font-bold text-gray-400"
                >
                  <Lock size={15} /> Quitar acceso
                </span>
              ) : (
                <Boton
                  variante="secundario"
                  onClick={() => onConfirmar(true)}
                  icono={<UserMinus size={15} />}
                  className="text-red-700 hover:border-red-600"
                >
                  Quitar acceso
                </Boton>
              )}
            </div>
          )}
        </div>
      </div>

      {miembro.activo && bloqueo !== null && (
        <p className="mt-3 flex items-start gap-2 border-t border-gray-100 pt-3 text-[13px] text-gray-500">
          <Lock size={13} className="mt-0.5 shrink-0" /> {bloqueo}
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

  // Lo tipeado no se pierde por un toque afuera: Dialogo pregunta antes.
  const sucio = nombre !== (editando?.name ?? '')
    || email !== (editando?.email ?? '')
    || rol !== (editando?.role ?? 'admin');

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

  const idForm = 'equipo-form';
  const errorEmail = editando === null && email.trim() !== '' && !emailOk ? 'Eso no tiene forma de email.' : null;

  return (
    <Dialogo
      abierto
      titulo={editando !== null ? 'Editar miembro' : 'Dar acceso al panel'}
      alCerrar={onCerrar}
      ocupado={guardando}
      sucio={sucio}
      ancho="lg"
      pie={(
        <>
          <Boton
            variante="secundario"
            onClick={() => { if (!sucio || window.confirm('Tenés cambios sin guardar. ¿Descartarlos?')) onCerrar(); }}
            disabled={guardando}
          >
            Cancelar
          </Boton>
          <Boton
            type="submit"
            form={idForm}
            disabled={!puedeGuardar && !guardando}
            cargando={guardando}
            icono={editando !== null ? <Pencil size={15} /> : <UserPlus size={17} />}
          >
            {editando !== null ? 'Guardar cambios' : 'Dar acceso'}
          </Boton>
        </>
      )}
    >
      {/* <form>: Enter en cualquier campo guarda (si está todo en orden). */}
      <form id={idForm} onSubmit={e => { e.preventDefault(); void guardar(); }} className="space-y-5">
        <Campo etiqueta="Nombre" requerido ayuda="Es el nombre con el que la vas a ver en el panel.">
          <Entrada
            type="text"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Pauli"
            autoComplete="off"
          />
        </Campo>

        <div>
          <Campo
            etiqueta="Email"
            requerido
            error={errorEmail}
            ayuda={editando !== null
              ? 'El email no se cambia: es la llave del acceso. Si está mal escrito, sacale el acceso a este y dá de alta el correcto.'
              : undefined}
          >
            <Entrada
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              value={email}
              disabled={editando !== null}
              onChange={e => setEmail(e.target.value)}
              placeholder="pauli@volea.uy"
              className={errorEmail ? 'border-red-400 focus:border-red-600 focus:ring-red-600/15' : undefined}
            />
          </Campo>
          {yaExiste !== null && (
            <p role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>
                Ese email ya está en la lista ({yaExiste.name || 'sin nombre'}
                {yaExiste.activo ? '' : ', sin acceso'}).{' '}
                {yaExiste.activo
                  ? 'Editalo desde la lista en vez de darlo de alta de nuevo.'
                  : 'Cerrá esto y usá «Devolver acceso».'}
              </span>
            </p>
          )}
        </div>

        <div>
          <Campo etiqueta="Rol" ayuda={infoDe(rol).resumen}>
            <Selector value={rol} onChange={e => setRol(e.target.value as RolAdmin)}>
              {ROLES.map(r => (
                <option key={r.id} value={r.id} disabled={esUltimoDueno && r.id !== 'owner'}>
                  {r.corto}
                </option>
              ))}
            </Selector>
          </Campo>

          {esUltimoDueno && (
            <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
              <Lock size={15} className="mt-0.5 shrink-0" />
              <span>
                Es el único dueño activo, así que el rol queda trabado en Dueño: si se lo bajás, el sistema
                se queda sin nadie que pueda administrar accesos. Nombrá dueño a otra persona primero.
              </span>
            </p>
          )}
          {meBajoElRol && !esUltimoDueno && (
            <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>Sos vos: si te bajás de Dueño, perdés esta pantalla y te lo tiene que devolver otro dueño.</span>
            </p>
          )}
        </div>

        {editando === null && (
          <div className="flex items-start gap-2 rounded-lg bg-navy-50 p-3 text-[13px] text-navy-700">
            <KeyRound size={15} className="mt-0.5 shrink-0 text-navy-400" />
            <span>
              <b className="font-display">Esto es solo el permiso.</b> Para que pueda entrar de verdad, la cuenta
              con contraseña se crea aparte, en Supabase → Authentication → Users, con este mismo email.
            </span>
          </div>
        )}
      </form>
    </Dialogo>
  );
}
