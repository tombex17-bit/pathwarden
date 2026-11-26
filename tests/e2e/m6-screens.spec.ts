import { expect, test, type Page } from '@playwright/test';
import { SLOTS } from '../../src/config/map';
import { fitView, toScreen } from '../../src/render/view';
import { M6_SIZES, collectErrors, seedSave } from './helpers';
import { boss, early, prestigeReady, save } from './scenes';

// Screenshots for comparing with SPEC section 12 by eye. They are saved under test-results.
const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: `test-results/screens/${name}.png` });

for (const { name, width, height } of M6_SIZES) {
  test.describe(name, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width, height }); });

    test('early game and ability targeting', async ({ page }) => {
      const errors = collectErrors(page);
      await seedSave(page, save(early()));
      await page.goto('/');
      await expect(page.locator('#wave')).toHaveText('2');
      await page.waitForTimeout(800);
      await shot(page, `early-${name}`);
      await page.locator('[data-ability=meteor]').click();
      const box = (await page.locator('#map').boundingBox())!;
      const at = toScreen(fitView(box.width, box.height), { x: (SLOTS[0]!.x + 4) / 2, y: 1 });
      await page.mouse.move(box.x + at.x, box.y + at.y);
      await page.waitForTimeout(200);
      await shot(page, `targeting-${name}`);
      expect(errors).toEqual([]);
    });

    test('boss', async ({ page }) => {
      const errors = collectErrors(page);
      await seedSave(page, save(boss()));
      await page.goto('/');
      await expect(page.locator('#wave')).toHaveText('10');
      await page.waitForTimeout(500);
      await shot(page, `boss-${name}`);
      expect(errors).toEqual([]);
    });

    test('prestige', async ({ page }) => {
      const errors = collectErrors(page);
      await seedSave(page, save(prestigeReady()));
      await page.goto('/');
      await page.locator('#menu-open').click();
      await page.locator('#prestige').click();
      await page.locator('#prestige-yes').scrollIntoViewIfNeeded();
      await shot(page, `prestige-${name}`);
      expect(errors).toEqual([]);
    });
  });
}
