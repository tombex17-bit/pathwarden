# Pathwarden

An endless 2D tower defense game that keeps earning while you are away. Build, upgrade, merge and overdrive towers on five maps (one with a new road each time, one where you build the maze), lead the Warden hero, tap enemies, cast abilities, call waves early, and prestige with optional challenges, to generated music and art drawn in code. It runs in the browser on desktop and phone, and can be installed and played offline.

**Play:** https://tombex17-bit.github.io/pathwarden/

The full design, rules and balance numbers are in [SPEC.md](SPEC.md).

## Development

Needs Node 24. Browser tests use the installed Microsoft Edge.

```sh
npm install
npm run dev          # local server with live reload
npm run check        # typecheck, lint, unit tests and build
npm run test:e2e     # browser tests
npm run bench        # simulation speed
npm run bot:ratio    # active vs idle income
npm run bot:pacing   # progression pacing (about 45 minutes)
npm run icons        # redraw the app icons
npm run deploy       # run every check, then publish
```

## Publishing

`npm run deploy` refuses to run with uncommitted changes. It runs `npm run check` and the browser tests, then pushes `dist/` to the `gh-pages` branch, which GitHub Pages serves. Players get the new version on their next load after that.

To check the live site with the browser tests:

```sh
LIVE_URL=https://tombex17-bit.github.io/pathwarden/ npx playwright test m6.spec -g "install|network"
```
