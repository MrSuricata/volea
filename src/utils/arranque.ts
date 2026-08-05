// Utilidades del arranque de la app.
//
// POR QUÉ EXISTE ESTO: toda la web esperaba a que terminaran el probe de salud de
// Supabase y las 8 consultas iniciales para recién renderizar. Esa cadena no tenía
// timeout ni manejo de error, así que un solo pedido colgado (red mala, refresh de
// token del admin reteniendo el navigator lock, Supabase frío) dejaba la pantalla
// "Cargando..." para siempre; la única salida era F5. La tienda YA sabe funcionar
// con datos vacíos o del snapshot local, así que nunca vale la pena bloquear el
// render: si los datos no llegan a tiempo, se muestra la web y entran después.

/**
 * Devuelve el valor de `promesa`, o `valorPorDefecto` si tarda más de `ms` o si falla.
 * Nunca rechaza y nunca deja un rechazo sin atender (un fallo tardío se traga en
 * silencio: el respaldo ya se entregó y en el navegador quedaría como
 * "Uncaught (in promise)" en la consola).
 */
/**
 * Ejecuta `intentar()`; si `esFallo(resultado)` da true, lo intenta UNA vez más y devuelve
 * ese segundo resultado (bueno o malo). Para conexiones que se traban: el segundo intento
 * abre un socket nuevo y suele andar. `intentar` no debe rechazar (combinar con conLimite).
 */
export async function conReintento<T>(intentar: () => Promise<T>, esFallo: (r: T) => boolean): Promise<T> {
  const primero = await intentar();
  if (!esFallo(primero)) return primero;
  return intentar();
}

// PromiseLike (no Promise): los query builders de supabase-js son thenables sin
// catch/finally, y acá solo se usa .then(onOk, onError) — alcanza y sobra.
export function conLimite<T>(promesa: PromiseLike<T>, ms: number, valorPorDefecto: T): Promise<T> {
  return new Promise<T>((resolver) => {
    let listo = false;
    const terminar = (valor: T) => {
      if (listo) return;
      listo = true;
      clearTimeout(temporizador);
      resolver(valor);
    };
    const temporizador = setTimeout(() => terminar(valorPorDefecto), ms);
    promesa.then(
      (valor) => terminar(valor),
      (error) => {
        if (!listo) console.error('[arranque] un pedido falló; sigo con el respaldo', error);
        terminar(valorPorDefecto);
      },
    );
  });
}
