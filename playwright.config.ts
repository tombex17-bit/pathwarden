import { defineConfig } from '@playwright/test';

/** Set LIVE_URL (ending in /) to run tests against the published game instead of a local build. */
const live = process.env.LIVE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  // Uses the installed Edge, so no browser download is needed.
  use: { baseURL: live ?? 'http://localhost:4179/', channel: 'msedge' },
  webServer: live ? undefined : {
    command: 'npm run build && npx vite preview --port 4179 --strictPort',
    url: 'http://localhost:4179',
    reuseExistingServer: false,
  },
});
