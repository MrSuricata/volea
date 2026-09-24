// Panel de administración. Es un chunk LAZY (App.tsx lo pide recién en /admin): son
// ~2.300 líneas que ningún visitante de la tienda usa y antes viajaban en el JS de
// entrada. Regla para no romper el split: este archivo y sus hermanos de src/admin/
// pueden importar módulos compartidos (tienda/store, lib/*, utils/*, services/*),
// pero NADA de acá se importa estático desde App.tsx.

import { useState, useEffect, useCallback, useMemo, Suspense, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Menu, X, Search, Mail, ChevronRight, Package, Users, BarChart3, Tag, Trophy, Eye, AlertCircle, Store, CalendarDays, LogOut, Map as MapIcon, Megaphone, Globe, Newspaper, Wallet, Images, EyeOff, ClipboardList, UserRound, Truck, ListChecks, UserCog, Swords, ArrowLeft, Home, ShoppingBag, Landmark, LayoutGrid, ExternalLink, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import type { Product, SocioName, VentaCajaInput, GastoPendienteInput } from '../types';
import { SupabaseService } from '../services/supabaseService';
import { isSupabaseConnected } from '../services/supabaseClient';
import { cambiarPassword, signInWithPassword, sesionAdminVencida } from '../services/authService';
import { marcaVisitaInscripciones } from '../utils/inscripciones';
import { mismoStock } from '../utils/stock';
import { almacenSesion } from '../utils/almacen';
import { useStore } from '../tienda/store';
import { lazyConRecarga } from '../lib/lazyConRecarga';
import { cn } from '../lib/cn';
import { ATAJO_TAB_ADMIN } from '../lib/atajoAdmin';
import { resultadoIncierto } from './ui-ventas/ventas';
import { StockDashboard } from './StockDashboard';
import { LineasCancha } from '../ui/LineasCancha';
import { Boton, BotonIcono, Campo, CargandoFilas, Dialogo, Entrada, Vacio } from './ui';
import { InicioTab } from './tabs/InicioTab';
import { ProductosTab } from './tabs/ProductosTab';
import { PedidosClientesTab } from './tabs/PedidosClientesTab';
import { AnunciosTab, CategoriasTab, ClubesTab, EventosTab } from './tabs/CatalogoWebTabs';

// Gestor de torneos: ~42 KB gzip que solo usa el admin. Lazy para que la tienda publica
// (critical path) no lo cargue nunca; el chunk se pide recien al entrar a la pestaña Torneos.
const AdminTorneosTab = lazyConRecarga(() =>
  import('../components/AdminTorneosTab').then((m) => ({ default: m.AdminTorneosTab })),
);
// Resto de las pestañas del admin: mismo motivo que AdminTorneosTab — las usa solo el
// admin logueado, la tienda pública (critical path) no tiene por qué bajarlas. Cada
// chunk se pide recién al entrar a su pestaña. Socios arrastra a su chunk
// AdminSociosSection y AdminLiquidarCajaModal (solo los importa él).
const AdminCajaTab = lazyConRecarga(() =>
  import('../components/AdminCajaTab').then((m) => ({ default: m.AdminCajaTab })),
);
const AdminInscripcionesTab = lazyConRecarga(() => import('../components/AdminInscripcionesTab'));
const AdminJugadoresTab = lazyConRecarga(() => import('../components/AdminJugadoresTab'));
const AdminPedidosTab = lazyConRecarga(() => import('../components/AdminPedidosTab'));
const AdminTareasTab = lazyConRecarga(() => import('../components/AdminTareasTab'));
const AdminTanteadorTab = lazyConRecarga(() => import('../components/AdminTanteadorTab'));
const AdminEquipoTab = lazyConRecarga(() => import('../components/AdminEquipoTab'));
const SublimacionPanel = lazyConRecarga(() => import('../components/SublimacionPanel'));
const AdminSociosTab = lazyConRecarga(() =>
  import('../components/AdminSociosTab').then((m) => ({ default: m.AdminSociosTab })),
);
const AdminBlogTab = lazyConRecarga(() =>
  import('../components/AdminBlogTab').then((m) => ({ default: m.AdminBlogTab })),
);
const AdminStandingsTab = lazyConRecarga(() =>
  import('../components/AdminStandingsTab').then((m) => ({ default: m.AdminStandingsTab })),
);
const AdminGaleriaTab = lazyConRecarga(() =>
  import('../components/AdminGaleriaTab').then((m) => ({ default: m.AdminGaleriaTab })),
);
// Modales del admin (editor de producto y pedido manual): también lazy, con fallback
// null en su Suspense — se renderizan condicionalmente, así que el chunk baja recién
// al abrirlos y el modal aparece apenas llega (sin placeholder que parpadee).
const ProductEditor = lazyConRecarga(() =>
  import('../components/ProductEditor').then((m) => ({ default: m.ProductEditor })),
);


// Callback estable (identidad fija entre renders): si fuera una arrow function inline en el
// JSX, cambiaria de identidad en cada render de AdminPage, lo que tira abajo useSyncTorneos'
// avisarLimitado -> push -> pull (todos useCallback encadenados) y dispara el effect de
// persistencia de cache de nuevo aunque `cache` no haya cambiado (JSON.stringify + write a
// localStorage en cada render del admin, no solo cuando hay algo que sincronizar).
const avisarTorneos = (mensaje: string) => toast.error(mensaje);

// ─── 13. AdminPage ───────────────────────────────────────────────────────────

export default function AdminPage() {
  const store = useStore();
  const {
    isAdmin, currentAdmin, login, sendLoginLink, logout, products, refreshProducts, saveProduct, removeProduct, events, saveEvent, removeEvent,
    orders, updateOrderStatus, addOrder, categories, saveCategory, removeCategory, clubs, saveClub, removeClub,
    announcements, saveAnnouncement, removeAnnouncement, posts, savePost, removePost,
    standings, saveStanding, removeStanding
  } = store;

  // Caja: callbacks con identidad estable para no re-disparar el fetch del
  // ledger en cada re-render de AdminPage (sidebar, auth refresh, etc.).
  const loadLedger = useCallback(() => SupabaseService.getLedger(), []);
  const loadLedgerFull = useCallback(() => SupabaseService.getLedger(5000), []);
  const revertLedgerEntry = useCallback(async (id: string) => {
    const result = await SupabaseService.revertLedgerEntry(id);
    // Si se repuso stock, las otras pestañas (Stock, Productos) deben verlo.
    if (result.ok && result.stockRestored) refreshProducts();
    return result;
  }, [refreshProducts]);
  // Nueva venta / gasto desde la Caja web: mismas RPCs-semántica que el bot.
  // Quién registró: nombre del admin logueado (fallback al email o "Web").
  const cajaReportedBy = currentAdmin?.name || currentAdmin?.email || 'Web';
  const registrarVenta = useCallback(async (input: VentaCajaInput) => {
    const result = await SupabaseService.registrarVentaCaja(input, cajaReportedBy);
    // Venta de catálogo: el stock bajó y las otras pestañas (Stock, Productos)
    // deben verlo — mismo patrón de refresh que la anulación. Si no se sabe si entró
    // (timeout / red), también: la RPC pudo haber descontado igual.
    if (input.productId && (result.ok || resultadoIncierto(result.error))) refreshProducts();
    return result;
  }, [cajaReportedBy, refreshProducts]);
  const registrarGasto = useCallback(
    (label: string, amount: number, paidBy: SocioName) =>
      SupabaseService.registrarGastoCaja(label, amount, cajaReportedBy, paidBy),
    [cajaReportedBy],
  );
  // Gastos pendientes: quién lo cargó y quién después lo paga salen del admin
  // logueado, igual que en el resto de la Caja.
  const guardarGastoPendiente = useCallback(
    (g: GastoPendienteInput) => SupabaseService.saveGastoPendiente(g, cajaReportedBy),
    [cajaReportedBy],
  );
  const pagarGastoPendiente = useCallback(
    (id: string, paidBy: SocioName) =>
      SupabaseService.pagarGastoPendiente(id, paidBy, cajaReportedBy),
    [cajaReportedBy],
  );
  // De qué socio salió la plata NO se puede deducir de la cuenta compartida
  // ("VOLEA Team", somosvolea@gmail.com): ahí devolvemos null y la Caja obliga a
  // elegirlo a mano. Antes se adivinaba al liquidar y todo lo no reconocido se le
  // asentaba a Gastón, torciendo el reparto 50/25/25.
  // Los prefijos son deliberadamente específicos: con "gast" a secas, una cuenta
  // gastos@volea.uy o un nombre "Gastos VOLEA" quedaría mapeado a Gastón EN SILENCIO
  // y encima marcado como confirmado en la liquidación. Ante la duda, null: que lo
  // elija una persona.
  const socioSugerido = useMemo<SocioName | null>(() => {
    const campos = [(currentAdmin?.name || ''), (currentAdmin?.email || '')]
      .map(v => v.trim().toLowerCase()).filter(Boolean);
    const empieza = (...prefijos: string[]) => campos.some(c => prefijos.some(p => c.startsWith(p)));
    if (empieza('brian', 'bridvanovich')) return 'brian';
    if (empieza('paula', 'pauli')) return 'paula';
    if (empieza('gaston', 'gastón', 'gasty')) return 'gaston';
    return null;
  }, [currentAdmin?.name, currentAdmin?.email]);
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  // 'password' es el modo principal; el magic link queda como alternativa
  // (el SMTP built-in de Supabase tiene límite de ~2 mails/hora).
  const [authMode, setAuthMode] = useState<'password' | 'magiclink'>('password');
  const [signingIn, setSigningIn] = useState(false);

  // La pestaña vive en la URL (?tab=caja): "atrás" del celular vuelve a la pestaña
  // anterior en vez de sacarte del panel, recargar no te manda al inicio y se puede
  // pasar el link directo a una sección. El atajo de la barra de admin de la web
  // pública (ATAJO_TAB_ADMIN) se consume una vez al entrar.
  const [params, setParams] = useSearchParams();
  const [atajoInicial] = useState(() => {
    const atajo = almacenSesion.leer(ATAJO_TAB_ADMIN);
    if (atajo) almacenSesion.borrar(ATAJO_TAB_ADMIN);
    return atajo;
  });
  const activeTab = params.get('tab') || atajoInicial || 'dashboard';
  useEffect(() => {
    if (atajoInicial && !params.get('tab')) setParams({ tab: atajoInicial }, { replace: true });
  }, [atajoInicial]); // eslint-disable-line react-hooks/exhaustive-deps
  const setActiveTab = useCallback((id: string, extra?: Record<string, string>) => {
    setParams(id === 'dashboard' && !extra ? {} : { tab: id, ...extra });
    window.scrollTo(0, 0);
  }, [setParams]);

  const [menuAbierto, setMenuAbierto] = useState(false);
  const [cambiarPass, setCambiarPass] = useState(false);
  // Un solo grupo abierto por vez: es lo que mantiene corta la barra.
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(null);
  const [buscarSeccion, setBuscarSeccion] = useState('');
  const [tareasPendientes, setTareasPendientes] = useState(0);
  // Modo transmisión: esconde la columna del admin en desktop (streaming en vivo).
  const [panelOculto, setPanelOculto] = useState(false);
  const useSupabaseAuth = isSupabaseConnected();

  // Product editor global: se abre desde Productos y desde Stock.
  const [productModal, setProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const editarProducto = useCallback((p: Product | null) => { setEditingProduct(p); setProductModal(true); }, []);

  // Badge de inscripciones nuevas desde la última visita a la pestaña (marca en
  // localStorage). Se consulta al montar y al volver el foco; la pestaña lo apaga con
  // alVerla. inscEventoAtajo = evento preseleccionado al llegar desde Eventos.
  const [inscNuevas, setInscNuevas] = useState(0);
  const [inscEventoAtajo, setInscEventoAtajo] = useState<string | null>(null);
  // Tareas sin terminar (número de la barra): al montar y al volver a la app, no en cada
  // cambio de pestaña como antes.
  useEffect(() => {
    if (!isAdmin) return;
    let vivo = true;
    const consultar = () => {
      void SupabaseService.getTareas().then(ts => {
        if (vivo && ts) setTareasPendientes(ts.filter(t => t.estado !== 'hecha').length);
      });
    };
    consultar();
    const onVis = () => { if (!document.hidden) consultar(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { vivo = false; document.removeEventListener('visibilitychange', onVis); };
  }, [isAdmin, activeTab === 'tareas']); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAdmin) return;
    let vivo = true;
    const consultar = () => {
      void SupabaseService.getInscripcionesNuevas(marcaVisitaInscripciones()).then(n => {
        if (vivo && n !== null) setInscNuevas(n);
      });
    };
    consultar();
    const onVis = () => { if (!document.hidden) consultar(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { vivo = false; document.removeEventListener('visibilitychange', onVis); };
  }, [isAdmin]);

  // El menú del celular: Escape lo cierra y el fondo no scrollea mientras está abierto.
  useEffect(() => {
    if (!menuAbierto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuAbierto(false); };
    document.addEventListener('keydown', onKey);
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previo; };
  }, [menuAbierto]);

  // ─── Login ───────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50 lg:flex-row">
        {/* Marca: franja arriba en el celular, columna a la izquierda en compu. */}
        <div className="relative flex items-center justify-between overflow-hidden bg-navy-900 px-6 py-5 lg:w-[44%] lg:flex-col lg:items-start lg:justify-between lg:p-12">
          <LineasCancha className="absolute inset-0 hidden h-full w-full text-lime-400 opacity-[0.07] lg:block" />
          <Link to="/" aria-label="Ir a la web de VOLEA" className="relative"><img src="/logo-white.png" alt="VOLEA" className="h-9 lg:h-12" /></Link>
          <div className="relative hidden lg:block">
            <p className="font-display text-xs font-bold uppercase tracking-[0.25em] text-lime-400">Panel de gestión</p>
            <p className="mt-3 max-w-sm font-display text-4xl font-black uppercase leading-[0.95] tracking-tight text-white">Tienda, caja y torneos en un solo lugar.</p>
          </div>
          <p className="relative hidden text-sm text-white/50 lg:block">Solo para el equipo de VOLEA.</p>
          <span className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-white/60 lg:hidden">Panel</span>
        </div>

        <div className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
          <div className="w-full max-w-sm">
            <h1 className="font-display text-2xl font-black uppercase tracking-tight text-navy-700">Entrar</h1>
            <p className="mt-1 text-sm text-gray-500">
              {!useSupabaseAuth
                ? 'Ingresá la contraseña para acceder.'
                : authMode === 'password'
                  ? 'Con tu email y contraseña del equipo.'
                  : 'Te mandamos un link de acceso a tu email.'}
            </p>

            {loginError && (
              <p role="alert" className="mt-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle size={16} className="shrink-0" /> {loginError}
              </p>
            )}

            <div className="mt-6">
              {magicLinkSent ? (
                <div className="rounded-xl border border-gray-200 bg-white p-5 text-center">
                  <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Mail size={22} /></span>
                  <p className="font-display font-bold text-navy-700">Te mandamos el link</p>
                  <p className="mt-1 text-sm text-gray-500">Revisá <strong>{email}</strong> y tocá el link para entrar.</p>
                  <Boton variante="fantasma" className="mt-3" onClick={() => { setMagicLinkSent(false); setEmail(''); }}>Usar otro email</Boton>
                </div>
              ) : useSupabaseAuth && authMode === 'password' ? (
                <form
                  className="space-y-4"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setLoginError('');
                    setSigningIn(true);
                    const result = await signInWithPassword(email, password);
                    if (!result.success) {
                      setSigningIn(false);
                      setLoginError(result.error || 'No se pudo iniciar sesión');
                    }
                    // Éxito: onAuthStateChange activa isAdmin y este form desaparece.
                  }}
                >
                  <Campo etiqueta="Email">
                    <Entrada type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" />
                  </Campo>
                  <Campo etiqueta="Contraseña">
                    <div className="relative">
                      <Entrada type={verPassword ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pr-12" />
                      <BotonIcono etiqueta={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} icono={verPassword ? <EyeOff size={18} /> : <Eye size={18} />} onClick={() => setVerPassword(v => !v)} className="absolute right-0 top-0" />
                    </div>
                  </Campo>
                  <Boton type="submit" anchoCompleto cargando={signingIn}>{signingIn ? 'Entrando…' : 'Entrar al panel'}</Boton>
                  <Boton variante="fantasma" anchoCompleto onClick={() => { setLoginError(''); setAuthMode('magiclink'); }}>
                    Prefiero recibir un link por email
                  </Boton>
                </form>
              ) : useSupabaseAuth ? (
                <form
                  className="space-y-4"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setLoginError('');
                    setSendingMagicLink(true);
                    const result = await sendLoginLink(email);
                    setSendingMagicLink(false);
                    if (result.success) setMagicLinkSent(true);
                    else setLoginError(result.error || 'Error al enviar el link');
                  }}
                >
                  <Campo etiqueta="Email">
                    <Entrada type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" />
                  </Campo>
                  <Boton type="submit" anchoCompleto cargando={sendingMagicLink} icono={<Mail size={17} />}>Recibir link de acceso</Boton>
                  <Boton variante="fantasma" anchoCompleto onClick={() => { setLoginError(''); setAuthMode('password'); }}>Entrar con contraseña</Boton>
                </form>
              ) : (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!login(password)) {
                      setLoginError('Contraseña incorrecta');
                      setTimeout(() => setLoginError(''), 3000);
                    }
                  }}
                >
                  <Campo etiqueta="Contraseña">
                    <Entrada type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </Campo>
                  <Boton type="submit" anchoCompleto>Entrar al panel</Boton>
                </form>
              )}
            </div>
            <Link to="/" className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-navy-700">
              <ArrowLeft size={15} /> Volver a la web
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // El taller de sublimacion tiene su propia app: entra aca y no ve el panel.
  // La base ademas no le devuelve nada mas que sus trabajos (RLS), asi que esto
  // es comodidad de navegacion, no la barrera de seguridad.
  if (currentAdmin?.role === 'sublimacion') {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-navy-500">Cargando…</div>}>
        <SublimacionPanel nombre={currentAdmin.name || 'Taller'} onSalir={logout} />
      </Suspense>
    );
  }

  const pendingOrders = orders.filter(o => o.status === 'pending').length;

  // ─── Menú ────────────────────────────────────────────────────────────────────
  // Lo de todos los días fijo arriba; el resto en grupos que se abren de a uno. Sin
  // duplicados (antes Caja y Tareas estaban dos veces y se marcaban las dos).
  const tabsFijos: ItemMenu[] = [
    { id: 'dashboard', label: 'Inicio', icon: <Home size={18} /> },
    { id: 'caja', label: 'Caja', icon: <Wallet size={18} /> },
    { id: 'orders', label: 'Pedidos', icon: <ShoppingBag size={18} /> },
    { id: 'tareas', label: 'Tareas', icon: <ListChecks size={18} /> },
  ];
  const gruposTabs: GrupoMenu[] = [
    {
      id: 'g-tienda', label: 'Tienda', icon: <Store size={18} />,
      items: [
        { id: 'products', label: 'Productos', icon: <Package size={16} /> },
        { id: 'stock', label: 'Stock', icon: <AlertCircle size={16} /> },
        // 'Pedidos' son los de clientes (arriba); 'Compras' las que hacemos nosotros.
        { id: 'compras', label: 'Compras', icon: <Truck size={16} /> },
        { id: 'categories', label: 'Categorías', icon: <Tag size={16} /> },
      ],
    },
    {
      id: 'g-torneos', label: 'Torneos', icon: <Trophy size={18} />,
      items: [
        { id: 'torneos', label: 'Gestor de torneos', icon: <Trophy size={16} /> },
        { id: 'tanteador', label: 'Tanteador', icon: <Swords size={16} /> },
        { id: 'inscripciones', label: 'Inscripciones', icon: <ClipboardList size={16} /> },
        { id: 'jugadores', label: 'Jugadores', icon: <UserRound size={16} /> },
        { id: 'events', label: 'Eventos', icon: <CalendarDays size={16} /> },
        { id: 'standings', label: 'Clasificación', icon: <BarChart3 size={16} /> },
      ],
    },
    {
      id: 'g-plata', label: 'Plata', icon: <Landmark size={18} />,
      items: [{ id: 'socios', label: 'Socios', icon: <Users size={16} /> }],
    },
    {
      id: 'g-web', label: 'Web', icon: <Globe size={18} />,
      items: [
        { id: 'blog', label: 'Blog', icon: <Newspaper size={16} /> },
        { id: 'galeria', label: 'Galería', icon: <Images size={16} /> },
        { id: 'announcements', label: 'Anuncios', icon: <Megaphone size={16} /> },
        { id: 'clubs', label: 'Clubes', icon: <MapIcon size={16} /> },
      ],
    },
    // Quién entra al panel lo decide solo el dueño del proyecto.
    ...(currentAdmin?.role === 'owner'
      ? [{ id: 'g-equipo', label: 'Equipo', icon: <UserCog size={18} />, items: [{ id: 'equipo', label: 'Accesos', icon: <UserCog size={16} /> }] }]
      : []),
  ];

  // Cuántos avisos lleva cada sección: la barra dice dónde hay algo esperando.
  const avisosPorTab: Record<string, number> = { inscripciones: inscNuevas, orders: pendingOrders, tareas: tareasPendientes };
  const avisosDelGrupo = (g: GrupoMenu) => g.items.reduce((n, it) => n + (avisosPorTab[it.id] || 0), 0);
  const todos = [...tabsFijos, ...gruposTabs.flatMap(g => g.items)];
  const tabActual = todos.find(t => t.id === activeTab);
  const grupoActual = gruposTabs.find(g => g.items.some(it => it.id === activeTab));

  const irA = (id: string, extra?: Record<string, string>) => {
    setActiveTab(id, extra);
    setMenuAbierto(false);
    setBuscarSeccion('');
  };

  const q = buscarSeccion.trim().toLowerCase();
  const resultados = q === '' ? [] : todos.filter(it => it.label.toLowerCase().includes(q));

  const claseItem = (id: string, chico = false) => cn(
    'relative flex w-full items-center gap-3 rounded-lg font-display font-semibold transition-colors',
    chico ? 'min-h-[40px] px-3 text-[13px]' : 'min-h-[44px] px-3 text-sm',
    activeTab === id ? 'bg-white/10 text-white' : 'text-white/65 hover:bg-white/5 hover:text-white',
  );
  const Marca = ({ id }: { id: string }) => activeTab === id
    ? <span aria-hidden className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-lime-400" />
    : null;
  const Aviso = ({ n }: { n: number }) => n > 0
    ? <span className="ml-auto rounded-full bg-lime-400 px-2 py-0.5 text-[11px] font-bold tabular-nums text-navy-900">{n}</span>
    : null;

  // El contenido del menú es el mismo en la columna de compu y en el cajón del celular.
  const contenidoMenu = (
    <>
      <div className="flex items-center justify-between gap-2 px-5 pb-4 pt-5">
        <Link to="/" className="flex items-center gap-2" title="Ir a la web">
          <img src="/logo-white.png" alt="VOLEA" className="h-8" />
        </Link>
        <span className="rounded-md bg-white/10 px-2 py-1 font-display text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">Panel</span>
        <BotonIcono etiqueta="Cerrar menú" icono={<X size={20} />} tono="claro" className="lg:hidden" onClick={() => setMenuAbierto(false)} />
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 ring-1 ring-white/10 focus-within:ring-white/30">
          <Search size={15} className="shrink-0 text-white/50" />
          <input
            type="search"
            value={buscarSeccion}
            onChange={e => setBuscarSeccion(e.target.value)}
            placeholder="Buscar sección…"
            aria-label="Buscar sección del panel"
            className="h-10 w-full min-w-0 bg-transparent text-base text-white placeholder:text-white/40 outline-none sm:text-sm"
          />
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-4 pb-4" aria-label="Secciones del panel">
        {q !== '' ? (
          resultados.length === 0
            ? <p className="px-3 py-3 text-sm text-white/50">Nada con «{buscarSeccion.trim()}»</p>
            : resultados.map(it => (
              <button key={it.id} onClick={() => irA(it.id)} className={claseItem(it.id)} aria-current={activeTab === it.id ? 'page' : undefined}>
                <Marca id={it.id} />{it.icon} {it.label}<Aviso n={avisosPorTab[it.id] || 0} />
              </button>
            ))
        ) : (
          <>
            {tabsFijos.map(t => (
              <button key={t.id} onClick={() => irA(t.id)} className={claseItem(t.id)} aria-current={activeTab === t.id ? 'page' : undefined}>
                <Marca id={t.id} />{t.icon} {t.label}<Aviso n={avisosPorTab[t.id] || 0} />
              </button>
            ))}
            <div className="my-3 h-px bg-white/10" />
            {gruposTabs.map(g => {
              const tieneActivo = g.items.some(it => it.id === activeTab);
              const abierto = grupoAbierto === g.id || (grupoAbierto === null && tieneActivo);
              const avisos = avisosDelGrupo(g);
              return (
                <div key={g.id}>
                  <button
                    onClick={() => setGrupoAbierto(abierto ? '' : g.id)}
                    aria-expanded={abierto}
                    className={cn(
                      'flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 font-display text-[12px] font-bold uppercase tracking-[0.12em] transition-colors',
                      tieneActivo ? 'text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/80',
                    )}
                  >
                    {g.icon} {g.label}
                    {!abierto && avisos > 0 && <span className="ml-auto rounded-full bg-lime-400 px-2 py-0.5 text-[11px] font-bold text-navy-900">{avisos}</span>}
                    <ChevronRight size={15} className={cn(!abierto && avisos > 0 ? 'ml-1.5' : 'ml-auto', 'transition-transform', abierto && 'rotate-90')} />
                  </button>
                  {abierto && (
                    <div className="mb-2 ml-5 space-y-0.5 border-l border-white/10 pl-3">
                      {g.items.map(it => (
                        <button key={g.id + it.id} onClick={() => irA(it.id)} className={claseItem(it.id, true)} aria-current={activeTab === it.id ? 'page' : undefined}>
                          <Marca id={it.id} />{it.icon} {it.label}<Aviso n={avisosPorTab[it.id] || 0} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </nav>
      <div className="border-t border-white/10 p-4">
        <div className="mb-2 flex items-center gap-3 px-1">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lime-400 font-display text-sm font-black text-navy-900">
            {(currentAdmin?.name || currentAdmin?.email || '?').trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{currentAdmin?.name || currentAdmin?.email || 'Admin'}</p>
            <p className="text-[11px] uppercase tracking-wider text-white/50">{currentAdmin?.role === 'owner' ? 'Dueño' : 'Equipo'}</p>
          </div>
        </div>
        <Link to="/" className="flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-[13px] font-semibold text-white/65 hover:bg-white/5 hover:text-white">
          <ExternalLink size={16} /> Ver la web
        </Link>
        {useSupabaseAuth && (
          <button onClick={() => { setMenuAbierto(false); setCambiarPass(true); }} className="flex min-h-[40px] w-full items-center gap-3 rounded-lg px-3 text-[13px] font-semibold text-white/65 hover:bg-white/5 hover:text-white">
            <KeyRound size={16} /> Cambiar mi contraseña
          </button>
        )}
        <button
          onClick={() => setPanelOculto(true)}
          className="hidden min-h-[40px] w-full items-center gap-3 rounded-lg px-3 text-[13px] font-semibold text-white/65 hover:bg-white/5 hover:text-white lg:flex"
          title="Esconde esta columna para transmitir la pantalla limpia"
        >
          <EyeOff size={16} /> Ocultar panel
        </button>
        <button onClick={logout} className="flex min-h-[40px] w-full items-center gap-3 rounded-lg px-3 text-[13px] font-semibold text-white/65 hover:bg-red-500/10 hover:text-red-300">
          <LogOut size={16} /> Cerrar sesión
        </button>
      </div>
    </>
  );

  // Barra de abajo del celular: lo que se usa parado en un torneo o en el mostrador.
  const barraInferior: { id: string; label: string; icon: ReactNode; activo: boolean; avisos: number }[] = [
    { id: 'dashboard', label: 'Inicio', icon: <Home size={21} />, activo: activeTab === 'dashboard', avisos: 0 },
    { id: 'caja', label: 'Caja', icon: <Wallet size={21} />, activo: activeTab === 'caja', avisos: 0 },
    { id: 'orders', label: 'Pedidos', icon: <ShoppingBag size={21} />, activo: activeTab === 'orders', avisos: pendingOrders },
    { id: 'torneos', label: 'Torneos', icon: <Trophy size={21} />, activo: grupoActual?.id === 'g-torneos', avisos: inscNuevas },
  ];
  const enBarraInferior = barraInferior.some(b => b.activo);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Columna del menú (compu) */}
      <aside className={cn('fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-navy-900', panelOculto ? 'lg:hidden' : 'lg:flex')}>
        {contenidoMenu}
      </aside>

      {/* Cajón del menú (celular) */}
      {menuAbierto && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-navy-900/60" onClick={() => setMenuAbierto(false)} />
          <div className="slide-in-left absolute inset-y-0 left-0 flex w-[84%] max-w-xs flex-col bg-navy-900 pb-[env(safe-area-inset-bottom)] shadow-2xl" role="dialog" aria-modal="true" aria-label="Menú del panel">
            {contenidoMenu}
          </div>
        </div>
      )}

      {/* Botón flotante para volver del modo transmisión (discreto, abajo a la izquierda) */}
      {panelOculto && (
        <button
          onClick={() => setPanelOculto(false)}
          className="fixed bottom-4 left-4 z-40 hidden items-center gap-2 rounded-full bg-navy-800/80 px-3 py-2 font-display text-xs font-semibold text-gray-300 shadow-lg transition-colors hover:bg-navy-700 hover:text-lime-400 lg:flex"
          title="Mostrar el panel del admin"
        >
          <Eye size={14} /> Panel
        </button>
      )}

      <div className={cn(!panelOculto && 'lg:pl-64')}>
        {/* Barra de arriba del celular: siempre a mano (antes había que volver arriba de todo para abrir el menú). */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-gray-200 bg-white/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
          <BotonIcono etiqueta="Abrir menú" icono={<Menu size={22} />} onClick={() => setMenuAbierto(true)} />
          {/* Solo marca: el título ya lo pone cada pantalla (repetirlo acá lo duplicaba). */}
          <Link to="/admin" onClick={(e) => { e.preventDefault(); irA('dashboard'); }} className="flex min-w-0 flex-1 items-center gap-2" aria-label="Inicio del panel">
            <img src="/logo.png" alt="VOLEA" className="h-6" />
            <span className="rounded bg-navy-700 px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-[0.2em] text-white">Panel</span>
          </Link>
        </header>

        <main className="mx-auto max-w-7xl px-4 pb-28 pt-5 md:px-8 md:pt-8 lg:pb-12">
          <div key={activeTab} className="fade-in">
            {activeTab === 'dashboard' && (
              <InicioTab nombre={currentAdmin?.name || currentAdmin?.email || ''} irA={irA} inscNuevas={inscNuevas} tareasPendientes={tareasPendientes} />
            )}
            {activeTab === 'stock' && <StockDashboard products={products} onEdit={editarProducto} />}
            {activeTab === 'products' && <ProductosTab editar={editarProducto} />}
            {activeTab === 'orders' && <PedidosClientesTab />}
            {activeTab === 'categories' && <CategoriasTab />}
            {activeTab === 'events' && <EventosTab verInscriptos={(id) => { setInscEventoAtajo(id); irA('inscripciones'); }} />}
            {activeTab === 'clubs' && <ClubesTab />}
            {activeTab === 'announcements' && <AnunciosTab />}

            {activeTab === 'inscripciones' && (
              <Suspense fallback={<CargandoFilas />}>
                <AdminInscripcionesTab events={events} eventoInicialId={inscEventoAtajo} alVerla={() => setInscNuevas(0)} />
              </Suspense>
            )}
            {activeTab === 'jugadores' && (
              <Suspense fallback={<CargandoFilas />}>
                <AdminJugadoresTab loadLedgerFull={loadLedgerFull} />
              </Suspense>
            )}
            {activeTab === 'caja' && (
              <Suspense fallback={<CargandoFilas />}>
                <AdminCajaTab
                  loadLedger={loadLedger}
                  loadLedgerFull={loadLedgerFull}
                  revertEntry={revertLedgerEntry}
                  loadSocioMoves={SupabaseService.getSocioMoves}
                  products={products}
                  registrarVenta={registrarVenta}
                  registrarGasto={registrarGasto}
                  socioSugerido={socioSugerido}
                  cobrarDeudor={SupabaseService.cobrarDeudorCaja}
                  loadGastosPendientes={SupabaseService.getGastosPendientes}
                  saveGastoPendiente={guardarGastoPendiente}
                  pagarGastoPendiente={pagarGastoPendiente}
                  deleteGastoPendiente={SupabaseService.deleteGastoPendiente}
                />
              </Suspense>
            )}
            {activeTab === 'socios' && (
              <Suspense fallback={<CargandoFilas />}>
                <AdminSociosTab
                  loadLedgerFull={loadLedgerFull}
                  loadSocioMoves={SupabaseService.getSocioMoves}
                  addSocioMoves={SupabaseService.addSocioMoves}
                  deleteSocioMove={SupabaseService.deleteSocioMove}
                  deleteSocioMovesGrupo={SupabaseService.deleteSocioMovesGrupo}
                  liquidarCaja={SupabaseService.liquidarCaja}
                />
              </Suspense>
            )}
            {activeTab === 'blog' && (
              <Suspense fallback={<CargandoFilas />}>
                <AdminBlogTab posts={posts} onSave={savePost} onDelete={removePost} uploadImage={(f) => SupabaseService.uploadImage(f, 'blog')} />
              </Suspense>
            )}
            {/* Galería: álbumes de fotos, cada uno un link de salida a Drive/Photos */}
            {activeTab === 'galeria' && (
              <Suspense fallback={<CargandoFilas />}>
                <AdminGaleriaTab uploadImage={(f) => SupabaseService.uploadImage(f, 'gallery')} />
              </Suspense>
            )}
            {activeTab === 'standings' && (
              <Suspense fallback={<CargandoFilas />}>
                <AdminStandingsTab standings={standings} onSave={saveStanding} onDelete={removeStanding} />
              </Suspense>
            )}
            {/* Gestor de torneos con sync local-first a Supabase (lazy, ver import). */}
            {activeTab === 'torneos' && (
              <Suspense fallback={<CargandoFilas />}>
                <AdminTorneosTab avisar={avisarTorneos} />
              </Suspense>
            )}
            {activeTab === 'compras' && (
              <Suspense fallback={<CargandoFilas />}>
                <AdminPedidosTab products={products} adminEmail={currentAdmin?.email || ''} onStockChanged={refreshProducts} />
              </Suspense>
            )}
            {activeTab === 'tareas' && (
              <Suspense fallback={<CargandoFilas />}>
                <AdminTareasTab adminEmail={currentAdmin?.email || ''} />
              </Suspense>
            )}
            {activeTab === 'tanteador' && (
              <Suspense fallback={<CargandoFilas />}>
                <AdminTanteadorTab adminEmail={currentAdmin?.email || ''} />
              </Suspense>
            )}
            {activeTab === 'equipo' && currentAdmin?.role === 'owner' && (
              <Suspense fallback={<CargandoFilas />}>
                <AdminEquipoTab miEmail={currentAdmin.email} />
              </Suspense>
            )}
            {!tabActual && (
              <Vacio titulo="Esa sección no existe" descripcion="Puede que el link sea viejo." accion={<Boton onClick={() => irA('dashboard')}>Ir al inicio</Boton>} />
            )}
          </div>
        </main>
      </div>

      {/* Barra de abajo (celular) */}
      <nav aria-label="Accesos rápidos" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {barraInferior.map(b => (
          <button
            key={b.id}
            onClick={() => irA(b.id)}
            aria-current={b.activo ? 'page' : undefined}
            className={cn('relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors', b.activo ? 'text-navy-700' : 'text-gray-500')}
          >
            {b.activo && <span aria-hidden className="absolute top-0 h-0.5 w-10 rounded-b bg-navy-700" />}
            <span className="relative">
              {b.icon}
              {b.avisos > 0 && (
                <span className="absolute -right-2.5 -top-1.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">{b.avisos > 99 ? '99+' : b.avisos}</span>
              )}
            </span>
            {b.label}
          </button>
        ))}
        <button
          onClick={() => setMenuAbierto(true)}
          aria-current={!enBarraInferior ? 'page' : undefined}
          className={cn('relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', !enBarraInferior ? 'text-navy-700' : 'text-gray-500')}
        >
          {!enBarraInferior && <span aria-hidden className="absolute top-0 h-0.5 w-10 rounded-b bg-navy-700" />}
          <LayoutGrid size={21} />
          Más
        </button>
      </nav>

      <CambiarPasswordDialogo abierto={cambiarPass} alCerrar={() => setCambiarPass(false)} />

      {/* Editor de producto global: se abre desde Productos y desde Stock */}
      {productModal && (
        <Suspense fallback={null}>
          <ProductEditor
            product={editingProduct}
            categories={categories}
            uploadImage={(f) => SupabaseService.uploadImage(f, 'products')}
            onClose={() => { setProductModal(false); setEditingProduct(null); }}
            onSave={async (p, stock) => {
              if (stock.modo === 'editado') {
                const actual = await SupabaseService.getStockProducto(p.id);
                if (actual && !mismoStock(actual, stock.base)) {
                  toast.error('Mientras editabas se movió el stock de este producto (hubo ventas o una compra). No guardé para no pisarlo: cerrá, volvé a abrirlo y cargá el stock de nuevo.', { duration: 10000 });
                  refreshProducts();
                  return false;
                }
              }
              saveProduct(p, { sinStock: stock.modo === 'sin-cambios' });
              setProductModal(false);
              setEditingProduct(null);
              return true;
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

type ItemMenu = { id: string; label: string; icon: ReactNode };
type GrupoMenu = { id: string; label: string; icon: ReactNode; items: ItemMenu[] };

/** Cambiar la contraseña propia (la escribe la persona; nunca se guarda en ningún lado del front). */
function CambiarPasswordDialogo({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cerrar = () => { setNueva(''); setRepetida(''); setError(null); alCerrar(); };
  const guardar = async () => {
    if (nueva.length < 8) { setError('Tiene que tener al menos 8 caracteres.'); return; }
    if (nueva !== repetida) { setError('Las dos no coinciden.'); return; }
    setGuardando(true);
    const r = await cambiarPassword(nueva);
    setGuardando(false);
    if (!r.success) { setError(r.error || 'No se pudo cambiar.'); return; }
    toast.success('Contraseña cambiada. La próxima vez entrá con la nueva.');
    cerrar();
  };
  return (
    <Dialogo
      abierto={abierto}
      titulo="Cambiar mi contraseña"
      descripcion="Mínimo 8 caracteres. Guardala en el gestor de contraseñas del navegador."
      alCerrar={cerrar}
      ancho="sm"
      ocupado={guardando}
      sucio={nueva !== '' || repetida !== ''}
      pie={(
        <>
          <Boton variante="secundario" onClick={cerrar} disabled={guardando}>Cancelar</Boton>
          <Boton type="submit" form="form-cambiar-pass" cargando={guardando}>Guardar contraseña</Boton>
        </>
      )}
    >
      <form id="form-cambiar-pass" className="space-y-4" onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
        <Campo etiqueta="Nueva contraseña" error={error}>
          <Entrada type="password" autoComplete="new-password" value={nueva} onChange={(e) => { setNueva(e.target.value); setError(null); }} />
        </Campo>
        <Campo etiqueta="Repetila">
          <Entrada type="password" autoComplete="new-password" value={repetida} onChange={(e) => { setRepetida(e.target.value); setError(null); }} />
        </Campo>
      </form>
    </Dialogo>
  );
}
