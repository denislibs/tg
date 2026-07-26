import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { keepBackdropFilterUnprefixed } from './vite/keepBackdropFilterUnprefixed'

export default defineConfig({
  base: '/',
  plugins: [react(), keepBackdropFilterUnprefixed()],
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react'
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'motion'
        },
      },
    },
  },
})
