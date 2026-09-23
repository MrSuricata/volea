// Panel de administración. Es un chunk LAZY (App.tsx lo pide recién en /admin): son
// ~2.300 líneas que ningún visitante de la tienda usa y antes viajaban en el JS de
// entrada. Regla para no romper el split: este archivo y sus hermanos de src/admin/
// pueden importar módulos compartidos (tienda/store, lib/*, utils/*, services/*),
// pero NADA de acá se importa estático desde App.tsx.

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, Search, Star, Mail, ChevronRight, Plus, Trash2, Edit, Package, Users, BarChart3, Tag, ArrowRight, Shield, Trophy, Eye, Check, AlertCircle, Store, CalendarDays, LogOut, ChevronDown, Map as MapIcon, Megaphone, Globe, Newspaper, Wallet, Images, EyeOff, ClipboardList, UserRound, Truck, ListChecks, UserCog, Swords } from 'lucide-react';
import { toast } from 'sonner';
import type { Product, Event, Order, Club, Announcement, PaymentStatus, SocioName, VentaCajaInput, GastoPendienteInput } from '../types';
import { SupabaseService } from '../services/supabaseService';
import { isSupabaseConnected } from '../services/supabaseClient';
import { signInWithPassword, sesionAdminVencida } from '../services/authService';
import { agruparPorEvento, listarTorneosPublicos, type EventoAgrupado } from '../torneos/publico/datos';
import { marcaVisitaInscripciones } from '../utils/inscripciones';
import { mismoStock } from '../utils/stock';
import { urlImagen } from '../utils/imagenes';
import { almacenSesion } from '../utils/almacen';
import { useStore } from '../tienda/store';
import { lazyConRecarga, cargandoTab } from '../lib/lazyConRecarga';
import { formatPrice, getTotalStock, categoryLabel, rangoLargo } from '../lib/formato';
import { FALLBACK_IMG, errorFoto } from '../lib/fotos';
import { ATAJO_TAB_ADMIN } from '../lib/atajoAdmin';
import { StockDashboard } from './StockDashboard';
import { EventModal } from './EventModal';
import { ClubModal } from './ClubModal';
import { AnnouncementModal } from './AnnouncementModal';

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
const AdminOrderModal = lazyConRecarga(() =>
  import('../components/AdminOrderModal').then((m) => ({ default: m.AdminOrderModal })),
);

// Callback estable (identidad fija entre renders): si fuera una arrow function inline en el
// JSX, cambiaria de identidad en cada render de AdminPage, lo que tira abajo useSyncTorneos'
// avisarLimitado -> push -> pull (todos useCallback encadenados) y dispara el effect de
// persistencia de cache de nuevo aunque `cache` no haya cambiado (JSON.stringify + write a
// localStorage en cada render del admin, no solo cuando hay algo que sincronizar).
const avisarTorneos = (mensaje: string) => toast.error(mensaje);

// ─── 13. AdminPage ───────────────────────────────────────────────────────────

// Badge del estado de pago online de un pedido (null = flujo WhatsApp puro).
function BadgePagoMP({ order }: { order: Order }) {
  // v24: el webhook (o el descuento de stock) dejó el pago para revisar. Gana sobre el
  // estado: un "Pagado" con el monto equivocado no puede verse verde.
  if (order.requiereRevision) {
    return (
      <span
        title={order.requiereRevision}
        className="text-xs font-semibold rounded-full px-2 py-1 whitespace-nowrap bg-red-100 text-red-700"
      >
        ⚠ Revisar pago
      </span>
    );
  }
  if (!order.paymentStatus) return null;
  const cfg: Record<PaymentStatus, { texto: string; clases: string }> = {
    aprobado:  { texto: '💳 Pagado (MP)',  clases: 'bg-green-100 text-green-700' },
    pendiente: { texto: 'MP en proceso',   clases: 'bg-yellow-100 text-yellow-700' },
    iniciado:  { texto: 'MP sin terminar', clases: 'bg-gray-100 text-gray-500' },
    rechazado: { texto: 'MP rechazado',    clases: 'bg-red-100 text-red-600' },
    devuelto:  { texto: 'MP devuelto',     clases: 'bg-orange-100 text-orange-600' },
  };
  const c = cfg[order.paymentStatus];
  if (!c) return null;
  return (
    <span className={`text-xs font-semibold rounded-full px-2 py-1 whitespace-nowrap ${c.clases}`}>
      {c.texto}
    </span>
  );
}

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
    // deben verlo — mismo patrón de refresh que la anulación.
    if (result.ok && input.productId) refreshProducts();
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
  const [loginError, setLoginError] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  // 'password' es el modo principal; el magic link queda como alternativa
  // (el SMTP built-in de Supabase tiene límite de ~2 mails/hora).
  const [authMode, setAuthMode] = useState<'password' | 'magiclink'>('password');
  const [signingIn, setSigningIn] = useState(false);
  // Arranca en la pestaña que haya dejado la barra de admin flotante (atajo desde la
  // web pública) y consume el hint para que una visita manual a /admin siga cayendo
  // en el dashboard como siempre.
  const [activeTab, setActiveTab] = useState(() => {
    const atajo = almacenSesion.leer(ATAJO_TAB_ADMIN);
    if (atajo) {
      almacenSesion.borrar(ATAJO_TAB_ADMIN);
      return atajo;
    }
    return 'dashboard';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Un solo grupo abierto por vez: es lo que mantiene corta la barra.
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(null);
  const [buscarSeccion, setBuscarSeccion] = useState('');
  const [tareasPendientes, setTareasPendientes] = useState(0);
  // Modo transmisión: esconde la columna del admin en desktop (streaming en vivo).
  const [panelOculto, setPanelOculto] = useState(false);
  const useSupabaseAuth = isSupabaseConnected();

  // Torneos agrupados por evento para el Dashboard (pedido de Brian: torneos
  // arriba). Mismo fetch público que /torneos; se carga al entrar al tab.
  const [eventosDash, setEventosDash] = useState<EventoAgrupado[] | null>(null);
  useEffect(() => {
    if (activeTab !== 'dashboard' || eventosDash !== null) return;
    let vivo = true;
    void listarTorneosPublicos().then(r => {
      if (vivo && !r.error) setEventosDash(agruparPorEvento(r.torneos, Date.now()));
    });
    return () => { vivo = false; };
  }, [activeTab, eventosDash]);

  // Product modal state
  const [productModal, setProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Event modal state
  const [eventModal, setEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [deleteEventConfirm, setDeleteEventConfirm] = useState<string | null>(null);
  // Inscriptos del evento que se está por borrar (null = todavía no se sabe): el
  // confirm avisa antes de que el admin tire abajo un torneo con gente anotada.
  const [inscriptosABorrar, setInscriptosABorrar] = useState<number | null>(null);
  useEffect(() => {
    setInscriptosABorrar(null);
    if (!deleteEventConfirm) return;
    let vivo = true;
    void SupabaseService.contarInscriptos(deleteEventConfirm).then(n => {
      if (vivo) setInscriptosABorrar(n);
    });
    return () => { vivo = false; };
  }, [deleteEventConfirm]);

  // Badge de inscripciones nuevas desde la última visita a la pestaña (marca
  // en localStorage). Se consulta al montar y al volver el foco; la pestaña lo
  // apaga con alVerla. inscEventoAtajo = evento preseleccionado al llegar desde
  // el botón de la tabla de Eventos.
  const [inscNuevas, setInscNuevas] = useState(0);
  const [inscEventoAtajo, setInscEventoAtajo] = useState<string | null>(null);
  // Aviso de tareas sin terminar, para el numero de la barra.
  useEffect(() => {
    if (!isAdmin) return;
    let vivo = true;
    void SupabaseService.getTareas().then(ts => {
      if (vivo && ts) setTareasPendientes(ts.filter(t => t.estado !== 'hecha').length);
    });
    return () => { vivo = false; };
  }, [isAdmin, activeTab]);

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

  // Club modal state
  const [clubModal, setClubModal] = useState(false);
  const [editingClub, setEditingClub] = useState<Club | null>(null);
  const [deleteClubConfirm, setDeleteClubConfirm] = useState<string | null>(null);

  // Announcement modal state
  const [announcementModal, setAnnouncementModal] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [deleteAnnouncementConfirm, setDeleteAnnouncementConfirm] = useState<string | null>(null);

  // Expanded order + alta manual
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [orderModal, setOrderModal] = useState(false);

  // New category
  const [newCategory, setNewCategory] = useState('');

  // Login form
  if (!isAdmin) {
    return (
      <div className="fade-in min-h-[60vh] flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-navy-700 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield size={32} className="text-lime-400" />
            </div>
            <h1 className="font-display text-2xl font-bold text-navy-700">Panel de Administración</h1>
            <p className="text-gray-500 text-sm mt-1">
              {!useSupabaseAuth
                ? 'Ingresá la contraseña para acceder'
                : authMode === 'password'
                  ? 'Ingresá tu email y contraseña'
                  : 'Ingresá tu email y te mandamos un link de acceso'}
            </p>
          </div>

          {loginError && (
            <div className="bg-red-50 text-red-600 border border-red-200 rounded-lg p-3 mb-4 flex items-center gap-2 text-sm">
              <AlertCircle size={16} /> {loginError}
            </div>
          )}

          {magicLinkSent ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail size={28} className="text-green-600" />
              </div>
              <p className="text-navy-700 font-display font-semibold mb-2">¡Email enviado!</p>
              <p className="text-sm text-gray-500 mb-4">
                Revisá <strong>{email}</strong> y hacé clic en el link para entrar.
              </p>
              <button
                onClick={() => { setMagicLinkSent(false); setEmail(''); }}
                className="text-lime-800 text-sm font-semibold hover:underline"
              >
                Usar otro email
              </button>
            </div>
          ) : useSupabaseAuth && authMode === 'password' ? (
            <form
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
              <input
                type="email"
                placeholder="tu@email.com"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors mb-4"
              />
              <input
                type="password"
                placeholder="Contraseña"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors mb-4"
              />
              <button
                type="submit"
                disabled={signingIn}
                className="w-full bg-navy-700 hover:bg-navy-800 disabled:bg-gray-400 text-white font-display font-bold py-3 rounded-lg transition-colors"
              >
                {signingIn ? 'Entrando...' : 'Ingresar'}
              </button>
              <button
                type="button"
                onClick={() => { setLoginError(''); setAuthMode('magiclink'); }}
                className="w-full mt-3 text-lime-800 text-sm font-semibold hover:underline"
              >
                ¿Preferís recibir un link por email?
              </button>
            </form>
          ) : useSupabaseAuth ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setLoginError('');
                setSendingMagicLink(true);
                const result = await sendLoginLink(email);
                setSendingMagicLink(false);
                if (result.success) {
                  setMagicLinkSent(true);
                } else {
                  setLoginError(result.error || 'Error al enviar el link');
                }
              }}
            >
              <input
                type="email"
                placeholder="tu@email.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors mb-4"
              />
              <button
                type="submit"
                disabled={sendingMagicLink}
                className="w-full bg-navy-700 hover:bg-navy-800 disabled:bg-gray-400 text-white font-display font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {sendingMagicLink ? 'Enviando...' : (<><Mail size={18} /> Recibir link de acceso</>)}
              </button>
              <button
                type="button"
                onClick={() => { setLoginError(''); setAuthMode('password'); }}
                className="w-full mt-3 text-lime-800 text-sm font-semibold hover:underline"
              >
                Entrar con contraseña
              </button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!login(password)) {
                  setLoginError('Contraseña incorrecta');
                  setTimeout(() => setLoginError(''), 3000);
                }
              }}
            >
              <input
                type="password"
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/20 outline-none transition-colors mb-4"
              />
              <button
                type="submit"
                className="w-full bg-navy-700 hover:bg-navy-800 text-white font-display font-bold py-3 rounded-lg transition-colors"
              >
                Ingresar
              </button>
            </form>
          )}
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

  // Stats
  const pendingOrders = orders.filter(o => o.status === 'pending').length;
  const totalRevenue = orders.filter(o => o.status === 'delivered').reduce((s, o) => s + o.total, 0);
  const outOfStock = products.filter(p => getTotalStock(p) === 0).length;

  // La barra tenia 19 entradas planas y encontrar algo costaba leerlas todas.
  // Ahora: lo de todos los dias fijo arriba, y el resto en cinco mundos que se
  // abren de a uno. Caja y Tareas aparecen en los dos lados a proposito (atajo
  // arriba, lugar conceptual adentro del grupo).
  const tabsFijos = [
    { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={18} /> },
    { id: 'caja', label: 'Caja', icon: <Wallet size={18} /> },
    { id: 'tareas', label: 'Tareas', icon: <ListChecks size={18} /> },
  ];

  const gruposTabs = [
    {
      id: 'g-tienda', label: 'Tienda', icon: <Store size={18} />,
      items: [
        { id: 'products', label: 'Productos', icon: <Package size={16} /> },
        { id: 'stock', label: 'Stock & Alertas', icon: <AlertCircle size={16} /> },
        // 'Pedidos' son los de clientes; 'Compras' las que hacemos nosotros.
        { id: 'orders', label: 'Pedidos', icon: <Store size={16} /> },
        { id: 'compras', label: 'Compras', icon: <Truck size={16} /> },
        { id: 'categories', label: 'Categorías', icon: <Tag size={16} /> },
      ],
    },
    {
      id: 'g-torneos', label: 'Torneos', icon: <Trophy size={18} />,
      items: [
        { id: 'torneos', label: 'Torneos', icon: <Trophy size={16} /> },
        { id: 'tanteador', label: 'Tanteador', icon: <Swords size={16} /> },
        { id: 'inscripciones', label: 'Inscripciones', icon: <ClipboardList size={16} /> },
        { id: 'jugadores', label: 'Jugadores', icon: <UserRound size={16} /> },
        { id: 'events', label: 'Eventos', icon: <CalendarDays size={16} /> },
        { id: 'standings', label: 'Clasificación', icon: <Trophy size={16} /> },
      ],
    },
    {
      id: 'g-plata', label: 'Plata', icon: <Wallet size={18} />,
      items: [
        { id: 'caja', label: 'Caja', icon: <Wallet size={16} /> },
        { id: 'socios', label: 'Socios', icon: <Users size={16} /> },
      ],
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
    {
      id: 'g-equipo', label: 'Equipo', icon: <Users size={18} />,
      items: [
        { id: 'tareas', label: 'Tareas', icon: <ListChecks size={16} /> },
        // Quien entra al panel lo decide solo el dueno del proyecto.
        ...(currentAdmin?.role === 'owner'
          ? [{ id: 'equipo', label: 'Accesos', icon: <UserCog size={16} /> }]
          : []),
      ],
    },
  ];

  // Cuantos avisos lleva cada seccion: la barra dice donde hay algo esperando.
  const avisosPorTab: Record<string, number> = {
    inscripciones: inscNuevas,
    orders: pendingOrders,
    tareas: tareasPendientes,
  };
  const avisosDelGrupo = (g: typeof gruposTabs[number]) =>
    g.items.reduce((n, it) => n + (avisosPorTab[it.id] || 0), 0);

  const q = buscarSeccion.trim().toLowerCase();
  const resultados = q === ''
    ? []
    : [...tabsFijos, ...gruposTabs.flatMap(g => g.items)]
        .filter((it, i, arr) => arr.findIndex(x => x.id === it.id) === i)
        .filter(it => it.label.toLowerCase().includes(q));

  // Stock metrics (nativo: calculado desde los productos de Supabase)
  const stockMetrics = (() => {
    let totalUnits = 0, variantCount = 0, outOfStockVariants = 0, lowStockVariants = 0;
    for (const p of products) {
      for (const qty of Object.values(p.stockBySize)) {
        variantCount++;
        totalUnits += Math.max(0, qty);
        if (qty <= 0) outOfStockVariants++;
        else if (qty <= 3) lowStockVariants++;
      }
    }
    return { totalUnits, variantCount, outOfStockVariants, lowStockVariants };
  })();

  return (
    <div className="flex min-h-[calc(100vh-120px)]">
      {/* Sidebar overlay for mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      {/* En desktop la columna es sticky DEBAJO del nav público (h-16): antes era
          static y al scrollear se deslizaba por abajo del nav sticky y quedaba tapada.
          panelOculto = modo transmisión (pedido de Brian 2026-08-09): esconde la
          columna entera en desktop para streamear la pantalla limpia; se vuelve
          con el botón flotante de abajo a la izquierda. En mobile no aplica. */}
      <aside className={`fixed lg:sticky top-0 lg:top-16 left-0 h-full lg:h-[calc(100vh-4rem)] lg:self-start z-50 lg:z-30 w-64 bg-navy-800 text-white flex-col transition-transform lg:translate-x-0 ${panelOculto ? 'flex lg:hidden' : 'flex'} ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b border-navy-600 flex items-center justify-between">
          <span className="font-display text-xl font-bold text-lime-400">Admin</span>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-white hover:text-lime-400">
            <X size={24} />
          </button>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {(() => {
            const irA = (id: string) => { setActiveTab(id); setSidebarOpen(false); setBuscarSeccion(''); };
            const claseItem = (id: string, chico = false) =>
              `w-full flex items-center gap-3 ${chico ? 'px-3 py-2 text-[13px]' : 'px-4 py-3 text-sm'} rounded-lg font-display font-semibold transition-colors ${
                activeTab === id
                  ? 'text-lime-400 bg-navy-700 border-l-4 border-lime-400'
                  : 'text-gray-300 hover:text-white hover:bg-navy-700'
              }`;
            const Aviso = ({ n }: { n: number }) => n > 0 ? (
              <span className="ml-auto rounded-full bg-lime-400 px-2 py-0.5 text-[11px] font-bold text-navy-700">{n}</span>
            ) : null;

            return (
              <>
                <div className="px-1 pb-3">
                  <div className="flex items-center gap-2 rounded-lg border border-navy-600 bg-navy-700/60 px-3 py-2">
                    <Search size={15} className="flex-shrink-0 text-gray-400" />
                    <input
                      type="text"
                      value={buscarSeccion}
                      onChange={e => setBuscarSeccion(e.target.value)}
                      placeholder="Buscar sección…"
                      aria-label="Buscar sección del panel"
                      className="w-full min-w-0 bg-transparent text-sm text-white placeholder:text-gray-400 outline-none"
                    />
                    {buscarSeccion !== '' && (
                      <button onClick={() => setBuscarSeccion('')} aria-label="Limpiar búsqueda"
                        className="flex-shrink-0 text-gray-400 hover:text-white">✕</button>
                    )}
                  </div>
                </div>

                {q !== '' ? (
                  resultados.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-gray-400">Nada con «{buscarSeccion.trim()}»</p>
                  ) : (
                    resultados.map(it => (
                      <button key={it.id} onClick={() => irA(it.id)} className={claseItem(it.id)}>
                        {it.icon} {it.label}
                        <Aviso n={avisosPorTab[it.id] || 0} />
                      </button>
                    ))
                  )
                ) : (
                  <>
                    <div className="mb-2 space-y-1 border-b border-navy-600 pb-2">
                      {tabsFijos.map(t => (
                        <button key={t.id} onClick={() => irA(t.id)} className={claseItem(t.id)}>
                          {t.icon} {t.label}
                          <Aviso n={avisosPorTab[t.id] || 0} />
                        </button>
                      ))}
                    </div>

                    {gruposTabs.map(g => {
                      const tieneActivo = g.items.some(it => it.id === activeTab);
                      const abierto = grupoAbierto === g.id || (grupoAbierto === null && tieneActivo);
                      const avisos = avisosDelGrupo(g);
                      return (
                        <div key={g.id}>
                          <button
                            onClick={() => setGrupoAbierto(abierto ? '' : g.id)}
                            aria-expanded={abierto}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg font-display text-[13px] font-bold uppercase tracking-wide transition-colors ${
                              abierto ? 'text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-navy-700'
                            }`}
                          >
                            {g.icon} {g.label}
                            {!abierto && avisos > 0 && (
                              <span className="ml-auto rounded-full bg-lime-400 px-2 py-0.5 text-[11px] font-bold text-navy-700">{avisos}</span>
                            )}
                            <ChevronRight
                              size={15}
                              className={`${!abierto && avisos > 0 ? 'ml-1.5' : 'ml-auto'} transition-transform ${abierto ? 'rotate-90' : ''}`}
                            />
                          </button>
                          {abierto && (
                            <div className="ml-6 space-y-0.5 border-l border-navy-600 pb-1.5 pl-2">
                              {g.items.map(it => (
                                <button key={g.id + it.id} onClick={() => irA(it.id)} className={claseItem(it.id, true)}>
                                  {it.icon} {it.label}
                                  <Aviso n={avisosPorTab[it.id] || 0} />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            );
          })()}
        </nav>
        <div className="p-4 border-t border-navy-600 space-y-1">
          <button
            onClick={() => setPanelOculto(true)}
            className="hidden lg:flex w-full items-center gap-3 px-4 py-3 rounded-lg font-display text-sm font-semibold text-gray-300 hover:text-lime-400 hover:bg-navy-700 transition-colors"
            title="Esconde esta columna para transmitir la pantalla limpia"
          >
            <EyeOff size={18} /> Ocultar panel
          </button>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg font-display text-sm font-semibold text-gray-300 hover:text-red-400 hover:bg-navy-700 transition-colors"
          >
            <LogOut size={18} /> Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Botón flotante para volver del modo transmisión (discreto, abajo a la izquierda) */}
      {panelOculto && (
        <button
          onClick={() => setPanelOculto(false)}
          className="hidden lg:flex fixed bottom-4 left-4 z-40 items-center gap-2 bg-navy-800/80 hover:bg-navy-700 text-gray-300 hover:text-lime-400 text-xs font-display font-semibold px-3 py-2 rounded-full shadow-lg transition-colors"
          title="Mostrar el panel del admin"
        >
          <Eye size={14} /> Panel
        </button>
      )}

      {/* Main content */}
      <div className="flex-1 bg-gray-50 p-4 md:p-8">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center gap-4 mb-6">
          <button onClick={() => setSidebarOpen(true)} className="text-navy-700 hover:text-lime-500">
            <Menu size={24} />
          </button>
          <h1 className="font-display text-xl font-bold text-navy-700">{[...tabsFijos, ...gruposTabs.flatMap(g => g.items)].find(t => t.id === activeTab)?.label}</h1>
        </div>

        {/* Dashboard */}
        {activeTab === 'dashboard' && (
          <div className="fade-in">
            <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700 mb-6">Dashboard</h1>

            {/* Torneos primero (pedido de Brian): una carta por evento real */}
            <div className="mb-8">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-lg font-bold text-navy-700">Torneos</h2>
                <Link to="/torneos" className="text-sm font-semibold text-navy-500 hover:text-navy-700">
                  Ver página pública →
                </Link>
              </div>
              {eventosDash === null ? (
                <p className="text-sm text-gray-400">Cargando torneos…</p>
              ) : eventosDash.length === 0 ? (
                <p className="text-sm text-gray-400">Todavía no hay torneos.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {eventosDash.slice(0, 6).map(ev => (
                    <Link
                      key={ev.nombre}
                      to="/torneos"
                      className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 hover:border-lime-400 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-display font-bold text-navy-700 leading-snug">{ev.nombre}</p>
                        {ev.enVivo ? (
                          <span className="flex-shrink-0 rounded-full bg-lime-400 px-2 py-0.5 text-[11px] font-bold text-navy-700">EN VIVO</span>
                        ) : ev.terminado ? (
                          <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">Terminado</span>
                        ) : (
                          <span className="flex-shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-600">Abierto</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {ev.torneos.length === 1
                          ? `${ev.torneos[0].parejas.length} ${(ev.torneos[0].formato ?? 'grupos') === 'individual' ? 'jugadores' : 'parejas'}`
                          : `${ev.torneos.length} categorías`}
                        {' · '}{new Date(ev.ultimaFecha).toLocaleDateString('es-UY')}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Tienda: métricas en tarjetas, con el stock resumido en una línea
                (los banners gigantes de antes tapaban todo el dashboard) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              {[
                { label: 'Pedidos Pendientes', value: pendingOrders, icon: <Store size={24} />, color: pendingOrders > 0 ? 'bg-yellow-50 text-yellow-600' : 'bg-gray-50 text-gray-400' },
                { label: 'Productos', value: products.length, icon: <Package size={24} />, color: 'bg-blue-50 text-blue-600' },
                { label: 'Unidades en Stock', value: stockMetrics.totalUnits, icon: <BarChart3 size={24} />, color: 'bg-green-50 text-green-600' },
                { label: 'Variantes sin Stock', value: stockMetrics.outOfStockVariants, icon: <AlertCircle size={24} />, color: 'bg-gray-50 text-gray-500' },
              ].map((stat, i) => (
                <div key={i} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${stat.color}`}>
                    {stat.icon}
                  </div>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                  <p className="font-display text-2xl font-bold text-navy-700">{stat.value}</p>
                </div>
              ))}
            </div>
            {(stockMetrics.outOfStockVariants > 0 || stockMetrics.lowStockVariants > 0) && (
              <button
                onClick={() => setActiveTab('stock')}
                className="w-full mb-8 flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-left text-sm text-gray-600 transition-colors hover:border-navy-300"
              >
                <AlertCircle size={16} className="flex-shrink-0 text-amber-500" />
                <span className="flex-1">
                  Stock: <b>{stockMetrics.outOfStockVariants}</b> variantes sin stock · <b>{stockMetrics.lowStockVariants}</b> con stock bajo
                </span>
                <ArrowRight size={16} className="text-gray-400" />
              </button>
            )}
            {/* Recent orders */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="font-display text-lg font-bold text-navy-700 mb-4">Últimos Pedidos</h2>
              {orders.length === 0 ? (
                <p className="text-gray-400 text-sm">No hay pedidos aún</p>
              ) : (
                <div className="space-y-3">
                  {orders.slice(-5).reverse().map(o => (
                    <div key={o.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div>
                        <span className="font-display font-semibold text-navy-700 text-sm">{o.id}</span>
                        <span className="text-gray-500 text-xs ml-2">{o.customer.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-display font-bold text-navy-700 text-sm">{formatPrice(o.total)}</span>
                        <StatusBadge status={o.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stock & Alertas Tab */}
        {activeTab === 'stock' && (
          <StockDashboard products={products} onEdit={(p) => { setEditingProduct(p); setProductModal(true); }} />
        )}

        {/* Products Tab */}
        {activeTab === 'products' && (
          <div className="fade-in">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Productos</h1>
              <button
                onClick={() => { setEditingProduct(null); setProductModal(true); }}
                className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-2 px-6 rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus size={18} /> Nuevo producto
              </button>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Imagen</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden sm:table-cell">SKU</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Nombre</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden md:table-cell">Categoría</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Precio</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden sm:table-cell">Stock</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden lg:table-cell">Dest.</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden lg:table-cell">Estado</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(p => (
                      <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        {/* Foto y nombre abren el editor (pedido de Brian 2026-08-06):
                            el lápiz de Acciones quedaba lejos en pantallas anchas. */}
                        <td className="px-4 py-3 cursor-pointer" onClick={() => { setEditingProduct(p); setProductModal(true); }} title="Editar producto">
                          <img src={p.images[0] ? urlImagen(p.images[0], 160) : FALLBACK_IMG} alt={p.name} className="w-12 h-12 object-cover rounded-lg" onError={errorFoto(p.images[0])} />
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 font-mono hidden sm:table-cell">{p.sku}</td>
                        <td className="px-4 py-3 font-display font-semibold text-navy-700 text-sm cursor-pointer hover:text-lime-800 transition-colors" onClick={() => { setEditingProduct(p); setProductModal(true); }} title="Editar producto">{p.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{categoryLabel(categories, p.category)}</td>
                        <td className="px-4 py-3 font-display font-bold text-navy-700 text-sm">{formatPrice(p.price)}</td>
                        <td className="px-4 py-3 text-sm hidden sm:table-cell">
                          <span className={`font-semibold ${getTotalStock(p) === 0 ? 'text-red-500' : 'text-green-600'}`}>{getTotalStock(p)}</span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {p.isFeatured && <Star size={16} className="text-yellow-500 fill-yellow-500" />}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <div className="flex items-center gap-1">
                            {p.isOffer && <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-1 rounded-full">OFERTA</span>}
                            {p.active === false && <span className="bg-gray-100 text-gray-500 text-xs font-bold px-2 py-1 rounded-full">OCULTO</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => { setEditingProduct(p); setProductModal(true); }}
                              className="text-navy-700 hover:text-lime-500 transition-colors"
                              title="Editar"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(p.id)}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* Events Tab */}
        {activeTab === 'events' && (
          <div className="fade-in">
            <div className="flex items-center justify-between mb-6">
              <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Eventos</h1>
              <button
                onClick={() => { setEditingEvent(null); setEventModal(true); }}
                className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-2 px-6 rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus size={18} /> Agregar Evento
              </button>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Nombre</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden md:table-cell">Fecha</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden sm:table-cell">Lugar</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Categoría</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Estado</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map(evt => (
                      <tr key={evt.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-display font-semibold text-navy-700 text-sm">{evt.name}</td>
                        {/* rangoLargo y no new Date(): mostraba un día menos por UTC */}
                        <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{rangoLargo(evt.date, evt.endDate)}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 hidden sm:table-cell">{evt.location}, {evt.city}</td>
                        <td className="px-4 py-3">
                          <span className="bg-navy-700/10 text-navy-700 text-xs font-bold px-2 py-1 rounded-full capitalize">
                            {evt.category === 'tournament' ? 'Torneo' : evt.category === 'clinic' ? 'Clínica' : 'Social'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold px-2 py-1 rounded-full ${evt.status === 'upcoming' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {evt.status === 'upcoming' ? 'Próximo' : 'Pasado'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {evt.inscripcionesAbiertas && (
                              <button
                                onClick={() => { setInscEventoAtajo(evt.id); setActiveTab('inscripciones'); }}
                                title="Ver inscriptos"
                                className="text-lime-700 hover:text-lime-500 transition-colors"
                              >
                                <Users size={16} />
                              </button>
                            )}
                            <button
                              onClick={() => { setEditingEvent(evt); setEventModal(true); }}
                              className="text-navy-700 hover:text-lime-500 transition-colors"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteEventConfirm(evt.id)}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Event Modal */}
            {eventModal && (
              <EventModal
                event={editingEvent}
                uploadImage={(f) => SupabaseService.uploadImage(f, 'events')}
                onClose={() => { setEventModal(false); setEditingEvent(null); }}
                onSave={(evt) => {
                  // Solo el evento editado: re-subir la lista entera pisaba cambios de otro dispositivo.
                  void saveEvent(evt);
                  setEventModal(false);
                  setEditingEvent(null);
                }}
              />
            )}


            {/* Delete Event Confirm */}
            {deleteEventConfirm && (
              <ConfirmDialog
                title="¿Eliminar evento?"
                message={inscriptosABorrar
                  ? `Este evento tiene ${inscriptosABorrar} ${inscriptosABorrar === 1 ? 'inscripción' : 'inscripciones'}: cerrá las inscripciones en vez de borrarlo. Esta acción no se puede deshacer.`
                  : 'Esta acción no se puede deshacer.'}
                onCancel={() => setDeleteEventConfirm(null)}
                onConfirm={async () => {
                  const id = deleteEventConfirm;
                  setDeleteEventConfirm(null);
                  // removeEvent ya avisa si no se pudo (y el evento queda en la lista).
                  if (await removeEvent(id) === 'ok') toast.success('Evento eliminado');
                }}
              />
            )}
          </div>
        )}

        {/* Orders Tab */}
        {activeTab === 'orders' && (
          <div className="fade-in">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Pedidos</h1>
              <button
                onClick={() => setOrderModal(true)}
                className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-3 px-6 rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus size={18} /> Nuevo pedido
              </button>
            </div>
            {orderModal && (
              <Suspense fallback={null}>
                <AdminOrderModal
                  products={products}
                  onClose={() => setOrderModal(false)}
                  onSave={async (o) => {
                    // Pre-check: sesión vencida → avisar ANTES del toast optimista
                    // (mismo criterio que el guardado en ProductEditor).
                    if (await sesionAdminVencida()) {
                      toast.error('Tu sesión de admin venció — cerrá sesión y volvé a entrar. El pedido NO se guardó.');
                      return;
                    }
                    addOrder(o);
                    setOrderModal(false);
                    setExpandedOrder(o.id);
                    toast.success(`Pedido ${o.id} creado`);
                  }}
                />
              </Suspense>
            )}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              {orders.length === 0 ? (
                <div className="p-12 text-center text-gray-400">
                  <Store size={48} strokeWidth={1} className="mx-auto mb-3" />
                  <p className="font-display">No hay pedidos aún</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {orders.slice().reverse().map(order => (
                    <div key={order.id}>
                      <div
                        className="flex items-center justify-between px-4 md:px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                      >
                        <div className="flex items-center gap-4">
                          <ChevronDown size={16} className={`text-gray-400 transition-transform ${expandedOrder === order.id ? 'rotate-180' : ''}`} />
                          <div>
                            <span className="font-display font-bold text-navy-700 text-sm">{order.id}</span>
                            <p className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleDateString('es-UY', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 md:gap-6">
                          <span className="text-sm text-gray-500 hidden sm:inline">{order.customer.name}</span>
                          <span className="text-sm text-gray-500 hidden md:inline">{order.items.length} items</span>
                          <span className="font-display font-bold text-navy-700 text-sm">{formatPrice(order.total)}</span>
                          {/* en móvil el badge no entra (recortaba el select de estado); el detalle expandido muestra el pago igual */}
                          <span className="hidden sm:inline"><BadgePagoMP order={order} /></span>
                          <select
                            value={order.status}
                            onChange={(e) => {
                              e.stopPropagation();
                              const newStatus = e.target.value as Order['status'];
                              updateOrderStatus(order.id, newStatus);
                            }}
                            className="text-xs rounded-full px-2 py-1 border border-gray-200 focus:outline-none bg-white"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="pending">Pendiente</option>
                            <option value="confirmed">Confirmado</option>
                            <option value="shipped">Enviado</option>
                            <option value="delivered">Entregado</option>
                          </select>
                        </div>
                      </div>
                      {expandedOrder === order.id && (
                        <div className="px-4 md:px-6 pb-6 bg-gray-50">
                          <div className="grid md:grid-cols-2 gap-6 pt-4">
                            <div>
                              <h4 className="font-display font-semibold text-navy-700 mb-2">Cliente</h4>
                              <div className="space-y-1 text-sm text-gray-600">
                                <p><strong>Nombre:</strong> {order.customer.name}</p>
                                <p><strong>Tel:</strong> {order.customer.phone}</p>
                                <p><strong>Email:</strong> {order.customer.email}</p>
                                <p><strong>Dirección:</strong> {order.customer.address}, {order.customer.city}, {order.customer.department}</p>
                                {order.customer.notes && <p><strong>Notas:</strong> {order.customer.notes}</p>}
                              </div>
                            </div>
                            <div>
                              <h4 className="font-display font-semibold text-navy-700 mb-2">Productos</h4>
                              <div className="space-y-2">
                                {order.items.map((item, idx) => (
                                  <div key={idx} className="flex items-center gap-3">
                                    <img
                                      src={item.product.images[0] ? urlImagen(item.product.images[0], 160) : FALLBACK_IMG}
                                      alt={item.product.name}
                                      className="w-10 h-10 object-cover rounded"
                                      onError={errorFoto(item.product.images[0])}
                                    />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-semibold truncate">{item.product.name}</p>
                                      <p className="text-xs text-gray-500">{item.selectedSize} / {item.selectedColor} x{item.quantity}</p>
                                    </div>
                                    <span className="text-sm font-bold">{formatPrice(item.product.price * item.quantity)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {order.paymentStatus && (
                              <div>
                                <h4 className="font-display font-semibold text-navy-700 mb-2">Pago online</h4>
                                <div className="space-y-1 text-sm text-gray-600">
                                  <p><strong>Estado:</strong> <BadgePagoMP order={order} /></p>
                                  {/* El motivo a la vista: el title del badge no se ve en el celular. */}
                                  {order.requiereRevision && (
                                    <p className="text-red-700"><strong>Revisar:</strong> {order.requiereRevision}</p>
                                  )}
                                  {order.mpPaymentId && <p><strong>ID de pago MP:</strong> {order.mpPaymentId}</p>}
                                  {order.paidAt && <p><strong>Pagado:</strong> {new Date(order.paidAt).toLocaleString('es-UY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
                                  {order.paidAmount != null && <p><strong>Monto acreditado:</strong> {formatPrice(order.paidAmount)}</p>}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Categories Tab */}
        {activeTab === 'categories' && (
          <div className="fade-in">
            <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700 mb-6">Categorías</h1>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 max-w-lg">
              <div className="flex gap-2 mb-6">
                <input
                  type="text"
                  placeholder="Nueva categoría..."
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-200 focus:border-lime-400 outline-none transition-colors"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newCategory.trim()) {
                      const id = newCategory.trim().toLowerCase().replace(/\s+/g, '-');
                      if (!categories.find(c => c.id === id)) {
                        void saveCategory({ id, name: newCategory.trim(), sortOrder: categories.length + 1 });
                        setNewCategory('');
                      }
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (newCategory.trim()) {
                      const id = newCategory.trim().toLowerCase().replace(/\s+/g, '-');
                      if (!categories.find(c => c.id === id)) {
                        void saveCategory({ id, name: newCategory.trim(), sortOrder: categories.length + 1 });
                        setNewCategory('');
                      }
                    }
                  }}
                  className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold px-4 py-2 rounded-lg transition-colors"
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="space-y-2">
                {[...categories].sort((a, b) => a.sortOrder - b.sortOrder).map(cat => (
                  <div key={cat.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                    <span className="font-display font-semibold text-navy-700">{cat.name}</span>
                    <button
                      onClick={() => removeCategory(cat.id)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Clubs Tab */}
        {activeTab === 'clubs' && (
          <div className="fade-in">
            <div className="flex items-center justify-between mb-6">
              <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Clubes</h1>
              <button
                onClick={() => { setEditingClub(null); setClubModal(true); }}
                className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-2 px-6 rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus size={18} /> Agregar Club
              </button>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Nombre</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden md:table-cell">Ciudad</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">País</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden sm:table-cell">Pickleball</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clubs.map(club => (
                      <tr key={club.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-display font-semibold text-navy-700 text-sm">{club.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{club.city}</td>
                        <td className="px-4 py-3 text-sm">{club.country === 'Uruguay' ? '🇺🇾' : club.country === 'Argentina' ? '🇦🇷' : club.country === 'Chile' ? '🇨🇱' : club.country === 'Brasil' ? '🇧🇷' : '🌎'} {club.country}</td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          {club.hasPickleball && <Check size={16} className="text-green-600" />}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => { setEditingClub(club); setClubModal(true); }}
                              className="text-navy-700 hover:text-lime-500 transition-colors"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteClubConfirm(club.id)}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {clubModal && (
              <ClubModal
                club={editingClub}
                onClose={() => { setClubModal(false); setEditingClub(null); }}
                onSave={(c) => {
                  void saveClub(c);
                  setClubModal(false);
                  setEditingClub(null);
                }}
              />
            )}

            {deleteClubConfirm && (
              <ConfirmDialog
                title="¿Eliminar club?"
                message="Esta acción no se puede deshacer."
                onCancel={() => setDeleteClubConfirm(null)}
                onConfirm={() => {
                  removeClub(deleteClubConfirm);
                  setDeleteClubConfirm(null);
                }}
              />
            )}
          </div>
        )}

        {/* Announcements Tab */}
        {activeTab === 'announcements' && (
          <div className="fade-in">
            <div className="flex items-center justify-between mb-6">
              <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Anuncios</h1>
              <button
                onClick={() => { setEditingAnnouncement(null); setAnnouncementModal(true); }}
                className="bg-lime-400 hover:bg-lime-500 text-navy-700 font-display font-bold py-2 px-6 rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus size={18} /> Agregar Anuncio
              </button>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Título</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden md:table-cell">Tipo</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Activo</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase hidden sm:table-cell">Fecha</th>
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-gray-500 uppercase">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {announcements.map(ann => (
                      <tr key={ann.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-display font-semibold text-navy-700 text-sm">{ann.title}</td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                            ann.type === 'info' ? 'bg-blue-100 text-blue-700' :
                            ann.type === 'promo' ? 'bg-lime-100 text-lime-700' :
                            ann.type === 'event' ? 'bg-navy-100 text-navy-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {ann.type === 'info' ? 'Información' : ann.type === 'promo' ? 'Promoción' : ann.type === 'event' ? 'Evento' : 'Importante'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold px-2 py-1 rounded-full ${ann.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {ann.active ? 'Sí' : 'No'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 hidden sm:table-cell">
                          {new Date(ann.createdAt).toLocaleDateString('es-UY')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => { setEditingAnnouncement(ann); setAnnouncementModal(true); }}
                              className="text-navy-700 hover:text-lime-500 transition-colors"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => setDeleteAnnouncementConfirm(ann.id)}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {announcementModal && (
              <AnnouncementModal
                announcement={editingAnnouncement}
                onClose={() => { setAnnouncementModal(false); setEditingAnnouncement(null); }}
                onSave={(a) => {
                  void saveAnnouncement(a);
                  setAnnouncementModal(false);
                  setEditingAnnouncement(null);
                }}
              />
            )}

            {deleteAnnouncementConfirm && (
              <ConfirmDialog
                title="¿Eliminar anuncio?"
                message="Esta acción no se puede deshacer."
                onCancel={() => setDeleteAnnouncementConfirm(null)}
                onConfirm={() => {
                  removeAnnouncement(deleteAnnouncementConfirm);
                  setDeleteAnnouncementConfirm(null);
                }}
              />
            )}
          </div>
        )}

        {/* Inscripciones Tab (recientes + por categoría, con badge de nuevas) */}
        {activeTab === 'inscripciones' && (
          <div className="fade-in">
            <Suspense fallback={cargandoTab}>
              <AdminInscripcionesTab
                events={events}
                eventoInicialId={inscEventoAtajo}
                alVerla={() => setInscNuevas(0)}
              />
            </Suspense>
          </div>
        )}

        {/* Jugadores Tab (padrón con ficha: compras, deudas, DUPR, inscripciones) */}
        {activeTab === 'jugadores' && (
          <div className="fade-in">
            <Suspense fallback={cargandoTab}>
              <AdminJugadoresTab loadLedgerFull={loadLedgerFull} />
            </Suspense>
          </div>
        )}

        {/* Caja Tab (ventas/gastos del bot de Telegram) */}
        {activeTab === 'caja' && (
          <div className="fade-in">
            <Suspense fallback={cargandoTab}>
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
          </div>
        )}

        {/* Socios Tab (cuentas entre socios + números del negocio) */}
        {activeTab === 'socios' && (
          <Suspense fallback={cargandoTab}>
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

        {/* Blog Tab */}
        {activeTab === 'blog' && (
          <div className="fade-in">
            <Suspense fallback={cargandoTab}>
              <AdminBlogTab
                posts={posts}
                onSave={savePost}
                onDelete={removePost}
                uploadImage={(f) => SupabaseService.uploadImage(f, 'blog')}
              />
            </Suspense>
          </div>
        )}

        {/* Galería Tab (álbumes de fotos, cada uno un link de salida a Drive/Photos) */}
        {activeTab === 'galeria' && (
          <div className="fade-in">
            <Suspense fallback={cargandoTab}>
              <AdminGaleriaTab
                uploadImage={(f) => SupabaseService.uploadImage(f, 'gallery')}
              />
            </Suspense>
          </div>
        )}

        {/* Standings Tab */}
        {activeTab === 'standings' && (
          <div className="fade-in">
            <Suspense fallback={cargandoTab}>
              <AdminStandingsTab
                standings={standings}
                onSave={saveStanding}
                onDelete={removeStanding}
              />
            </Suspense>
          </div>
        )}

        {/* Torneos Tab (gestor de torneos con sync local-first a Supabase; lazy, ver import) */}
        {activeTab === 'torneos' && (
          <div className="fade-in">
            <Suspense fallback={<div className="text-navy-500 text-sm py-8 text-center">Cargando gestor de torneos…</div>}>
              <AdminTorneosTab avisar={avisarTorneos} />
            </Suspense>
          </div>
        )}

        {activeTab === 'compras' && (
          <div className="fade-in">
            <Suspense fallback={<div className="text-navy-500 text-sm py-8 text-center">Cargando compras…</div>}>
              <AdminPedidosTab
                products={products}
                adminEmail={currentAdmin?.email || ''}
                onStockChanged={refreshProducts}
              />
            </Suspense>
          </div>
        )}

        {activeTab === 'tareas' && (
          <div className="fade-in">
            <Suspense fallback={<div className="text-navy-500 text-sm py-8 text-center">Cargando tareas…</div>}>
              <AdminTareasTab adminEmail={currentAdmin?.email || ''} />
            </Suspense>
          </div>
        )}

        {activeTab === 'tanteador' && (
          <div className="fade-in">
            <Suspense fallback={<div className="text-navy-500 text-sm py-8 text-center">Cargando tanteador…</div>}>
              <AdminTanteadorTab adminEmail={currentAdmin?.email || ''} />
            </Suspense>
          </div>
        )}

        {activeTab === 'equipo' && currentAdmin?.role === 'owner' && (
          <div className="fade-in">
            <Suspense fallback={<div className="text-navy-500 text-sm py-8 text-center">Cargando equipo…</div>}>
              <AdminEquipoTab miEmail={currentAdmin.email} />
            </Suspense>
          </div>
        )}

        {/* Product editor global: se abre desde Productos y desde Stock & Alertas */}
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

        {deleteConfirm && (
          <ConfirmDialog
            title="¿Eliminar producto?"
            message="Se borra de la tienda y del catálogo. Esta acción no se puede deshacer."
            onCancel={() => setDeleteConfirm(null)}
            onConfirm={async () => {
              // Pre-check: sesión vencida → no borrar ni local ni nube, avisar claro
              // (mismo criterio que el guardado en ProductEditor).
              if (await sesionAdminVencida()) {
                setDeleteConfirm(null);
                toast.error('Tu sesión de admin venció — cerrá sesión y volvé a entrar. El producto NO se eliminó.');
                return;
              }
              removeProduct(deleteConfirm);
              setDeleteConfirm(null);
              toast.success('Producto eliminado');
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── StatusBadge helper ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Order['status'] }) {
  const styles: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    confirmed: 'bg-blue-100 text-blue-700',
    shipped: 'bg-purple-100 text-purple-700',
    delivered: 'bg-green-100 text-green-700',
  };
  const labels: Record<string, string> = {
    pending: 'Pendiente',
    confirmed: 'Confirmado',
    shipped: 'Enviado',
    delivered: 'Entregado',
  };
  return (
    <span className={`text-xs font-bold px-2 py-1 rounded-full ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// ─── ConfirmDialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ title, message, onCancel, onConfirm }: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-xl p-6 max-w-sm w-full shadow-2xl">
        <h3 className="font-display text-lg font-bold text-navy-700 mb-2">{title}</h3>
        <p className="text-gray-500 text-sm mb-6">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 bg-gray-100 hover:bg-gray-200 text-navy-700 font-display font-semibold py-2 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white font-display font-semibold py-2 rounded-lg transition-colors"
          >
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}
