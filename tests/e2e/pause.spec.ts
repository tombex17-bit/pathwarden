import { expect, test } from '@playwright/test';
import { SLOT_RADIUS } from '../../src/config/map';
import { fitView, toScreen } from '../../src/render/view';
import { SIZES, collectErrors, pageScrolls, seedSave } from './helpers';
import { prestigeReady, save, veteran } from './scenes';

test('a new game starts paused; Pause and Space stop and start time', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, save(veteran()));
  await page.goto('./');
  await expect(page.locator('#pause')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#pause').click();
  await expect(page.locator('#pause .name')).toHaveText('Play');
  await expect(page.locator('#paused-badge')).toBeVisible();
  const tick = (): Promise<number> => page.evaluate(() => JSON.parse(localStorage.getItem('tdi.save')!).state.tick);
  // Building still works while paused.
  await page.locator('#call-wave').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('#pause')).toHaveAttribute('aria-pressed', 'true');
  const paused = await tick();
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await tick()).toBe(paused);
  await page.keyboard.press('Space');
  await expect(page.locator('#paused-badge')).toBeHidden();
  expect(errors).toEqual([]);
});

test('a brand-new game shows Play', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#pause')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#paused-badge')).toHaveText('Paused');
});

test('active challenges show on the map and can be given up for this run', async ({ page }) => {
  const errors = collectErrors(page);
  const s = prestigeReady();
  s.challenges = ['swift', 'armored'];
  await seedSave(page, save(s));
  await page.goto('./');
  await expect(page.locator('#challenge-badge')).toHaveText('Challenge: Swift, Armored');
  await page.locator('#menu-open').click();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#prestige-text')).toContainText('for 24 Cores');
  await page.locator('[data-drop=swift]').click();
  await expect(page.locator('[data-drop=swift]')).toHaveCount(0);
  await expect(page.locator('#prestige-text')).toContainText('for 18 Cores');
  await expect(page.locator('#challenge-text')).toContainText('This run: Armored.');
  await page.locator('#menu-close').click();
  await expect(page.locator('#challenge-badge')).toHaveText('Challenge: Armored');
  await page.locator('#menu-open').click();
  await page.locator('[data-drop=armored]').click();
  await page.locator('#menu-close').click();
  await expect(page.locator('#challenge-badge')).toBeHidden();
  expect(errors).toEqual([]);
});

test('keeping the tower layout is a choice, off by default, and saved', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, save(prestigeReady()));
  await page.goto('./');
  await page.locator('#menu-open').click();
  await expect(page.locator('#keep-layout')).not.toBeChecked();
  await page.locator('#prestige').click();
  await page.locator('#prestige-yes').click();
  // Cleared: the Bolt and Cannon of the last run are gone.
  const towers = await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    return JSON.parse(localStorage.getItem('tdi.save')!).state.towers.length;
  });
  expect(towers).toBe(0);
  await page.locator('#menu-open').click();
  await page.locator('#keep-layout').check();
  await page.reload();
  await page.locator('#menu-open').click();
  await expect(page.locator('#keep-layout')).toBeChecked();
  expect(errors).toEqual([]);
});

for (const { name, width, height } of SIZES) {
  test(`badges and the Pause button fit (${name})`, async ({ page }, info) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height });
    const s = prestigeReady();
    s.challenges = ['swift', 'armored', 'lean'];
    s.paused = true;
    await seedSave(page, save(s));
    await page.goto('./');
    await expect(page.locator('#challenge-badge')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`badges-${name}.png`) });
    expect(await pageScrolls(page)).toBe(false);
    const overflow = await page.locator('#top').evaluate((e) => e.scrollWidth - e.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // The badges stay above the first row of slots.
    const badge = (await page.locator('#challenge-badge').boundingBox())!;
    const map = (await page.locator('#map').boundingBox())!;
    const firstRow = toScreen(fitView(map.width, map.height), { x: 0, y: 2.5 - SLOT_RADIUS }).y;
    expect(badge.y + badge.height - map.y).toBeLessThanOrEqual(firstRow);
    const pause = (await page.locator('#pause').boundingBox())!;
    expect(Math.min(pause.width, pause.height)).toBeGreaterThanOrEqual(44);
    expect(pause.y + pause.height).toBeLessThanOrEqual(height);
    expect(errors).toEqual([]);
  });
}
