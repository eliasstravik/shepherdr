import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { pluginCatalog } from './scripts/build-plugins.ts'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/** @plugins/<name>/<file>: a plugin's part, the human's own where theirs replaces the base one (user-plugins/, staged
 *  by scripts/build-plugins.ts), so every plugin reaching it gets the same one */
const pluginParts = (): Plugin => ({
  name: 'shepherdr-plugin-parts',
  enforce: 'pre',
  resolveId(id, importer) {
    if (!id.startsWith('@plugins/')) return null
    const rest = id.slice('@plugins/'.length)
    const mine = at(`./user-plugins/${rest}`)
    // Vite bundles imported helpers into node_modules/.vite-temp: pass this config's original root explicitly.
    const compatible = pluginCatalog(at('./')).some(plugin => plugin.name === rest.split('/')[0] && plugin.from === 'user' && plugin.on)
    return this.resolve(compatible && existsSync(mine) ? mine : at(`./plugins/${rest}`), importer, { skipSelf: true })
  },
})

// Relative base: the app works under any path (tailscale serve --set-path /shepherdr).
export default defineConfig({
  base: './',
  plugins: [pluginParts(), react(), tailwindcss()],
  resolve: { alias: { '@shared': at('./shared'), '@client': at('./src') } },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1', allowedHosts: ['.ts.net'], proxy: { '/api': { target: process.env.SHEPHERDR_API_URL || 'http://127.0.0.1:7787', ws: true } } },
})
