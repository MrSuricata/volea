/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import path from 'path'

export default defineConfig({
  // legacy: los Smart TV traen navegadores viejos (Chromium ~60-79 en Tizen/webOS)
  // que no bancan el build moderno y muestran pantalla en blanco. Este plugin
  // agrega un bundle transpilado + polyfills que solo esos navegadores descargan;
  // en Chrome/Safari/Firefox actuales no cambia nada.
  plugins: [react(), legacy({ targets: ['chrome >= 60', 'safari >= 11', 'not dead'] })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // React y Supabase en chunks propios: no cambian entre deploys, así que el
        // navegador los reusa de la caché aunque cambie la app (antes todo iba en un
        // index de ~745 kB que se volvía a bajar entero con cada deploy). Se cargan igual
        // de entrada (los dos hacen falta para el primer dibujado): no es carga diferida.
        // framer-motion y lucide NO van acá a propósito: las features de motion bajan
        // aparte (lib/animaciones) y los íconos van repartidos en los chunks de cada página;
        // juntarlos los metería en la carga inicial.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return 'vendor-react';
          if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) return 'vendor-supabase';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 3001,
    open: false,
  },
  test: {
    environment: 'node',
    // Sin este exclude, vitest barría también .claude/worktrees/ (copia entera y
    // desactualizada del repo que deja otra sesión): la suite se corría DUPLICADA
    // (~336 tests en vez de ~168) y el gate podía mentir pasando tests viejos.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
})
