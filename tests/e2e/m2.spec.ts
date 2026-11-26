import { expect, test } from '@playwright/test';
import { SIZES, clickSlot, collectErrors, pageScrolls } from './helpers';

test('buys, upgrades and sells with gold', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await clickSlot(page, 0);
  await expect(page.locator('[data-tower]')).toHaveCount(5);
  await expect(page.locator('[data-tower=bolt] .price')).toHaveText('50');
  await page.locator('[data-tower=bolt]').click();
  await expect(page.locator('#gold')).toHaveText('10');
  await expect(page.locator('#upgrade')).toHaveText('Upgrade +1 for 22');
  await expect(page.locator('#upgrade')).toBeDisabled();

  // A second tower costs more and cannot be afforded yet.
  await clickSlot(page, 1);
  await expect(page.locator('[data-tower=tesla] .price')).toHaveText('80');
  await expect(page.locator('[data-tower=tesla]')).toBeDisabled();

  await clickSlot(page, 0);
  await expect(page.locator('#upgrade')).toBeEnabled({ timeout: 30_000 });
  await page.locator('[data-amount=max]').click();
  await page.locator('#upgrade').click();
  await expect(page.locator('#panel-title')).toHaveText(/^Bolt, level [2-9]$/);
  await page.locator('[data-amount="10"]').click();
  await expect(page.locator('#upgrade')).toContainText('Upgrade +10');

  await page.locator('#sell').click();
  await expect(page.locator('#panel-title')).toHaveText('Empty slot');
  await expect(page.locator('[data-tower=bolt]')).toBeEnabled();
  expect(errors).toEqual([]);
});

for (const { name, width, height } of SIZES) {
  test(`shop fits and is reachable (${name})`, async ({ page }, info) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await clickSlot(page, 0);
    await page.screenshot({ path: info.outputPath(`shop-${name}.png`) });
    await page.locator('[data-tower=tesla]').scrollIntoViewIfNeeded();
    await page.locator('[data-tower=tesla]').click();
    await expect(page.locator('#panel-title')).toHaveText('Tesla, level 1');
    await page.screenshot({ path: info.outputPath(`tower-${name}.png`) });
    expect(await pageScrolls(page)).toBe(false);
    for (const box of await page.locator('button:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    expect(errors).toEqual([]);
  });
}
