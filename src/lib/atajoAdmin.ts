// Pestaña del admin que deja la barra flotante de la web pública (BarraAdmin, en App.tsx)
// para que /admin arranque ahí. Módulo aparte porque lo leen los dos lados y el panel
// es un chunk lazy que no importa App.tsx.
export const ATAJO_TAB_ADMIN = 'volea_admin_tab';
