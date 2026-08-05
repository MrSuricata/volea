// Compresión de fotos ANTES de subirlas.
//
// POR QUÉ: el subidor mandaba la foto tal cual sale del celular (4-12 MB). Con la
// conexión justa eso es un "Subiendo..." eterno, y además el plan gratis de Supabase
// tiene 1 GB de storage TOTAL — un catálogo de fotos originales se lo come. Una prenda
// se ve idéntica a 1600px con JPEG 0.85 (~200-400 KB): 10-30× más liviana.

const LADO_MAXIMO = 1600;
const CALIDAD_JPEG = 0.85;
const UMBRAL_BYTES = 500 * 1024; // ya liviana: pasa directo, sin gastar tiempo en recomprimir

/** Escala proporcional al lado mayor. Nunca agranda. */
export function dimensionesDestino(ancho: number, alto: number, maxLado: number): { ancho: number; alto: number } {
  const mayor = Math.max(ancho, alto);
  if (mayor <= maxLado) return { ancho, alto };
  const factor = maxLado / mayor;
  return { ancho: Math.round(ancho * factor), alto: Math.round(alto * factor) };
}

/** Solo fotos pesadas. GIF (puede ser animado) y SVG nunca se tocan. */
export function hayQueComprimir(tipo: string, bytes: number): boolean {
  if (!tipo.startsWith('image/')) return false;
  if (tipo === 'image/gif' || tipo === 'image/svg+xml') return false;
  return bytes > UMBRAL_BYTES;
}

export function cambiarExtension(nombre: string, ext: string): string {
  const i = nombre.lastIndexOf('.');
  return (i > 0 ? nombre.slice(0, i) : nombre) + '.' + ext;
}

/**
 * Devuelve una versión liviana del archivo (JPEG 1600px), o el ORIGINAL tal cual si:
 * no hace falta (ya liviana / gif / svg), el navegador no puede decodificarla (p.ej.
 * HEIC fuera de Safari), o la recompresión no achicó nada. Nunca tira error: en el
 * peor caso se sube lo mismo que antes de que existiera esta función.
 */
export async function comprimirImagen(archivo: File): Promise<File> {
  if (!hayQueComprimir(archivo.type, archivo.size)) return archivo;
  try {
    // from-image: respeta la orientación EXIF (fotos de celular sacadas "de costado")
    const bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    const { ancho, alto } = dimensionesDestino(bitmap.width, bitmap.height, LADO_MAXIMO);
    const canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext('2d');
    if (!ctx) return archivo;
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', CALIDAD_JPEG));
    if (!blob || blob.size >= archivo.size) return archivo; // no mejoró: original
    return new File([blob], cambiarExtension(archivo.name, 'jpg'), { type: 'image/jpeg' });
  } catch {
    return archivo; // decodificación falló: comportamiento de siempre
  }
}
