import { expect, test, type Page } from '@playwright/test';
import { fitView, toScreen } from '../../src/render/view';
import { SIZES, clickSlot, collectErrors, pageScrolls } from './helpers';

async function mapPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('#map').boundingBox())!;
  const at = toScreen(fitView(box.width, box.height), { x, y });
  return { x: box.x + at.x, y: box.y + at.y };
}

const meteor = (page: Page) => page.locator('[data-ability=meteor]');

async function expectReady(page: Page): Promise<void> {
  await expect(meteor(page)).toBeEnabled();
  await expect(meteor(page).locator('small')).toHaveText('Key 1');
}

async function expectCast(page: Page): Promise<void> {
  await expect(meteor(page).locator('small')).toHaveText(/^(40|39|38) s$/);
  await expect(meteor(page)).toBeDisabled();
  await expect(meteor(page)).toHaveAttribute('aria-pressed', 'false');
}

test('casts with the mouse', async ({ page }, info) => {
  const errors = collectErrors(page);
  await page.goto('./');
  for (const a of ['stasis', 'bounty', 'smite']) await expect(page.locator(`[data-ability=${a}]`)).toBeDisabled();
  await expect(page.locator('[data-ability=stasis] small')).toHaveText('Clear 10');
  await expectReady(page);
  await meteor(page).click();
  await expect(meteor(page)).toHaveAttribute('aria-pressed', 'true');
  const at = await mapPoint(page, 4, 1);
  await page.mouse.move(at.x, at.y);
  await page.screenshot({ path: info.outputPath('aiming.png') });
  await page.mouse.click(at.x, at.y);
  await expectCast(page);
  await page.screenshot({ path: info.outputPath('cast.png') });
  // Aiming is over, so the same click now selects slots again.
  await clickSlot(page, 0);
  await expect(page.locator('#panel-title')).toHaveText('Empty slot');
  expect(errors).toEqual([]);
});

test('selects with a key', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await expectReady(page);
  await page.keyboard.press('2');
  await expect(page.locator('[data-ability=stasis]')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('1');
  await expect(meteor(page)).toHaveAttribute('aria-pressed', 'true');
  const at = await mapPoint(page, 4, 1);
  await page.mouse.click(at.x, at.y);
  await expectCast(page);
  expect(errors).toEqual([]);
});

test('cancels by key, right-click, and choosing the ability again', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await expectReady(page);
  const at = await mapPoint(page, 4, 1);
  const cancels = [
    () => page.keyboard.press('Escape'),
    () => page.mouse.click(at.x, at.y, { button: 'right' }),
    () => meteor(page).click(),
    () => page.keyboard.press('1'),
  ];
  for (const cancel of cancels) {
    await page.keyboard.press('1');
    await expect(meteor(page)).toHaveAttribute('aria-pressed', 'true');
    await cancel();
    await expect(meteor(page)).toHaveAttribute('aria-pressed', 'false');
    await expectReady(page);
  }
  expect(errors).toEqual([]);
});

test('a refused cast explains why, keeps aiming and spends nothing', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await expectReady(page);
  await page.keyboard.press('1');
  // Below the map, in the empty part of the stage.
  const at = await mapPoint(page, 4, 9.4);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('#toast')).toHaveText('Pick a point on the map');
  await expect(meteor(page)).toBeEnabled();
  await expect(meteor(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#toast')).toBeHidden({ timeout: 5_000 });
  expect(errors).toEqual([]);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  for (const { name, width, height } of SIZES.filter((s) => s.name !== 'desktop')) {
    test(`casts and builds by tapping (${name})`, async ({ page }, info) => {
      const errors = collectErrors(page);
      await page.setViewportSize({ width, height });
      await page.goto('./');
      await expectReady(page);
      const box = (await page.locator('#abilities').boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(box.y).toBeGreaterThan(height / 2);
      await meteor(page).tap();
      const at = await mapPoint(page, 4, 1);
      await page.touchscreen.tap(at.x, at.y);
      await expectCast(page);
      const slot = await mapPoint(page, 3, 2.5);
      await page.touchscreen.tap(slot.x, slot.y);
      await page.locator('[data-tower=bolt]').tap();
      await expect(page.locator('#panel-title')).toHaveText('Bolt, level 1');
      await page.screenshot({ path: info.outputPath(`touch-${name}.png`) });
      expect(await pageScrolls(page)).toBe(false);
      for (const h of await page.locator('button:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
        expect(h).toBeGreaterThanOrEqual(44);
      }
      const clipped = await page.locator('.ability').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).length);
      expect(clipped).toBe(0);
      expect(errors).toEqual([]);
    });
  }
});
