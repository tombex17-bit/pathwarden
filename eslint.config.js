import tseslint from 'typescript-eslint';

// Everything the simulation must never touch (SPEC section 14).
export const FORBIDDEN_GLOBALS = [
  'Date', 'performance', 'window', 'document', 'globalThis', 'self', 'navigator',
  'localStorage', 'sessionStorage', 'indexedDB', 'fetch', 'crypto', 'process',
  'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'requestAnimationFrame',
  'HTMLElement', 'HTMLCanvasElement', 'Path2D', 'Image', 'Audio',
];
export const FORBIDDEN_FOLDERS = ['render', 'ui', 'platform'];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'test-results', 'playwright-report'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [...FORBIDDEN_FOLDERS.flatMap((f) => [`**/${f}`, `**/${f}/**`]), '**/app', '**/app.ts', 'node:*'],
          message: 'sim/ must stay free of rendering, UI and platform code.',
        }],
      }],
      'no-restricted-globals': ['error', ...FORBIDDEN_GLOBALS],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random' }],
      'no-restricted-syntax': ['error', { selector: 'ImportExpression', message: 'No dynamic imports in sim/.' }],
    },
  },
);
