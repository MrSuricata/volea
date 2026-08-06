/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
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
