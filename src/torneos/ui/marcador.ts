// Borrador de un resultado mientras se tipea (fase de grupos y llave del admin).
//
// Antes cada tecla guardaba. En la llave eso rompía la corrección: pasar de 11-7 a 11-9
// obliga a borrar el 7, el motor veía "11 a nada" como cambio de ganador y saltaba el
// "Corregir resultado… borra N" a mitad de la edición. Ahora se tipea en local y se guarda
// UNA vez (al salir de la fila, con Enter o con ✓), por el mismo camino de siempre.
// Estas funciones son puras para poder testearlas sin montar nada.

export type TextoMarcador = { a: string; b: string };

/**
 * Deja solo dígitos, máximo 2. El teclado numérico del celular igual deja pegar o
 * dictar cualquier cosa ("11 ", "7a"); ningún tanteador de pickleball pasa de 99.
 */
export function limpiarPuntos(texto: string): string {
  return texto.replace(/\D+/g, '').slice(0, 2);
}

/** '' → null (sin cargar), '07' → 7. Mismo criterio que el input viejo: vacío = null. */
export function puntosDeTexto(texto: string): number | null {
  const limpio = limpiarPuntos(texto);
  return limpio === '' ? null : Number(limpio);
}

export function textoDePuntos(puntos: number | null): string {
  return puntos === null ? '' : String(puntos);
}

export function textoDeMarcador(puntosA: number | null, puntosB: number | null): TextoMarcador {
  return { a: textoDePuntos(puntosA), b: textoDePuntos(puntosB) };
}

/** ¿El borrador cambia algo respecto de lo guardado? Si no, al salir no se guarda nada. */
export function marcadorCambio(borrador: TextoMarcador, puntosA: number | null, puntosB: number | null): boolean {
  return puntosDeTexto(borrador.a) !== puntosA || puntosDeTexto(borrador.b) !== puntosB;
}
