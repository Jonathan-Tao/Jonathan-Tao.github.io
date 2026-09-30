import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

export default defineConfig({
  publicDir: 'public',
  plugins: [{
    name: 'inline-loader-css',
    transformIndexHtml(html) {
      // Keep one source for the loader while avoiding a blocking request on
      // every page. Apply this to both development and production HTML.
      return html.replace('<link rel="stylesheet" href="/loader.css" />', () => (
        `<style>${readFileSync(resolve(__dirname, 'public/loader.css'), 'utf8')}</style>`
      ));
    },
  }],
  build: {
    outDir: '../',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        projects: resolve(__dirname, 'projects.html'),
        experience: resolve(__dirname, 'experience.html'),
        contact: resolve(__dirname, 'contact.html'),
      },
    },
  },
});
