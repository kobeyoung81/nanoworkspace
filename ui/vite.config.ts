import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { federation } from '@module-federation/vite'

// The workspace module's front end.
//
// It has no document of its own: the portal's shell loads it at runtime from
// /plugins/workspace/ and renders it inside its own React tree. React therefore comes
// from the host (`import: false`), and the stylesheet is the shell's — the page
// composes the shell's components through its context instead of shipping a second
// design system.
export default defineConfig({
  base: '/plugins/workspace/',
  plugins: [
    react(),
    federation({
      name: 'workspace',
      filename: 'remoteEntry.js',
      exposes: {
        './pages': './src/pages.tsx',
        './panels': './src/panels.tsx',
      },
      shared: {
        react: { singleton: true, import: false },
        'react-dom': { singleton: true, import: false },
        // The shell installs the translator (`initReactI18next` runs there); a
        // bundled copy would be a second, uninitialised instance and every
        // `useTranslation()` would return raw keys.
        i18next: { singleton: true, import: false },
        'react-i18next': { singleton: true, import: false },
      },
    }),
  ],
  publicDir: 'public',
  build: {
    target: 'chrome103',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: 'plugin.html' },
  },
})
