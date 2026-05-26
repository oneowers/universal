import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/aisha': {
        target: 'https://back.aisha.group',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/aisha/, ''),
      },
      '/gemini': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gemini/, ''),
      },
    },
  },
})
