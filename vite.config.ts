import { defineConfig } from 'vitest/config';
import { offline } from './tools/offline-plugin.ts';

export default defineConfig({
  base: './',
  plugins: [offline()],
  test: { include: ['tests/unit/**/*.test.ts'] },
});
