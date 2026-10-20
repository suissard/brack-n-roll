import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(rootDir, '..');

/**
 * Build « single file » : tout le JS et le CSS sont inlinés dans un unique
 * `index.html`, puis copié à la racine du dépôt. C'est ce fichier que GitHub
 * Pages sert lorsque la source de publication est la branche (option
 * « Deploy from a branch », dossier `/ (root) »).
 *
 * Le build intermédiaire reste dans `web/dist-single/` afin de ne jamais
 * écrire directement dans l'arborescence source pendant que Vite travaille.
 */
export default defineConfig({
  root: rootDir,
  // Chemins relatifs : fonctionne à la racine d'un domaine comme dans un
  // sous-répertoire GitHub Pages (https://user.github.io/repo/).
  base: './',
  plugins: [
    react(),
    viteSingleFile({
      removeViteModuleLoader: true,
    }),
    {
      name: 'copy-singlefile-to-repo-root',
      closeBundle() {
        copyFileSync(
          path.resolve(rootDir, 'dist-single/index.html'),
          path.resolve(repoRoot, 'index.html'),
        );
      },
    },
  ],
  build: {
    outDir: path.resolve(rootDir, 'dist-single'),
    emptyOutDir: true,
    copyPublicDir: false,
    // Marge très large pour garantir qu'aucune ressource ne reste externe.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
