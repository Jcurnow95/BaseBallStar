import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // PORT lets a second dev server run alongside one already on 5173.
  server: { host: true, port: Number(process.env.PORT) || 5173 },
  build: { outDir: 'dist', target: 'es2022' },
});
