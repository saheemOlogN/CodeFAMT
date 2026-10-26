import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:6767',
        configure(proxy) {
          proxy.on('error', (_error, _request, response) => {
            if (!response || response.headersSent || response.destroyed || typeof response.writeHead !== 'function') return
            response.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '3' })
            response.end(JSON.stringify({ message: 'The server is restarting or unavailable. Wait a moment and try again.' }))
          })
        },
      },
      '/socket.io': { target: 'http://localhost:6767', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
})
