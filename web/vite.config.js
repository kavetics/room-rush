import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // HTTPS is required for the in-app camera on iPhone. The certificate is self-signed,
  // so the phone shows a warning once: Show Details → visit this website.
  plugins: [react(), basicSsl()],
  server: {
    host: true, // reachable from phones on the same Wi-Fi
    // During development, forward /api calls to the Room Rush server.
    proxy: { '/api': 'http://localhost:8787' },
  },
})
