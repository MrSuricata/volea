import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
import { conLimite, conReintento } from '../utils/arranque';

// Capa de datos de la Galería: álbumes de fotos de torneos, cada uno un link de
// salida a un Google Drive/Photos externo (las fotos viven ahí; gallery_albums
// es solo el índice con marca VOLEA). Mismo patrón que torneos/publico/datos.ts
// — a propósito NO se cuelga de StoreContext ni del Promise.all de arranque de
// App.tsx: tanto la página pública (/galeria) como la pestaña de admin cargan
// esto solas, al montar, con el mismo techo de 8s + 1 reintento (conLimite +
// conReintento) para no quedar coglados si Supabase está frío o la red falla.
// La política RLS de lectura (gallery_public_read) es "using (true)" — abierta
// a cualquiera, autenticado o no — así que un único listado sirve para ambos
// consumidores; lo que distingue al admin es que además puede escribir.

const MSG_SIN_SERVICIO = 'No se pudo conectar con el servidor. Probá de nuevo en un rato.';
const TIMEOUT_MS = 8000;

export interface GalleryAlbum {
  id: string;
  title: string;
  eventDate: string | null; // 'YYYY-MM-DD'
  coverUrl: string | null;
  albumUrl: string;
  createdAt: string; // ISO timestamp
}

/** Datos editables de un álbum (id/createdAt los pone la base). */
export interface AlbumInput {
  title: string;
  eventDate: string | null;
  coverUrl: string | null;
  albumUrl: string;
}

export type ListaAlbumesResultado = { albums: GalleryAlbum[]; error: string | null };

async function cargarAlbumes(client: SupabaseClient): Promise<ListaAlbumesResultado> {
  // Más nuevo primero: por fecha del evento (las sin fecha quedan al final),
  // y a igualdad de fecha (o ambas sin fecha) por orden de carga.
  const { data: filas, error } = await client
    .from('gallery_albums')
    .select('id, title, event_date, cover_url, album_url, created_at')
    .order('event_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[galeria] no se pudo listar los álbumes', error);
    return { albums: [], error: MSG_SIN_SERVICIO };
  }
  const albums = (filas ?? []).map((f) => ({
    id: f.id as string,
    title: f.title as string,
    eventDate: (f.event_date as string | null) ?? null,
    coverUrl: (f.cover_url as string | null) ?? null,
    albumUrl: f.album_url as string,
    createdAt: f.created_at as string,
  }));
  return { albums, error: null };
}

/** Listado de álbumes (público Y admin comparten esta lectura; ver nota de arriba). */
export async function listarAlbumes(): Promise<ListaAlbumesResultado> {
  const sb = supabase;
  if (!sb) return { albums: [], error: MSG_SIN_SERVICIO };
  return conReintento(
    () => conLimite(cargarAlbumes(sb), TIMEOUT_MS, { albums: [], error: MSG_SIN_SERVICIO }),
    (r) => r.error !== null,
  );
}

// ── Escritura (admin; RLS exige is_admin() = true del lado del server) ──────

export async function crearAlbum(input: AlbumInput): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('gallery_albums').insert({
    title: input.title,
    event_date: input.eventDate,
    cover_url: input.coverUrl,
    album_url: input.albumUrl,
  });
  if (error) {
    console.error('[galeria] no se pudo crear el álbum', error);
    return false;
  }
  return true;
}

export async function actualizarAlbum(id: string, input: AlbumInput): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from('gallery_albums')
    .update({
      title: input.title,
      event_date: input.eventDate,
      cover_url: input.coverUrl,
      album_url: input.albumUrl,
    })
    .eq('id', id);
  if (error) {
    console.error('[galeria] no se pudo actualizar el álbum', error);
    return false;
  }
  return true;
}

export async function eliminarAlbum(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('gallery_albums').delete().eq('id', id);
  if (error) {
    console.error('[galeria] no se pudo eliminar el álbum', error);
    return false;
  }
  return true;
}

// ── Validación compartida por el form de admin ──────────────────────────────

/** Link de álbum válido: URL bien formada y https:// (Drive, Photos u otro host). */
export function esLinkAlbumValido(url: string): boolean {
  if (!url.startsWith('https://')) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
