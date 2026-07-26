import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { keepBackdropFilterUnprefixed } from './vite/keepBackdropFilterUnprefixed'

const r = (p: string) => resolve(__dirname, p)

export default defineConfig({
  base: '/',
  plugins: [react(), keepBackdropFilterUnprefixed()],
  // Алиасы tweb (@lib/@helpers/@environment/@config/@vendor…): островок tlottie
  // переносится из tweb 1:1 с исходными путями импортов, чтобы легко ре-синкать.
  resolve: {
    alias: {
      '@lib': r('src/lib'),
      '@helpers': r('src/helpers'),
      '@environment': r('src/environment'),
      '@config': r('src/config'),
      '@vendor': r('src/vendor'),
      '@components': r('src/components'),
      '@customEmoji': r('src/lib/customEmoji'),
      '@types': r('src/types'),
      '@': r('src'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    // Раздаём только современным браузерам (Chrome/Firefox evergreen) — не даунлевелим
    // синтаксис, output чуть меньше и быстрее парсится.
    target: 'esnext',
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
