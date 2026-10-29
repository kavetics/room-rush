import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // During development, forward /api calls to the Room Rush server.
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
