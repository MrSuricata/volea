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
    try {
      const { ancho, alto } = dimensionesDestino(bitmap.width, bitmap.height, LADO_MAXIMO);
      const canvas = document.createElement('canvas');
      canvas.width = ancho;
      canvas.height = alto;
      const ctx = canvas.getContext('2d');
      if (!ctx) return archivo;
      // Fondo BLANCO antes de dibujar: JPEG no tiene transparencia y sin esto un PNG
      // recortado (fondo transparente, típico de foto de catálogo) queda sobre NEGRO.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, ancho, alto);
      ctx.drawImage(bitmap, 0, 0, ancho, alto);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', CALIDAD_JPEG));
      if (!blob || blob.size >= archivo.size) return archivo; // no mejoró: original
      return new File([blob], cambiarExtension(archivo.name, 'jpg'), { type: 'image/jpeg' });
    } finally {
      bitmap.close(); // liberar YA la decodificación (puede ser enorme), pase lo que pase
    }
  } catch {
    return archivo; // decodificación falló (p.ej. HEIC fuera de Safari): comportamiento de siempre
  }
}

// ─── Fotos achicadas al mostrar ──────────────────────────────────────────────
//
// POR QUÉ: las fotos del catálogo en Storage pesan 300 KB – 3,4 MB (PNG de mockup) y
// la tienda las mostraba enteras en tarjetas de ~300px: la grilla bajaba ~18 MB. Vercel
// las redimensiona y convierte a AVIF/WebP en /_vercel/image (config "images" en
// vercel.json, que tiene que listar los mismos anchos que ANCHOS_IMAGEN) y las cachea.
// Solo para fotos de NUESTRO Storage (lo único autorizado en remotePatterns) y solo en
// el sitio publicado: en localhost ese endpoint no existe. Si falla (p.ej. se acabó el
// cupo gratis de transformaciones), errorImagen() vuelve a la foto original.

const ORIGEN_STORAGE = 'https://scftuxrtflfowohiewsc.supabase.co/storage/v1/object/public/';
export const ANCHOS_IMAGEN = [160, 320, 640, 960, 1280] as const;
export type AnchoImagen = (typeof ANCHOS_IMAGEN)[number];

function optimizadorDisponible(): boolean {
  if (!import.meta.env.PROD || typeof location === 'undefined') return false;
  return !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
}

export function esOptimizable(url: string | undefined, activo = optimizadorDisponible()): url is string {
  return activo && typeof url === 'string' && url.startsWith(ORIGEN_STORAGE);
}

export function urlImagen(url: string, ancho: AnchoImagen, activo = optimizadorDisponible()): string {
  if (!esOptimizable(url, activo)) return url;
  return `/_vercel/image?url=${encodeURIComponent(url)}&w=${ancho}&q=75`;
}

/** srcset con los anchos hasta `maximo` inclusive, o undefined si la foto no se optimiza. */
export function srcsetImagen(url: string, maximo: AnchoImagen = 1280, activo = optimizadorDisponible()): string | undefined {
  if (!esOptimizable(url, activo)) return undefined;
  return ANCHOS_IMAGEN.filter((a) => a <= maximo)
    .map((a) => `${urlImagen(url, a, true)} ${a}w`)
    .join(', ');
}

/**
 * onError para <img> con srcset: primero reintenta con la foto original (sin srcset,
 * que si no gana sobre src) y, si esa también falla, pone `respaldo`.
 */
export function errorImagen(img: HTMLImageElement, original: string | undefined, respaldo: string): void {
  img.removeAttribute('srcset');
  if (original && !img.dataset.reintento) {
    img.dataset.reintento = '1';
    img.src = original;
    return;
  }
  img.src = respaldo;
}
