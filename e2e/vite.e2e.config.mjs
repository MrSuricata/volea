// Config del dev server para las pruebas: la del repo + no vigilar .claude/ (otras sesiones dejan
// worktrees ahí y cada cambio forzaba un full-reload en medio de una prueba).
import { mergeConfig } from 'vite';
import base from '../vite.config.ts';

export default mergeConfig(base, {
  server: { port: Number(new URL(process.env.E2E_BASE || 'http://127.0.0.1:5311').port) || 5311, strictPort: true, host: '127.0.0.1', watch: { ignored: ['**/.claude/**', '**/e2e/**'] } },
});
