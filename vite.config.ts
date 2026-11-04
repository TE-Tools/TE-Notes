import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'TE Notes – Dein digitales Arbeitsgedächtnis',
        short_name: 'TE Notes',
        description: 'Persönliches digitales Notizbuch von TE Digital. Alle Daten bleiben auf diesem Gerät.',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f7f6f3',
        theme_color: '#f7f6f3',
        categories: ['productivity', 'business'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Bei der Erstinstallation sofort die Kontrolle übernehmen. Updates übernimmt src/main.tsx automatisch,
        // sobald die App in den Hintergrund geht (nie mitten im Schreiben).
        clientsClaim: true,
        cleanupOutdatedCaches: true
      }
    })
  ],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2500
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts']
  }
} as never);
