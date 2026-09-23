// Guardado fila por fila de las listas del admin (eventos, clubes, anuncios, categorías).
//
// POR QUÉ: antes cada edición re-subía la lista ENTERA con upsert. La lista era la
// copia de ese navegador, que puede estar vieja: se cerraban las inscripciones de un
// torneo desde el celular, alguien editaba OTRO evento desde una pestaña vieja de la
// compu y el upsert de la lista entera volvía a abrirlas. Ahora se guarda solo la fila
// que se tocó, y el estado local se actualiza con estas funciones (sobre el estado más
// reciente, no sobre el arreglo que quedó capturado en el render).

/** Reemplaza la fila con el mismo id, o la agrega al final si es nueva. */
export function reemplazarOAgregar<T extends { id: string }>(lista: T[], fila: T): T[] {
  const i = lista.findIndex(x => x.id === fila.id);
  if (i < 0) return [...lista, fila];
  const copia = [...lista];
  copia[i] = fila;
  return copia;
}

/** La lista sin la fila de ese id (misma referencia si no estaba). */
export function quitarPorId<T extends { id: string }>(lista: T[], id: string): T[] {
  return lista.some(x => x.id === id) ? lista.filter(x => x.id !== id) : lista;
}

/** Cómo terminó un borrado en la nube. */
export type ResultadoBorrado = 'ok' | 'con-referencias' | 'error';

/**
 * 23503 = foreign_key_violation de Postgres: la fila tiene otras colgando (un evento
 * con inscripciones, con la FK en RESTRICT). No es un error de conexión: reintentar
 * no sirve, hay que avisar qué pasa.
 */
export function motivoBorradoFallido(
  error: { code?: unknown; message?: string } | null | undefined,
): ResultadoBorrado {
  if (!error) return 'ok';
  return error.code === '23503' ? 'con-referencias' : 'error';
}
