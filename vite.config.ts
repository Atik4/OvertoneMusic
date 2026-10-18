import { defineConfig } from 'vite';

// Bind to localhost only: the app is for you, not your network.
export default defineConfig({
  server: { host: 'localhost', port: 5173, open: true },
  preview: { host: 'localhost' },
  build: { chunkSizeWarningLimit: 2000 }, // the sheet-music renderer is big; fine for a local app
});
