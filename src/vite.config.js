import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: '../',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        education: resolve(__dirname, 'education.html'),
        projects: resolve(__dirname, 'projects.html'),
        experience: resolve(__dirname, 'experience.html'),
        skills: resolve(__dirname, 'skills.html'),
        contact: resolve(__dirname, 'contact.html'),
      },
    },
  },
});
