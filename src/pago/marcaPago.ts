// Marca de "este navegador mandó a pagar este pedido con Mercado Pago".
// La lee /pago/resultado para decidir si vacía el carrito: sin marca, un link
// compartido de "pago aprobado" le vaciaría el carrito a quien lo abra.
//
// Por qué localStorage y con el id del pedido: la marca original vive en
// sessionStorage ('1'), que es POR PESTAÑA. Si MP devuelve al cliente en otra
// pestaña (la app de MP en el celular, el navegador interno de Instagram,
// "abrir en el navegador"), la marca no está y el carrito queda lleno con un
// pedido que ya se pagó: el cliente lo vuelve a pagar o se confunde.
// localStorage se comparte entre pestañas del mismo sitio; guardar el id (y
// no un '1') mantiene la protección del link compartido: solo vacía el
// carrito la vuelta de ESE pedido.
//
// El storage puede no estar (Safari privado viejo, cookies bloqueadas,
// navegadores in-app): todo va en try/catch y, si falla, el carrito
// simplemente no se vacía solo (el peor caso es el de antes).

export const CLAVE_MARCA_PAGO = 'volea_pago_en_curso';

type Almacen = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const intentar = <T>(f: () => T, siFalla: T): T => {
  try { return f(); } catch { return siFalla; }
};

// Leer window.sessionStorage/localStorage ya puede tirar (SecurityError).
const almacenesDelNavegador = (): { sesion: Almacen | null; local: Almacen | null } => ({
  sesion: intentar(() => window.sessionStorage, null),
  local: intentar(() => window.localStorage, null),
});

/**
 * La llama el checkout justo antes de mandar a MP. Escribe las dos marcas:
 * la de pestaña (compatibilidad con la versión anterior de esta página) y la
 * compartida con el id del pedido.
 */
export function guardarMarcaDePago(pedido: string, almacenes = almacenesDelNavegador()): void {
  const { sesion, local } = almacenes;
  intentar(() => sesion?.setItem(CLAVE_MARCA_PAGO, '1'), undefined);
  if (pedido) intentar(() => local?.setItem(CLAVE_MARCA_PAGO, pedido), undefined);
}

/**
 * true si este navegador inició el pago del `pedido` que volvió de MP; en ese
 * caso borra las marcas (se consumen una sola vez).
 */
export function consumirMarcaDePago(pedido: string, almacenes = almacenesDelNavegador()): boolean {
  const { sesion, local } = almacenes;
  let deEsteNavegador = false;
  // Marca de pestaña: no trae el id (así la escribe hoy el checkout).
  if (intentar(() => Boolean(sesion?.getItem(CLAVE_MARCA_PAGO)), false)) {
    deEsteNavegador = true;
    intentar(() => sesion?.removeItem(CLAVE_MARCA_PAGO), undefined);
  }
  // Marca compartida: solo si es la de ESTE pedido.
  if (pedido && intentar(() => local?.getItem(CLAVE_MARCA_PAGO) === pedido, false)) {
    deEsteNavegador = true;
    intentar(() => local?.removeItem(CLAVE_MARCA_PAGO), undefined);
  }
  return deEsteNavegador;
}
