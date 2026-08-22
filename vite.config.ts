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
