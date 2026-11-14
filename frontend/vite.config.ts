import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0', // Listen on all interfaces (IPv4 + IPv6)
    port: 8420,
    // Reached over the tailnet at http://bigmsi.tail500ddf.ts.net:8420
    allowedHosts: ['bigmsi.tail500ddf.ts.net', '.tail500ddf.ts.net'],
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:8000',
        changeOrigin: true,
      },
      '/mdserv': {
        target: process.env.VITE_MDSERV_BASE || 'http://localhost:8090',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
