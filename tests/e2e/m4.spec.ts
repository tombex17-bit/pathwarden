import Decimal from 'break_infinity.js';
import { expect, test, type Page } from '@playwright/test';
import { defaultSettings } from '../../src/platform/settings';
import { SAVE_VERSION, encode, exportText } from '../../src/platform/save';
import { BACKUP_KEY, MAIN_KEY } from '../../src/platform/save-store';
import { createState } from '../../src/sim/sim';
import type { State } from '../../src/sim/types';
import { openPlainTab } from './plain-edge';
import { SIZES, clickSlot, collectErrors, pageScrolls } from './helpers';

const HOUR = 3600_000;

/** Wave 30, everything unlocked, 1,000 base gold per game second. */
function game(): State {
  const s = createState(1, 30);
  s.bestEver = s.bestRun = 29;
  s.gold = new Decimal(5000);
  s.history = [{ gold: new Decimal(24_000), ticks: 720 }];
  return s;
}

/** Puts saves in place before the page's first load; later reloads keep what the game wrote. */
async function seed(page: Page, entries: Record<string, string>): Promise<void> {
  await page.addInitScript((items) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
  }, entries);
}

const saved = (s: State, agoMs = 0): string => encode(s, defaultSettings(), Date.now() - agoMs);
const stored = (page: Page, key = MAIN_KEY): Promise<string | null> => page.evaluate((k) => localStorage.getItem(k), key);

/** Parses shown gold such as "5000", "1.23K" or "1.80M". */
async function gold(page: Page): Promise<number> {
  const shown = await page.locator('#gold').innerText();
  return parseFloat(shown) * ({ K: 1e3, M: 1e6, B: 1e9 }[shown.slice(-1)] ?? 1);
}

test('pauses while really hidden, pays on return, and saves', async ({ baseURL }) => {
  const tab = await openPlainTab(baseURL!);
  try {
    const visibility = (): Promise<string> => tab.evaluate('document.visibilityState');
    const tick = (): Promise<number> => tab.evaluate(`JSON.parse(localStorage.getItem('${MAIN_KEY}')).state.tick`);
    const text = (id: string): Promise<string> => tab.evaluate(`document.getElementById('${id}')?.textContent ?? ''`);

    // Start from the prepared save. Reloading would first save the fresh game over it, so block that once.
    // Edge starts slowly while other tests run.
    await expect.poll(() => text('gold'), { timeout: 30_000 }).toBe('60');
    await tab.evaluate(`{
      const text = ${JSON.stringify(saved(game()))};
      localStorage.setItem('${MAIN_KEY}', text);
      Storage.prototype.setItem = () => undefined;
      location.reload();
    }`);
    await expect.poll(() => text('wave'), { timeout: 30_000 }).toBe('30');
    await tab.evaluate("window.log = []; document.addEventListener('visibilitychange', () => log.push(document.visibilityState)); 0");
    // Let the game play a few frames first, so there is progress to freeze.
    await tab.evaluate('new Promise((done) => { let n = 0; const f = () => (++n >= 10 ? done(0) : requestAnimationFrame(f)); requestAnimationFrame(f); })');

    await tab.hide();
    await expect.poll(visibility).toBe('hidden');
    const before = await tick();
    expect(before).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    expect(await tick()).toBe(before);
    // Two hours pass.
    await tab.evaluate('{ const real = Date.now; Date.now = () => real() + 2 * 3600000; } 0');
    await tab.show();
    await expect.poll(visibility).toBe('visible');
    expect(await tab.evaluate('log.join()')).toBe('hidden,visible');
    await expect.poll(() => text('away-text')).toMatch(/^You were away for 2 h 0 min and earned 3\.60M gold\.$/);
    expect(await text('gold')).toMatch(/^3\.6\dM$/);
    // Play goes on from where it stopped.
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    const after = await tick();
    expect(after).toBeGreaterThan(before);
    // About 11 s of play at 30 steps per second, not the 23 s since hiding.
    expect(after - before).toBeLessThan(15 * 30);
  } finally {
    await tab.close();
  }
});

test('pays for closed time on load, capped at 8 h', async ({ page }) => {
  await seed(page, { [MAIN_KEY]: saved(game(), 9 * HOUR) });
  await page.goto('./');
  await expect(page.locator('#away-text')).toHaveText(/^You were away for 9 h 0 min and earned 14\.40M gold\.$/);
});

test('a reload keeps the game and continues the same wave', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await clickSlot(page, 0);
  await page.locator('[data-tower=bolt]').click();
  await page.locator('#speed').click();
  await expect(page.locator('#speed')).toHaveText('2x');
  await page.locator('#auto-advance').uncheck();
  await page.waitForTimeout(1500);
  const tickBefore = (JSON.parse((await stored(page))!) as { state: { waveTick: number } }).state.waveTick;
  await page.reload();
  await expect(page.locator('#speed')).toHaveText('2x');
  await expect(page.locator('#auto-advance')).not.toBeChecked();
  await clickSlot(page, 0);
  await expect(page.locator('#panel-title')).toHaveText('Bolt, level 1');
  const after = JSON.parse((await stored(page))!) as { state: { waveTick: number; attempt: number } };
  expect(after.state.waveTick).toBeGreaterThan(tickBefore);
  expect(after.state.attempt).toBe(1);
  await expect(page.locator('#away')).toBeHidden();
  expect(errors).toEqual([]);
});

test('speed cycles 1x, 2x, 3x', async ({ page }) => {
  await page.goto('./');
  for (const label of ['1x', '2x', '3x', '1x']) {
    await expect(page.locator('#speed')).toHaveText(label);
    await page.locator('#speed').click();
  }
});

test('exports, imports, and refuses bad text', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await expect(page.locator('#gold')).toHaveText('60');
  await page.locator('#menu-open').click();
  const own = await page.locator('#export-text').inputValue();
  expect(own).toMatch(/^TD1\./);

  for (const bad of ['', 'nonsense', own.slice(0, -1), `${own}x`]) {
    await page.locator('#import-text').fill(bad);
    await page.locator('#import-check').click();
    await expect(page.locator('#import-message')).toHaveText('This text is not a valid save. Nothing was changed.');
    await expect(page.locator('#import-confirm')).toBeHidden();
  }
  const newer = exportText(saved(game()).replace(`"v":${SAVE_VERSION}`, `"v":${SAVE_VERSION + 1}`));
  await page.locator('#import-text').fill(newer);
  await page.locator('#import-check').click();
  await expect(page.locator('#import-message')).toHaveText('This save is from a newer version of the game.');

  // Ability keys must not act while typing in the menu.
  await page.locator('#import-text').press('1');
  await expect(page.locator('[data-ability=meteor]')).toHaveAttribute('aria-pressed', 'false');

  // Exported a day ago: importing pays nothing for that time.
  await page.locator('#import-text').fill(exportText(saved(game(), 24 * HOUR)));
  await page.locator('#import-check').click();
  await expect(page.locator('#import-message')).toHaveText('Wave 30, best wave 29, 5.00K gold. Replace your current game?');
  await page.locator('#import-no').click();
  await expect(page.locator('#import-confirm')).toBeHidden();
  await expect(page.locator('#wave')).toHaveText('1');
  await page.locator('#import-check').click();
  await page.locator('#import-yes').click();
  await expect(page.locator('#wave')).toHaveText('30');
  await expect(page.locator('#away')).toBeHidden();
  expect(await gold(page)).toBeLessThan(6000);
  await page.reload();
  await expect(page.locator('#wave')).toHaveText('30');
  expect(errors).toEqual([]);
});

test('reset needs confirming', async ({ page }) => {
  await seed(page, { [MAIN_KEY]: saved(game()) });
  await page.goto('./');
  await page.locator('#menu-open').click();
  await page.locator('#reset').click();
  await page.locator('#reset-no').click();
  await expect(page.locator('#wave')).toHaveText('30');
  await page.locator('#reset').click();
  await page.locator('#reset-yes').click();
  await expect(page.locator('#wave')).toHaveText('1');
  await expect(page.locator('#gold')).toHaveText('60');
});

test('a second tab never saves, and takes over when the first closes', async ({ context }) => {
  const first = await context.newPage();
  await seed(first, { [MAIN_KEY]: saved(game()) });
  await first.goto('./');
  await expect(first.locator('#wave')).toHaveText('30');
  const second = await context.newPage();
  const errors = collectErrors(second);
  await second.addInitScript(() => {
    const w = window as unknown as { writes: number };
    w.writes = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(k: string, v: string) {
      w.writes++;
      original.call(this, k, v);
    };
  });
  await second.goto('./');
  await expect(second.locator('#blocker-title')).toHaveText('Running in another tab');
  await expect(second.locator('#blocker-menu')).toBeHidden();
  // Longer than the 10 s between saves, plus the events that also save.
  await second.waitForTimeout(11_000);
  await second.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await second.evaluate(() => (window as unknown as { writes: number }).writes)).toBe(0);
  await first.close();
  await expect(second.locator('#blocker')).toBeHidden();
  await expect(second.locator('#wave')).not.toHaveText('1');
  expect(errors).toEqual([]);
});

test('a damaged save falls back to the backup with a notice', async ({ page }) => {
  await seed(page, { [MAIN_KEY]: 'damaged', [BACKUP_KEY]: saved(game()) });
  await page.goto('./');
  await expect(page.locator('#wave')).toHaveText('30');
  await expect(page.locator('#warning')).toHaveText('The last save was damaged, so an earlier one was loaded.');
});

test('two damaged saves overwrite nothing and offer a choice', async ({ page }, info) => {
  await seed(page, { [MAIN_KEY]: 'bad', [BACKUP_KEY]: 'worse' });
  await page.goto('./');
  await expect(page.locator('#blocker-title')).toHaveText('Your save is damaged');
  await page.waitForTimeout(11_000);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await stored(page)).toBe('bad');
  expect(await stored(page, BACKUP_KEY)).toBe('worse');
  await page.screenshot({ path: info.outputPath('damaged.png') });
  await page.locator('#blocker-menu').click();
  await expect(page.locator('#export-section')).toBeHidden();
  await page.locator('#reset').click();
  await page.locator('#reset-yes').click();
  await expect(page.locator('#blocker')).toBeHidden();
  await expect(page.locator('#wave')).toHaveText('1');
  expect(await stored(page, 'tdi.damaged')).toBe('bad');
});

test('works with a warning when storage is unavailable', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
  });
  await page.goto('./');
  await expect(page.locator('#warning')).toContainText('progress will not be kept');
  await clickSlot(page, 0);
  await page.locator('[data-tower=bolt]').click();
  await expect(page.locator('#panel-title')).toHaveText('Bolt, level 1');
  expect(errors).toEqual([]);
});

test('works with a warning when Web Locks are missing', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
  await page.goto('./');
  await expect(page.locator('#warning')).toContainText('Use only one tab');
  await expect(page.locator('#gold')).toHaveText('60');
  expect(errors).toEqual([]);
});

test('specializing works, and all four abilities can be cast', async ({ page }) => {
  const errors = collectErrors(page);
  const s = game();
  s.bestEver = 40;
  s.gold = new Decimal(1e9);
  await seed(page, { [MAIN_KEY]: saved(s) });
  await page.goto('./');
  // Abilities first: once the strong tower stands, enemies die as they appear and Meteor has no target.
  await page.waitForTimeout(1000);
  const box = (await page.locator('#map').boundingBox())!;
  for (const key of ['3', '1', '2']) {
    await page.keyboard.press(key);
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
  }
  for (const a of ['bounty', 'meteor', 'stasis']) {
    await expect(page.locator(`[data-ability=${a}] small`)).toHaveText(/^\d+ s$/);
  }
  // Smite needs an enemy under the pointer; enemies walk past the entrance.
  await page.keyboard.press('4');
  const smite = page.locator('[data-ability=smite]');
  await expect(async () => {
    const scale = Math.min(box.width / 16, box.height / 9);
    const top = box.y + (box.height - 9 * scale) / 2;
    await page.mouse.click(box.x + (box.width - 16 * scale) / 2 + 2 * scale, top + scale);
    await expect(smite).toBeDisabled({ timeout: 300 });
  }).toPass({ timeout: 15_000 });
  await clickSlot(page, 0);
  await page.locator('[data-tower=bolt]').click();
  await expect(page.locator('#specs')).toBeHidden();
  await page.locator('[data-amount="25"]').click();
  await page.locator('#upgrade').click();
  await expect(page.locator('#panel-title')).toHaveText('Bolt, level 26');
  await page.locator('[data-spec=b]').click();
  await expect(page.locator('#panel-text')).toContainText('Sniper');
  await expect(page.locator('#specs')).toBeHidden();

  expect(errors).toEqual([]);
});

for (const { name, width, height } of SIZES) {
  test(`top bar and menu fit (${name})`, async ({ page }, info) => {
    const errors = collectErrors(page);
    const s = game();
    s.gold = new Decimal('9.99e123');
    s.wave = 1234;
    s.bestEver = s.bestRun = 1233;
    await seed(page, { [MAIN_KEY]: saved(s, 3 * HOUR) });
    await page.setViewportSize({ width, height });
    await page.goto('./');
    await expect(page.locator('#away')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`away-${name}.png`) });
    expect(await pageScrolls(page)).toBe(false);
    const overflow = await page.locator('#top').evaluate((e) => e.scrollWidth - e.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const controls = (await page.locator('#controls').boundingBox())!;
    expect(controls.x + controls.width).toBeLessThanOrEqual(width);
    await page.locator('#away-close').click();
    await page.locator('#menu-open').click();
    await page.screenshot({ path: info.outputPath(`menu-${name}.png`) });
    for (const h of await page.locator('button:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(h).toBeGreaterThanOrEqual(44);
    }
    expect(errors).toEqual([]);
  });
}
