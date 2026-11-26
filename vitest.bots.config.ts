import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/bots/**/*.bot.ts'], testTimeout: 20 * 60_000 },
});
