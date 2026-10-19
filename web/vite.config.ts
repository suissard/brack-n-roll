import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(rootDir, '..');

export default defineConfig({
  root: rootDir,
  // Chemins relatifs : le build fonctionne aussi bien à la racine d'un domaine
  // que dans un sous-répertoire GitHub Pages (https://user.github.io/repo/).
  base: './',
  plugins: [react()],
  server: {
    port: 5174,
    open: false,
    // Autorise l'import du moteur (../src) et des fixtures de test (../tests).
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: path.resolve(rootDir, 'dist'),
    emptyOutDir: true,
  },
});
