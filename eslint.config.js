import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      // Browser globals plus `process`: the app reads env vars through a
      // typeof-guarded fallback (import.meta.env in the browser, process.env
      // in Node/tests/SSR), so `process` references are intentional.
      globals: { ...globals.browser, process: 'readonly' },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      // Register eslint-plugin-react so its JSX-aware marker rules are
      // available (only the no-op "mark-as-used" rules are enabled below).
      react,
    },
    rules: {
      // Identifiers used as JSX tags (<motion.div>, <AnimatePresence>...)
      // must count as "used", otherwise no-unused-vars false-positives on
      // the framer-motion imports in every component that animates.
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', args: 'none' }],
      // Intentional empty catch blocks: network/parse failures that are
      // deliberately swallowed in zero-backend solo mode.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // Test files and tooling run in Node, where Buffer/process/etc. are defined.
  {
    files: ['tests/**/*.{js,jsx}', '*.config.{js,cjs,mjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  // Contexts, libraries and data modules legitimately export constants and
  // helpers alongside (or instead of) components. Fast-refresh's
  // only-export-components rule only makes sense for real component files.
  {
    files: ['src/contexts/**', 'src/lib/**', 'src/data/**', 'src/hooks/**'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
