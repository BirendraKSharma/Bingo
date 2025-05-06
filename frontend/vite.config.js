import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default {
  server: {
    proxy: {
      '/ws': {
        target: 'wss://bingo-uy9e.onrender.com',
        ws: true,
        changeOrigin: true,
        secure: false,
      }
    }
  }
};
