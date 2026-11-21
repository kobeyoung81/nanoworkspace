import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { federation } from '@module-federation/vite'
import { splitUtilityLayers } from './vite-plugins/splitUtilityLayers'

// The workspace module's front end.
//
// It has no document of its own: the portal's shell loads it at runtime from
// /plugins/workspace/ and renders it inside its own React tree, so React comes
// from the host (`import: false`).
//
// Styles are the plugin's own Tailwind build (src/styles.css). They have to be:
// the shell's Tailwind scans the shell's sources, so any utility only this module
// uses was never emitted — the chat's page-height class was one of them, and its
// absence is what pushed the composer out of the window once the shell stopped
// carrying a copy of the chat. The palette itself still comes from the shell's
// `:root` variables, so both halves of a screen share one theme.
export default defineConfig({
  base: '/plugins/workspace/',
  plugins: [
    react(),
    tailwindcss(),
    // Base rules one layer below the shell, variants in the shell's own layer:
    // see vite-plugins/splitUtilityLayers.ts for why both are needed.
    splitUtilityLayers(),
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
