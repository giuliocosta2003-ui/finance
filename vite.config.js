import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Vite non guarda PORT da solo: prende --port, poi questo, poi 5173. Leggerlo
  // qui serve a poter aprire una seconda istanza (l'anteprima dell'agente)
  // mentre il dev server abituale tiene gia' la 5173.
  server: { port: Number(process.env.PORT) || 5173 },

  plugins: [
    react(),
    VitePWA({
      // Il service worker si aggiorna da solo a ogni deploy (Cloudflare Pages).
      registerType: 'autoUpdate',

      // Strategia "generateSW": per ora serve solo il precache dell'app shell.
      // La politica offline vera (sola lettura in cache oppure coda di
      // scritture) si decide in fase 5; se servira' un SW custom si passa a
      // injectManifest allora, non prima.
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        // Le chiamate a Supabase NON vanno in cache: i dati finanziari
        // mostrati devono essere quelli veri, finche' l'offline non e' deciso.
        navigateFallbackDenylist: [/^\/api/],
      },

      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],

      manifest: {
        name: 'finance-app',
        short_name: 'finance',
        description: 'Finanza personale: conti, transazioni, investimenti, tasse',
        lang: 'it',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#DB0011',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },

      // Niente SW in dev (npm run dev): si prova con build + preview.
      devOptions: { enabled: false },
    }),
  ],
})
