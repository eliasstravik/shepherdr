import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { writeRegistry } from './build-plugins.ts'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

writeRegistry(at('./'))

// the version this build is: Settings › About says it, and "Updated to …" after an update (SHEP-337)
const VERSION = (JSON.parse(readFileSync(at('../package.json'), 'utf8')) as { version: string }).version

// Relative base: the app works under any path (tailscale serve --set-path /shepherdr).
export default defineConfig({
  root: at('./'),
  base: './',
  define: { __SHEPHERDR_VERSION__: JSON.stringify(VERSION) },
  plugins: [react()],
  resolve: { alias: { '@shared': at('./shared'), '@client': at('./src'), '@plugins': at('./plugins'), '@core': at('../core') } },
  build: { outDir: at('./dist'), emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1', allowedHosts: ['.ts.net'], proxy: { '/api': { target: process.env.SHEPHERDR_API_URL || `http://127.0.0.1:${process.env.SHEPHERDR_PORT || 7788}`, ws: true } } },
})
