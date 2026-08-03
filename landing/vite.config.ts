import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: (id: string): string | undefined => {
          if (id.includes('node_modules/gsap')) return 'gsap'
          if (
            id.includes('node_modules/three') ||
            id.includes('node_modules/@react-three')
          )
            return 'three'
          if (id.includes('node_modules/framer-motion')) return 'motion'
          if (id.includes('node_modules/lenis')) return 'lenis'
          return undefined
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
})