import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // GitHub Pages project sites serve from /<repo>/ — CI sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  // PLAN §8 puts shipped assets in static/, not Vite's default public/.
  publicDir: 'static',
  plugins: [svelte()],
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
  },
  server: { port: 5173 },
})
