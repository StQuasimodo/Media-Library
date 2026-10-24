import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * Production builds get a strict Content-Security-Policy. It is injected only
 * for builds because the dev server needs inline HMR scripts and a websocket.
 */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: mycinema: https://image.tmdb.org",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return {
    name: 'my-cinema-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  resolve: {
    alias: {
      '@': `${here}src/renderer`,
      '@shared': `${here}src/shared`,
    },
  },
  server: {
    port: 5273,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
});
