import { expect, test, type Page } from '@playwright/test';
import { fitView, toScreen } from '../../src/render/view';
import { M6_SIZES, clickSlot, collectErrors, pageScrolls, seedSave } from './helpers';
import { mazeScene, prestigeReady, save, veteran, wildsScene } from './scenes';

async function clickMap(page: Page, x: number, y: number): Promise<void> {
  const box = (await page.locator('#map').boundingBox())!;
  const at = toScreen(fitView(box.width, box.height), { x, y });
  await page.mouse.click(box.x + at.x, box.y + at.y);
}

test('Overdrive speeds up one tower, then cools down', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, save(veteran()));
  await page.goto('./');
  await clickSlot(page, 0);
  await expect(page.locator('#boost')).toHaveText('Overdrive: x2 attack speed for 8 s');
  await page.locator('#boost').click();
  await expect(page.locator('#boost')).toHaveText(/^Overdrive active: [78] s$/);
  await expect(page.locator('#boost')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('the Warden rallies every tower', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, save(veteran()));
  await page.goto('./');
  await clickSlot(page, 4);
  await page.locator('#place-hero').click();
  await expect(page.locator('#boost')).toHaveText('Rally: all towers x1.5 damage for 8 s');
  await page.locator('#boost').click();
  await expect(page.locator('#boost')).toHaveText(/^Rally active: [78] s$/);
  expect(errors).toEqual([]);
});

test('challenges are picked for the next run and pay more Cores there', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, save(prestigeReady()));
  await page.goto('./');
  await page.locator('#menu-open').click();
  await expect(page.locator('#challenge-text')).toContainText('None this run.');
  await page.locator('[data-challenge=swift]').check();
  await page.locator('[data-challenge=lean]').check();
  // Picked for the next run, so this prestige pays the usual 12 Cores.
  await expect(page.locator('#prestige-text')).toContainText('for 12 Cores');
  await page.locator('#prestige').click();
  await page.locator('#prestige-yes').click();
  await page.locator('#menu-open').click();
  await expect(page.locator('#challenge-text')).toContainText('This run: Swift, Lean.');
  await expect(page.locator('[data-challenge=swift]')).toBeChecked();
  await page.locator('[data-challenge=swift]').uncheck();
  await page.reload();
  await page.locator('#menu-open').click();
  await expect(page.locator('[data-challenge=swift]')).not.toBeChecked();
  await expect(page.locator('#challenge-text')).toContainText('This run: Swift, Lean.');
  expect(errors).toEqual([]);
});

test('Maze walls are placed and removed between waves', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, save(mazeScene()));
  await page.goto('./');
  await expect(page.locator('#walls-text')).toHaveText('4 of 30 walls. Tap squares to add or remove walls.');
  await page.locator('#walls-edit').click();
  await expect(page.locator('#walls-edit')).toHaveAttribute('aria-pressed', 'true');
  await clickMap(page, 7.5, 1.5);
  await expect(page.locator('#walls-text')).toHaveText(/^5 of 30 walls/);
  await clickMap(page, 7.5, 1.5);
  await expect(page.locator('#walls-text')).toHaveText(/^4 of 30 walls/);
  await clickMap(page, 0.5, 4.5);
  await expect(page.locator('#toast')).toHaveText('That square must stay open');
  await page.locator('#walls-edit').click();
  await expect(page.locator('#walls-edit')).toHaveText('Place walls');
  // With editing off, clicks select slots again.
  await clickSlot(page, 0, 'maze', 0, mazeScene().walls);
  await expect(page.locator('#panel-title')).toHaveText('Cannon, level 60');
  expect(errors).toEqual([]);
});

test('the Wilds road is drawn and its slots work', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, save(wildsScene()));
  await page.goto('./');
  await clickSlot(page, 3, 'wilds', 4242);
  await expect(page.locator('#panel-title')).toHaveText('Cannon, level 50');
  await clickSlot(page, 1, 'wilds', 4242);
  await expect(page.locator('#panel-title')).toHaveText('Empty slot');
  expect(errors).toEqual([]);
});

for (const { name, width, height } of M6_SIZES) {
  test(`Maze and Wilds screens fit (${name})`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height });
    await seedSave(page, save(mazeScene()));
    await page.goto('./');
    await page.locator('#walls-edit').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/screens/maze-${name}.png` });
    expect(await pageScrolls(page)).toBe(false);
    const short = await page.locator('#panel button:visible').evaluateAll((els) => els
      .filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.textContent));
    expect(short).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`Wilds screen (${name})`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height });
    await seedSave(page, save(wildsScene()));
    await page.goto('./');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/screens/wilds-${name}.png` });
    expect(await pageScrolls(page)).toBe(false);
    expect(errors).toEqual([]);
  });
}
