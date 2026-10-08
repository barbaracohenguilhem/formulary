import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/*
 * `host: true` binds every interface, IPv4 and IPv6. Bound to `localhost` alone, Node
 * listens only on ::1, and a phone — the iOS Simulator included — that tries
 * 127.0.0.1 first sits on a blank page for a minute before it falls back. It also
 * puts the app on the LAN, so a real iPhone reaches it at http://<mac-ip>:5178.
 */
export default defineConfig({
  root: 'frontend',
  publicDir: '../public',
  build: { outDir: '../dist', emptyOutDir: true },
  plugins: [react()],
  server: { host: true, port: 5178, strictPort: true },
  preview: { host: true, port: 4173, strictPort: true },
});
