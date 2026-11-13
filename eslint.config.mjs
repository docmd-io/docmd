import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import docmdRules from './tools/eslint-rules/index.js';

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        Buffer: 'readonly',
        exports: 'writable',
        document: 'readonly',
        window: 'readonly',
        localStorage: 'readonly',
        IntersectionObserver: 'readonly',
        fetch: 'readonly',
        DOMParser: 'readonly',
        history: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        getComputedStyle: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        Worker: 'readonly',
        self: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'preserve-caught-error': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'no-useless-escape': 'off',
      'no-useless-assignment': 'off',
      '@typescript-eslint/no-unused-expressions': 'off'
    }
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/site/**', 'temp-*/**', '**/public/**']
  },
  {
    // docmd internal security rules — Phase 0 failsafe for DEVELOPMENT-BENCHMARK.md S1 and S3.
    // Promoted to 'error' after Phase 1 cleans up the surface area.
    plugins: { docmd: docmdRules },
    rules: {
      'docmd/no-unsafe-fs-read': 'warn',
      'docmd/require-verify-client': 'error'
    }
  }
];