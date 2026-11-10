// The artifact viewer an agent opens on its own machine (herdr-artifact preview, SHEP-149): web/viewer/ built into one
// self-contained file, web/dist/artifact-viewer.html (its script, styles and fonts inside), so it travels beside
// herdr-artifact to machines with no web app of their own. Run after the web app's build (it empties web/dist).
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/** the one script and the one stylesheet put inside the page, the page renamed */
function oneFile(): Plugin {
  return {
    name: 'one-file',
    enforce: 'post',
    generateBundle(_o, bundle) {
      const page = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName.endsWith('index.html'))
      if (!page || page.type !== 'asset') throw new Error('no page built')
      let html = String(page.source)
      for (const [name, f] of Object.entries(bundle)) {
        if (f.type === 'chunk' && f.isEntry) {
          html = html.replace(new RegExp(`<script type="module" crossorigin src="[^"]*${f.fileName}"></script>`), () => `<script type="module">${f.code.replace(/<\/script/gi, '<\\/script')}</script>`)
          delete bundle[name]
        } else if (f.type === 'asset' && f.fileName.endsWith('.css')) {
          html = html.replace(new RegExp(`<link rel="stylesheet" crossorigin href="[^"]*${f.fileName}">`), () => `<style>${String(f.source)}</style>`)
          delete bundle[name]
        }
      }
      if (/<script[^>]+src=|<link[^>]+stylesheet/.test(html)) throw new Error('the viewer page still loads a file')
      delete bundle[page.fileName]
      this.emitFile({ type: 'asset', fileName: 'artifact-viewer.html', source: html })
    },
  }
}

export default defineConfig({
  root: at('./viewer'),
  base: './',
  plugins: [react(), tailwindcss(), oneFile()],
  resolve: { alias: { '@shared': at('./shared'), '@client': at('./src'), '@plugins': at('./plugins'), '@core': at('../core') } },
  build: {
    outDir: at('./dist'),
    emptyOutDir: false,
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
