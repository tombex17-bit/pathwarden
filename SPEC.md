# SPEC: Pathwarden, a 2D tower defense idle game (version 1)

Status: reviewed and revised. All six milestones are built. The game is named Pathwarden.

Decisions marked **[A]** came from the interview. Those marked **[D]** are design defaults chosen here.

## 1. Summary

- **[A]** Browser game for desktop and phone, portrait and landscape. No backend.
- **[A]** One fixed path with build slots. 5 towers, 6 enemies plus a boss, 4 abilities.
- **[A]** Endless waves with prestige. Losing drops you back 5 waves.
- **[A]** Waves start themselves from the beginning. Auto-upgrade and auto-cast are earned through prestige.
- **[A]** The manual actions are building, upgrading, specializing and casting abilities. Active play earns about 2x idle gold.
- **[A]** First prestige after about 4 hours for a typical player.
- **[A]** Flat dark visual style, drawn in code.
- **[A]** Extras: sound effects, save export/import, 1x/2x/3x speed, installable and playable offline.

## 2. Terms

| Term | Meaning |
| --- | --- |
| Game second | One second of simulated time. At 3x, 3 game seconds pass per real second |
| `w` | Current wave, starting at 1 |
| `bestRun`, `bestEver` | Highest wave **cleared** this run, and across all runs |
| `N(w)` | Spawn slots in a wave: `12 + min(12, floor(w / 10))` |
| `P`, `G` | Levels of the permanent upgrades Power and Greed |

All cooldowns and durations are in game seconds unless stated otherwise.

## 3. Map

- **[D]** Logical grid: 16 wide, 9 high, origin at top left.
- Path centerline: `(0,1) → (13,1) → (13,4) → (2,4) → (2,7) → (16,7)`. Length 44 cells, width 0.8.
- 12 slots, unlocked all at once, radius 0.45 cells:
  `(3,2.5) (5.5,2.5) (8,2.5) (10.5,2.5) (4.5,5.5) (7,5.5) (9.5,5.5) (12,5.5) (14.4,2.5) (0.7,5.5) (14.5,5.5) (0.7,2.8)`
- The map never rotates. It scales to fit the available area, keeping its aspect ratio.

## 4. Waves

- A wave spawns its slots evenly over 10 game seconds: slot `i` of `n` (from 0) at `10 * i / (n - 1)`.
- A wave ends once everything has spawned and died or leaked **and** at least 24 game seconds have passed. The next wave then starts by itself.
- Lives reset to 10 at each wave start. Leaks cost 1 life, bosses cost 10.
- Wave `w` is cleared if it ends with lives above 0. Then `w` increases by 1 if **Auto-advance** is on; otherwise the same wave repeats. Auto-advance defaults to on **[D]**.
- **Losing [A]:** at 0 lives the field empties at once, `w = max(1, w - 5)`, and a new wave starts after 2 game seconds. Gold, towers, levels and cooldowns stay. The wave is not cleared.
- Every 10th wave adds one boss at 5 game seconds, alongside the normal slots.

### Formulas

```
baseHp(w)   = 14 * 1.09^(w-1)
baseGold(w) = 2  * 1.065^(w-1)
enemyHp     = baseHp(w)   * hpMult
enemyGold   = baseGold(w) * goldMult * 1.3^G * bounty     (bounty: section 7)
bossGoldMult = 0.5 * N(w)
```

### Enemies

| Enemy | First wave | Weight | HP | Gold | Speed (cells/s) | Trait |
| --- | --- | --- | --- | --- | --- | --- |
| Grunt | 1 | 6 | 1.0 | 1.0 | 2.0 | None |
| Runner | 4 | 3 | 0.6 | 0.6 | 3.2 | Fast |
| Brute | 8 | 2 | 2.0 | 2.0 | 1.3 | Slow and tough |
| Swarm | 12 | 2 | 0.3 | 0.3 | 2.2 | 3 units per slot, 0.2 s apart |
| Shielded | 18 | 2 | 1.0 | 1.3 | 1.8 | Shield of 0.35 x its HP; Beam damage bypasses it |
| Regenerator | 25 | 2 | 0.8 | 1.0 | 1.8 | Heals 2% of max HP per second |
| Boss | 10 | Every 10th | 10 | See above | 1.3 | Slows are half as strong; immune to instant kills |

Each slot picks an unlocked type by weight with a generator seeded by `(runSeed, w, attemptNumber)`, so a replay is deterministic. Shields do not recharge.

## 5. Towers

- Building costs `50 * 1.6^k`, where `k` is the number of towers built now (so 50, 80, 128, ...). A new tower is level 1.
- First-run starting gold is 60.
- Upgrade from level `L`: `20 * 1.09^L`. Levels are unlimited.
- Damage per hit: `base * L * 2^floor(L/25) * 1.4^P`.
- Selling refunds 100% of the price paid to build that tower and 70% of its upgrades, and frees the slot. A full build refund means a player can never be left unable to afford the first tower.
- Buy amounts: 1, 10, 25, Max.

| Tower | Base damage | Hits/s | Range | Behavior |
| --- | --- | --- | --- | --- |
| Bolt | 4 | 2 | 2.8 | Single target |
| Cannon | 9 | 0.5 | 2.6 | Splash radius 0.9, full damage |
| Frost | 3 | 1 | 2.4 | Splash radius 1.0; slows 25% for 2 s |
| Beam | 0.8 | 10 | 2.6 | Single target; +20% damage per second on the same target, up to +100% |
| Tesla | 5 | 0.8 | 2.5 | Chains to 2 more enemies within 1.5 cells, at 70% each jump |

All hits are instant; projectiles are drawn only. Towers target the enemy farthest along the path in range, unless the specialization says otherwise. Slows do not add up: the strongest applies, capped at 60% in total (70% during Stasis).

### Specializations [A]

At level 25 the player picks one of two, for free. It stays until the tower is sold or the player prestiges. Auto-upgrade never chooses.

| Tower | Choice A | Choice B |
| --- | --- | --- |
| Bolt | Rapid: +60% hits/s | Sniper: +60% range, +25% damage, targets highest HP |
| Cannon | Wide: splash radius x1.6 | Heavy: damage x1.6 |
| Frost | Deep chill: slow 45% | Brittle: hit enemies take +20% damage for 2 s (no stacking) |
| Beam | Focus: ramp cap raised to +200% (instead of +100%) | Split: hits 2 targets |
| Tesla | Long chain: 5 jumps | Surge: damage x1.5 |

## 6. Economy and prestige

- **Gold** resets on prestige. **Cores** are permanent.
- Prestige requires `bestRun >= 100` **and** at least 10 waves cleared this run. It is always manual and asks for confirmation.
- Cores gained: `floor(10 * 1.06^(bestRun - 100))`. The panel shows the amount beforehand.
- Prestige resets gold, towers, specializations, `w`, `bestRun`, cooldowns and the idle-rate history. It keeps Cores, permanent upgrades, `bestEver`, ability unlocks and settings, and stores the layout (below).
- Runs after the first start at `s = max(1, floor(0.5 * bestEver))` with gold `20 * N(s) * baseGold(s) * 1.3^G`.

| Permanent upgrade | Cost in Cores | Effect |
| --- | --- | --- |
| Power (unlimited) | `ceil(5 * 1.5^P)` | x1.4 tower damage per level |
| Greed (unlimited) | `ceil(5 * 1.5^G)` | x1.3 gold per level |
| Auto-upgrade (once) | 5 | See below |
| Auto-cast (once) | 10 | See below |

**Layout:** when prestige is confirmed, the game records the tower type in each slot. A player build or sale on a slot removes that slot's entry, so a sold tower is never rebuilt. An entry only applies while its slot is empty.

**Auto-upgrade:** once per game second, if the first unfilled layout entry (lowest slot index) is affordable, build it. Otherwise buy the cheapest affordable tower level. Can be switched off.

**Auto-cast:** casts Meteor, Stasis and Smite at 2x their cooldown. It targets the point on the path covering the most enemies (Smite: the highest-HP enemy). It never casts Bounty Mark. Can be switched off.

## 7. Abilities [A: cooldowns only]

Unlocked by `bestEver`. Select by tap, click or keys 1-4, then choose a point; right-click, Esc or tapping the ability again cancels. Cooldowns continue between waves but not while the game is closed or hidden.

Formation DPS is the sum of `damage per hit * hits/s` for all towers, including specialization changes to damage, rate and target count (Split counts 2 targets). It excludes range, splash, chain, ramp and Brittle.

- Ability damage hits shields first and gets Brittle's +20%. Smite's 30% threshold uses HP only and its kill ignores shields.
- Meteor and Stasis can be cast on any map point while at least one enemy is alive. Bounty Mark can be cast at any time, because strong towers often leave the field empty between spawns. Smite needs an enemy within 1.0 cell. Without a valid target nothing is cast and no cooldown is spent. Auto-cast follows the same rules.

| Ability | Unlock | Cooldown | Effect |
| --- | --- | --- | --- |
| Meteor | Start | 40 | 1 s of formation DPS to each enemy within 1.8 cells |
| Stasis | Clear 10 | 60 | 70% slow within 2.0 cells for 5 s |
| Bounty Mark | Clear 20 | 20 | Zone of radius 1.2 for 8 s. Every enemy that touches it is marked and pays `bounty = 2.25` when killed; otherwise 1. Marks do not stack |
| Smite | Clear 35 | 45 | Kills one non-boss enemy below 30% HP; otherwise (including bosses) deals 3 s of formation DPS to it |

Bounty Mark raises income directly. The other three help hold higher waves, which raises income near the point where the formation starts to lose.

## 8. Active and idle rewards

- **Ratio [A]:** active divided by idle gold per game hour at **equal speed**, towers unchanged, must be **1.8-2.2x** while farming waves the formation clears. With auto-advance on near the losing point, the geometric mean must be **at most 3.0x**, because abilities hold higher waves there.
- Tuning knobs: `bountyMult` (2.25), then Meteor and Smite strength.
- **[D]** Speed is free to use and raises active and idle income alike. Offline always uses the 1x rate, so 3x does not boost it.
- Idle means open and visible with no input; gold accrues and waves continue.
- **Offline [A]:** on return, pay `0.5 * idleRate * min(elapsed, 8 h)`. Waves do not advance.
- `idleRate` is base gold (bounty treated as 1) divided by game seconds over the last 20 finished waves, won or lost. It is 0 until one wave finishes. Elapsed is real time and the speed setting is ignored.
- **Hidden tab or locked phone [A]:** simulation pauses on `visibilitychange` to hidden and the same offline rule applies on return. The wave resumes where it paused. The same applies to any gap of more than 5 real seconds between frames, such as a laptop going to sleep without a hidden event.
- Negative elapsed time pays 0. Moving the device clock forward is not policed.
- A summary of gold and time is shown when elapsed is at least 60 s; below that, gold is added silently.

## 9. Pacing targets

| Target | Value |
| --- | --- |
| First prestige | 4 real hours at 1x, accepted 3-5 (median of 5 seeds), with the Typical bot |
| Idle only | Wave 100 in at most 10 game hours, buying but using no abilities |
| Wave 25 / 50 | Between 8 and 20 / 20 and 60 game minutes |
| Later runs | Over 30 simulated prestiges `bestEver` rises at least once in every 10; no run needs more than 12 game hours |

**Typical bot (exact policy)**
- 1x throughout, alternating 10 minutes active and 10 minutes idle. Idle means no buying and no casting, except purchased automation.
- Active: every 5 s, buy the cheapest level; build the next tower instead when its price is at most 1.5x the cheapest level. Build in slot-list order: Bolt, Cannon, Bolt, Beam, Tesla, Frost, Bolt, Beam, Cannon, Tesla, Beam, Bolt.
- Specializations: Rapid, Heavy, Brittle, Focus, Surge.
- Casting: Meteor when the wave is past 7 s and Stasis past 9 s, on the enemy with the most neighbors; Bounty Mark at (1.2, 1) between 1 and 3 s; Smite past 7 s on the highest-HP enemy.
- Prestige once `bestRun` is at least 100 and has not risen for 40 game minutes. Buy Auto-upgrade, then Auto-cast, then the cheaper of Power and Greed (Power on ties).
- Idle-only bot: same buying, always on, no abilities.

**Evidence.** A throwaway path-aware model with these numbers (5 seeds, 0.1 s steps) gave wave 25 at 0.17 h, wave 50 at 0.42-0.43 h and wave 100 at 4.0-4.7 h for the Typical bot, 7.4 h for idle-only, a steady ratio of 1.88-1.96x and a near-losing geometric mean of 2.5x. Later runs were only checked with a coarser model, which predicted steady growth over 120 prestiges. The real game may differ, so M5 re-measures. Pacing knobs, in order: Meteor and Smite strength, `baseGold` growth, upgrade-cost growth, `baseHp` growth. Any tuned value is written back here.

**Measured in the real game (M5, no tuning needed).** Typical bot, 5 seeds: wave 25 at 10 min, wave 50 at 25-26 min, prestige possible at 2.4-4.1 h (median 3.3 h). Idle-only: wave 100 at 7.5 h. Over 30 prestiges (2 seeds) the best wave rose from 109 to 309, with runs of 1.2-5.1 h. Active vs idle with auto-cast on: 1.87-1.98x farming, 2.11x near the losing point.

## 10. Large numbers

Values must work past the 1.8e308 limit of normal numbers.

- Gold, costs, Cores and displayed HP use `break_infinity.js`.
- Enemy HP in the simulation is a fraction from 0 to 1. A hit removes `10^(log10 damage - log10 maxHp)`, clamped to 1. Logs are recomputed whenever anything affecting damage or HP changes (build, sell, level, specialization, permanent upgrade, prestige, wave), so hot loops use normal numbers.
- Display: plain below 1,000; then K, M, B, T; then scientific with 2 decimals (`1.23e45`).

## 11. Saving

- `localStorage`, versioned JSON, saved every 10 real seconds, on hidden/pagehide, and on prestige, import and settings changes.
- Saved: schema version, timestamp, gold, Cores, upgrades, towers with specializations and amounts paid, layout, `w`, records, cooldowns, idle-rate history, seed, attempt number, settings. The live wave is saved too (enemies, unspawned slots, wave time, lives, zones), and a reload resumes it. Restarting a wave would let a refresh repeat its gold or avoid a loss.
- The previous valid save is kept as a backup. If the main save is corrupt, load the backup; if both are, show a message offering import or new game. Never overwrite a corrupt save silently.
- **Export/import [A]:** base64 JSON with a checksum. Import validates everything before replacing anything, then asks for confirmation. Bad text changes nothing.
- Old schema versions are migrated step by step. Newer ones are refused with a message.
- Only one tab runs at a time, using the Web Locks API; other tabs show "Running in another tab" and never save. Without `navigator.locks` (such as plain http on a LAN), the game runs and shows a warning instead.
- If storage is unavailable, play continues with a visible warning that progress will not be kept.

## 12. Visual design [A: flat dark]

| Role | Color |
| --- | --- |
| Background / panel / path | `#12161F` / `#1B2130` / `#2A3347` |
| Text / muted text | `#E8ECF4` / `#9AA6BD` |
| Bolt, Cannon, Frost, Beam, Tesla | `#F4C95D`, `#F2845C`, `#6EC5FF`, `#E06CF0`, `#8C8CFF` |
| Enemies / boss | `#E5566D` / `#FF2E55` |
| Gold / Cores / success | `#FFD66B` / `#57E0B5` / `#6BD68A` |

- Only flat fills and 2 px outlines. No gradients, glow, textures, shadows or image files. App icons are drawn in code and captured as PNG by a Playwright script.
- Each tower and enemy has a distinct silhouette, so color is never the only cue. Enemies: circle, triangle, square, small dots, hexagon with ring, plus shape, large octagon.
- System font, at least 14 px on phones. Text contrast at least 4.5:1. Touch targets at least 44 px.
- Short effects: hit flash 80 ms, death fade 150 ms. No screen shake. Effects respect `prefers-reduced-motion`.
- Max 1 range circle and 1 target preview shown at a time. At most 8 UI elements overlay the map.

### Layout

- Landscape and desktop: map left, control panel right (280-360 px). Portrait: map on top at full width, panel below.
- Must work from 360x640 to 1920x1080 without page scroll; the panel itself may scroll. Rotation keeps all state.
- Top bar: wave, lives, gold, Cores, speed, menu. Panel: tower list, or the selected tower. Ability bar always visible, within thumb reach in portrait.
- Portrait slots are small, so a tap selects the nearest slot within 22 px.
- Menu: prestige, permanent upgrades, export/import, sound, auto-advance, reset (confirmed).

## 13. Sound [A]

Synthesized with Web Audio, no files: shot (limited to 8 per second), death, leak, ability, purchase, boss, prestige. Volume and mute are saved. Audio starts only after the first user input.

- **As built (M6):** deaths and purchases are also limited to 8 per second, leaks to 4. A boss sound plays when a boss wave starts. Volume defaults to 60% and is set in the menu in 5% steps. Muted or at 0%, no sound is created at all. Saves became version 3, and older saves get sound on at 60%.

## 14. Architecture

```
src/
  sim/      pure game rules; no DOM, Canvas, Date, Math.random or timers
  config/   every balance number from this spec
  render/   Canvas drawing; reads state, never changes it
  ui/       DOM panels; sends commands
  platform/ save, clock, audio, tab lock, service worker
  app.ts    wires everything together
tests/      unit tests, bots, browser tests
```

- `step(state, commands)` advances exactly 1/30 game second. Same seed and commands give the same state.
- The UI only sends typed commands: `build`, `upgrade`, `specialize`, `sell`, `cast`, `prestige`, `buyPermanent`, `setOption`. Invalid ones are ignored and return a reason.
- The loop accumulates real time x speed and runs at most 12 steps per frame; surplus is dropped. Drawing interpolates between steps.
- The simulation emits events (hit, death, leak, ...) that rendering and sound consume.
- ESLint forbids `sim/` from importing `render`, `ui` or `platform`, and from using `Date`, `Math.random`, DOM globals or timers (`no-restricted-globals`, `no-restricted-properties`).
- Performance: at most 0.1 ms average per simulation step with 72 enemies, a boss and 12 towers in the Node benchmark. 3x needs 90 steps per second, checked with Playwright at 4x CPU slowdown.
- The build output is static files in `dist/`, to be hosted on any HTTPS static host. Install and offline play need HTTPS or localhost. Publishing is a separate step that needs approval.
- **Publishing (as built):** GitHub Pages at `https://tombex17-bit.github.io/pathwarden/`, served from the `gh-pages` branch. `npm run deploy` runs every check and browser test, then pushes the build there.
- **Offline (as built, M6):** a small build plugin (`tools/offline-plugin.ts`) writes `sw.js` listing every built and public file, instead of `vite-plugin-pwa`, so no extra library is needed. Files are served from the cache first. The cache name changes whenever any file changes, so a new version is fetched in the background and used from the next load. Icons are drawn in code by `npm run icons` (`tools/make-icons.mjs`).

## 15. Libraries

Allowed: TypeScript, Vite, Vitest, ESLint (with typescript-eslint), Playwright, `break_infinity.js`, `vite-plugin-pwa`. No UI framework or game engine; anything else needs approval.

## 16. Milestones

Build in order. Each is playable and stays green before the next. `npm run check` means typecheck, lint, unit tests and build; every milestone must pass it. Screenshot checks: Claude captures with Playwright, then compares each image with section 12 item by item.

### M1. One tower, one enemy, waves
Scaffold, path, slots, Bolt, Grunt, waves, lives, fall-back, minimal drawing.
- Accept: waves run by themselves; Bolt kills Grunts; losing drops 5 waves; same seed gives the same result; 24 s minimum holds; `sim/` stays isolated.
- Check: `npm run check`; unit tests for each rule, including `w < 6`; a lint fixture that must fail for each forbidden import or global; `npm run test:e2e -- m1` opens the game, builds a tower, and sees a kill with no console errors.

### M2. Economy, all towers and enemies
Gold, upgrades, selling, specializations, boss, all content, large numbers.
- Accept: every formula in sections 4-5 matches; a leaked boss loses the wave; selling the only tower never leaves the player stuck; the simulation works at wave 10,000.
- Check: `npm run check`; table-driven formula tests; one behavior test per tower, specialization and enemy; a build-sell-build test from 60 gold; a wave-10,000 hit, kill and gold test; a damage-refresh test after each change in section 10; `npm run bench` fails above 0.1 ms.

### M3. Manual actions
Four abilities, mouse, keyboard and touch input, basic portrait and landscape layout.
- Accept: each ability matches section 7; cancel and invalid targets never spend a cooldown; income ratios meet section 8; the game is usable at 360x640 and 640x360.
- Check: `npm run check`; unit tests per ability rule; `npm run bot:ratio`, which exits non-zero outside section 8's limits; `npm run test:e2e -- m3` casts by mouse, key and touch, and checks both phone sizes for page scroll.
- `bot:ratio`: 2 seeds x 2 game hours x 2 bots, using the 12 towers of section 9's build order, `bestEver` 99, no buying, casting as in section 9. Formation level / fixed wave with auto-advance off: 20/13, 30/13, 50/38, 60/43, 70/48, 90/63 (each result in 1.8-2.2). Then the same levels starting at waves 35, 35, 60, 65, 70, 85 with auto-advance on (geometric mean at most 3.0). Time limit 20 minutes.

### M4. Idle, saving, speed
Offline gold, hidden-tab pause, saves, export/import, tab lock, 1x/2x/3x.
- Accept: every rule in sections 8 and 11 holds; 3x gives the same states as 1x for the same steps.
- Check: `npm run check`, with named tests for:
  - fake-clock times of 0 s, 59 s, 60 s, 8 h, 9 h and negative, and frame gaps of 4 s and 8 h without a hidden event
  - `idleRate`: 0 before the first wave, 20-wave window, bounty excluded, speed ignored
  - cooldowns and wave frozen while hidden; 1x and 3x state equality
  - save round trip, including mid-wave and gold above 1e308; reload gives no extra gold and no escape from a loss
  - corrupt main save, both saves corrupt (nothing overwritten), malformed import, newer schema, a synthetic v0 migration fixture, backup rotation, storage unavailable, missing Web Locks
  - `npm run test:e2e -- m4`: real visibilitychange pause and pay, reload, export/import, and a second tab that never saves

### M5. Endless and prestige
Prestige, permanent upgrades, head start, auto-upgrade, auto-cast, balance.
- Accept: section 9 targets pass; prestige keeps and resets exactly the listed items; auto-upgrade and auto-cast follow section 6; ratios still meet section 8 with auto-cast on for both bots.
- Check: `npm run check`, with unit tests for both prestige conditions, Core and head-start formulas, a keep/reset test comparing every state field with an explicit list, layout rules (sold slot, occupied slot, unaffordable build), and auto-cast never casting Bounty Mark; `npm run bot:pacing` (5 seeds for the first run, 2 seeds x 30 prestiges, time limit 45 minutes) exits non-zero if any section 9 target fails; `npm run bot:ratio -- --autocast`.

### M6. Visual polish, sound, install
**Measured (M6):** 3x at 4x CPU slowdown ran 90 steps per second on the crowded benchmark field. Edge reports no installability errors.
Full visual design, layouts, sound, installable offline app.
- Accept: section 12 holds at 360x640, 640x360, 768x1024 and 1920x1080; the game is installable and loads with no network; sounds obey mute; 3x holds on a slow device.
- Check: `npm run check`; `npm run test:e2e -- m6` covers page scroll, 44 px targets, 14 px text, contrast, palette-only drawing colors, rotation keeping state, reduced motion, mute and volume surviving reload, no audio before input, manifest with 192 and 512 px icons, service worker scope, offline reload, and at least 85 steps per second at 3x with 4x CPU slowdown; Playwright screenshots of early game, boss, ability targeting and prestige at all four sizes, compared with section 12.

## 17. Out of scope for version 1

Multiplayer, accounts, cloud saves, leaderboards, payments, ads, analytics, extra maps, generated paths, player-built mazes, hero tower, tapping enemies, tower boosts, manual wave calls, native apps, music, translation (English only), custom art or purchased assets, cheat prevention.
