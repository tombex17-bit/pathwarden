import { expect, test } from '@playwright/test';
import { createState } from '../../src/sim/sim';
import { SIZES, clickSlot, collectErrors, pageScrolls, seedSave } from './helpers';
import { save } from './scenes';

for (const { name, width, height } of SIZES) {
  test(`builds a Bolt and kills a Grunt (${name})`, async ({ page }, info) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height });
    await page.goto('./');
    await expect(page.locator('#wave')).toHaveText('1');
    await clickSlot(page, 0);
    await page.locator('[data-tower=bolt]').click();
    await expect(page.locator('#panel-title')).toHaveText('Bolt, level 1');
    await expect(page.locator('#shop')).toBeHidden();
    // 20 gold is left after building, so more means a kill paid out.
    await expect(page.locator('#gold')).toHaveText('22', { timeout: 15_000 });
    await page.screenshot({ path: info.outputPath(`${name}.png`) });
    expect(await pageScrolls(page)).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('losing shows a message and restarts', async ({ page }) => {
  const errors = collectErrors(page);
  // A brand-new game would wait for a tower; this one runs wave 1 with none.
  await seedSave(page, save(createState(1)));
  await page.goto('./');
  await expect(page.locator('#banner')).toHaveText('Wave 1 lost. Back to wave 1.', { timeout: 45_000 });
  await expect(page.locator('#banner')).toBeVisible();
  await expect(page.locator('#banner')).toBeHidden({ timeout: 5_000 });
  await expect(page.locator('#lives')).toHaveText('10');
  expect(errors).toEqual([]);
});

test('the next wave starts by itself', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await clickSlot(page, 0);
  await page.locator('[data-tower=bolt]').click();
  await expect(page.locator('#wave')).toHaveText('2', { timeout: 45_000 });
  await expect(page.locator('#best')).toHaveText('1');
  expect(errors).toEqual([]);
});
