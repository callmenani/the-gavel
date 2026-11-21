import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const directoryTarget = (env.VITE_DIRECTORY_API_URL || '').replace(/\/+$/, '')

  return {
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: true,
    proxy: directoryTarget
      ? {
          '/api': {
            target: directoryTarget,
            changeOrigin: true,
            secure: true,
          },
        }
      : undefined,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('firebase')) {
              return 'firebase-vendor';
            }
            if (id.includes('framer-motion') || id.includes('lucide-react')) {
              return 'icons-motion';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'react-vendor';
            }
          }
        }
      }
    },
    chunkSizeWarningLimit: 1200
  },
  };
})
