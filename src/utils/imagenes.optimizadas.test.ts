import { describe, expect, it } from 'vitest';
import { ANCHOS_IMAGEN, errorImagen, esOptimizable, srcsetImagen, urlImagen } from './imagenes';
import vercel from '../../vercel.json';

const FOTO = 'https://scftuxrtflfowohiewsc.supabase.co/storage/v1/object/public/product-images/volea-air/1.png';

describe('fotos achicadas por Vercel', () => {
  it('solo pasan por el optimizador las fotos de nuestro Storage', () => {
    expect(esOptimizable(FOTO, true)).toBe(true);
    expect(esOptimizable('/products/7.jpg', true)).toBe(false);
    expect(esOptimizable('https://drive.google.com/x.jpg', true)).toBe(false);
    expect(esOptimizable('data:image/svg+xml,...', true)).toBe(false);
    expect(esOptimizable(undefined, true)).toBe(false);
  });

  it('en localhost (activo=false) la foto queda tal cual y sin srcset', () => {
    expect(urlImagen(FOTO, 640, false)).toBe(FOTO);
    expect(srcsetImagen(FOTO, 1280, false)).toBeUndefined();
  });

  it('arma la URL de /_vercel/image con la foto codificada', () => {
    expect(urlImagen(FOTO, 640, true)).toBe(`/_vercel/image?url=${encodeURIComponent(FOTO)}&w=640&q=75`);
  });

  it('el srcset corta en el ancho máximo pedido', () => {
    const s = srcsetImagen(FOTO, 640, true)!;
    expect(s.split(', ').map((p) => p.split(' ')[1])).toEqual(['160w', '320w', '640w']);
  });

  it('vercel.json autoriza exactamente los anchos y la calidad que pide el sitio', () => {
    // Vercel rechaza con 400 un w o q que no esté en la config: si alguien cambia uno
    // solo de los dos lados, TODAS las fotos caen al original (más lentas, no rotas).
    expect(vercel.images.sizes).toEqual([...ANCHOS_IMAGEN]);
    expect(vercel.images.qualities).toEqual([75]);
    expect(FOTO.startsWith('https://' + vercel.images.remotePatterns[0].hostname)).toBe(true);
  });

  it('si falla, reintenta con la original sin srcset y después va al respaldo', () => {
    // Entorno node, sin DOM: un <img> mínimo con lo que usa errorImagen.
    const attrs: Record<string, string> = { srcset: 'x 1w' };
    const img = {
      src: '',
      dataset: {} as Record<string, string>,
      removeAttribute: (n: string) => { delete attrs[n]; },
    } as unknown as HTMLImageElement;
    errorImagen(img, FOTO, 'data:respaldo');
    expect(attrs.srcset).toBeUndefined();
    expect(img.src).toBe(FOTO);
    errorImagen(img, FOTO, 'data:respaldo');
    expect(img.src).toBe('data:respaldo');
  });
});
