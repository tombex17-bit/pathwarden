import { expect, test, type Page } from '@playwright/test';
import { fitView, toScreen } from '../../src/render/view';
import { GUIDE_SLOTS } from '../../src/ui/guide-steps';
import { clickSlot, collectErrors, pageScrolls, SIZES } from './helpers';

/** Clicks the map where there is no slot, which clears the selection. */
async function clickEmptyMap(page: Page): Promise<void> {
  const box = (await page.locator('#map').boundingBox())!;
  const at = toScreen(fitView(box.width, box.height), { x: 8, y: 8.5 });
  await page.mouse.click(box.x + at.x, box.y + at.y);
}

test('a new game waits for the first tower, and the guide leads to it', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await expect(page.locator('#guide-text')).toHaveText('Welcome! Tap the highlighted slot on the map to place your first tower there.');
  await expect(page.locator('#foes-title')).toHaveText('Wave 1 enemies left');
  await expect(page.locator('#foe-list .foe')).toHaveCount(1);
  await expect(page.locator('[data-enemy=grunt] .foe-name')).toHaveText('Grunt ×12');
  await expect(page.locator('[data-enemy=grunt] .foe-hp')).toHaveText('HP 14');
  await expect(page.locator('[data-enemy=grunt] small')).toHaveText('Gold 2 · Speed 2');

  // Nothing moves while the player reads.
  await page.waitForTimeout(3000);
  await expect(page.locator('[data-enemy=grunt] .foe-name')).toHaveText('Grunt ×12');
  await expect(page.locator('#gold')).toHaveText('70');

  await clickSlot(page, GUIDE_SLOTS[0]);
  await expect(page.locator('#guide-text')).toHaveText('Pick Bolt: fast single shots for 50 of your 70 gold.');
  await expect(page.locator('[data-tower=bolt]')).toHaveClass(/guide-target/);
  await expect(page.locator('#foes')).toBeHidden();
  await page.locator('[data-tower=bolt]').click();
  await expect(page.locator('[data-tower=bolt]')).not.toHaveClass(/guide-target/);
  // New games start paused; the guide points at Play.
  await expect(page.locator('#guide-text')).toHaveText('Your tower is ready. Press Play (or Space) to start the game.');
  await expect(page.locator('#pause')).toHaveClass(/guide-target/);
  // Space toggles pause when no button has the focus (a focused button takes Space for itself).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');
  await expect(page.locator('#pause')).toHaveAttribute('aria-pressed', 'false');

  // The wave runs now; the list counts down once the selection is cleared.
  await clickEmptyMap(page);
  await expect(page.locator('#foes')).toBeVisible();
  await expect(page.locator('[data-enemy=grunt] .foe-name')).not.toHaveText('Grunt ×12', { timeout: 15_000 });
  await expect(page.locator('#guide-text')).toHaveText(/upgrade|Meteor/);

  // Progress and skipping survive a reload.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('#guide-text')).not.toHaveText(/Welcome/);
  await page.locator('#guide-skip').click();
  await expect(page.locator('#guide')).toBeHidden();
  await page.reload();
  await expect(page.locator('#wave')).toHaveText(/\d/);
  await page.waitForTimeout(500);
  await expect(page.locator('#guide')).toBeHidden();
  expect(errors).toEqual([]);
});

for (const { name, width, height } of SIZES) {
  test(`the guide and enemy list fit and read well (${name})`, async ({ page }, info) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height });
    await page.goto('./');
    await expect(page.locator('#guide')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`guide-${name}.png`) });
    const sizes = await page.locator('#guide, #foes').evaluateAll((els) => els.flatMap((el) => [...el.querySelectorAll('p, h3, span, small, button')]
      .map((e) => ({ font: parseFloat(getComputedStyle(e).fontSize), height: e.tagName === 'BUTTON' ? e.getBoundingClientRect().height : 44 }))));
    for (const s of sizes) {
      expect(s.font).toBeGreaterThanOrEqual(14);
      expect(s.height).toBeGreaterThanOrEqual(44);
    }
    expect(await pageScrolls(page)).toBe(false);
    expect(errors).toEqual([]);
  });
}
