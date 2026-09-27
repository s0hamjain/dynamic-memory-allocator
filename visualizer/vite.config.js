import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'

const TRACE_DIR = path.resolve(__dirname, 'traces')

/**
 * Exposes `virtual:trace-manifest`: the header of every bundled .rep trace
 * (so the library can list op counts without loading each file). Giant
 * traces are not bundled - their sizes exceed JavaScript's exact-integer range.
 */
function traceManifest() {
  const id = 'virtual:trace-manifest'
  return {
    name: 'trace-manifest',
    resolveId: (x) => (x === id ? '\0' + id : null),
    load(x) {
      if (x !== '\0' + id) return null
      const files = fs.readdirSync(TRACE_DIR).filter((f) => f.endsWith('.rep') && !f.startsWith('syn-giant'))
      const list = files.map((file) => {
        const fd = fs.openSync(path.join(TRACE_DIR, file), 'r')
        const buf = Buffer.alloc(256)
        fs.readSync(fd, buf, 0, 256, 0)
        fs.closeSync(fd)
        const [weight, ids, ops, maxAlloc] = buf.toString().split(/\s+/).map(Number)
        this.addWatchFile(path.join(TRACE_DIR, file))
        return { file, name: file.replace(/\.rep$/, ''), weight, ids, ops, maxAlloc, bytes: fs.statSync(path.join(TRACE_DIR, file)).size }
      })
      return `export default ${JSON.stringify(list)}`
    },
  }
}

export default defineConfig({
  plugins: [vue(), traceManifest()],
  resolve: { alias: { '@traces': TRACE_DIR } },
  worker: { format: 'es' },
  // Bundled .rep traces are large, lazily loaded data chunks.
  build: { chunkSizeWarningLimit: 1600 },
})
