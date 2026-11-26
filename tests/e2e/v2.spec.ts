import { expect, test, type Page } from '@playwright/test';
import { fitView, toScreen } from '../../src/render/view';
import { M6_SIZES, clickSlot, collectErrors, pageScrolls, seedSave } from './helpers';
import { crossroads, heldBrutes, save, veteran } from './scenes';

async function clickMap(page: Page, x: number, y: number): Promise<void> {
  const box = (await page.locator('#map').boundingBox())!;
  const at = toScreen(fitView(box.width, box.height), { x, y });
  await page.mouse.click(box.x + at.x, box.y + at.y);
}

test('the Warden is placed for free, moves, and explains itself', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, save(veteran()));
  await page.goto('./');
  await clickSlot(page, 4);
  await expect(page.locator('#place-hero')).toContainText('Place the Warden here');
  await expect(page.locator('#place-hero .price')).toHaveText('Free');
  await page.locator('#place-hero').click();
  await expect(page.locator('#panel-title')).toHaveText('Warden, level 1');
  await expect(page.locator('#tower-extra')).toContainText('Boosts towers within 2.6 cells by 15%');
  for (const id of ['#upgrade', '#sell', '#amounts', '#merge']) await expect(page.locator(id)).toBeHidden();

  await clickSlot(page, 2);
  await expect(page.locator('#place-hero')).toContainText('Move the Warden here');
  await page.locator('#place-hero').click();
  await expect(page.locator('#panel-title')).toHaveText('Warden, level 1');
  await clickSlot(page, 4);
  await expect(page.locator('#panel-title')).toHaveText('Empty slot');
  await expect(page.locator('#place-hero')).toBeDisabled();
  await expect(page.locator('#place-hero .price')).toHaveText(/^\d+ s$/);
  expect(errors).toEqual([]);
});

test('merging two Bolts makes a Bolt II and frees a slot; ranks are shown', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, save(veteran()));
  await page.goto('./');
  await clickSlot(page, 0);
  await expect(page.locator('#panel-title')).toHaveText('Bolt, level 20');
  await expect(page.locator('#tower-extra')).toHaveText('Rank 2 of 5, 60 kills; next rank at 250.');
  await expect(page.locator('#merge-text')).toContainText('merge into one with x2.5 damage');
  await page.locator('[data-merge-from="1"]').click();
  await expect(page.locator('#panel-title')).toHaveText('Bolt II, level 22');
  await expect(page.locator('#tower-extra')).toHaveText('Rank 2 of 5, 68 kills; next rank at 250.');
  await expect(page.locator('#toast')).toHaveText('Merged into Bolt II.');
  await clickSlot(page, 1);
  await expect(page.locator('#panel-title')).toHaveText('Empty slot');
  // One tower fewer, so the next one costs 80 again.
  await expect(page.locator('[data-tower=bolt] .price')).toHaveText('80');
  expect(errors).toEqual([]);
});

test('tapping enemies hurts them and pays when they die', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, save(heldBrutes()));
  await page.goto('./');
  await expect(page.locator('[data-enemy=brute] .foe-name')).toHaveText('Brute ×3');
  const gold = Number(await page.locator('#gold').textContent());
  // A Brute has 28 HP and a tap without towers does 4, so 7 taps finish one.
  for (let i = 0; i < 9; i++) {
    await clickMap(page, 3.2, 1);
    await page.waitForTimeout(250);
  }
  await expect(page.locator('[data-enemy=brute] .foe-name')).toHaveText('Brute ×2');
  await expect(page.locator('#gold')).toHaveText(String(gold + 4));
  expect(errors).toEqual([]);
});

test('the next wave can be called early, by button or N', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, save(veteran()));
  await page.goto('./');
  await expect(page.locator('#call-wave')).toHaveText('Next wave now (N)');
  await page.locator('#call-wave').click();
  await expect(page.locator('#wave')).toHaveText('9');
  await expect(page.locator('#call-wave')).toBeHidden();
  expect(errors).toEqual([]);
});

test('maps unlock by best wave and switch when the next wave starts', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page, save(crossroads()));
  await page.goto('./');
  await page.locator('#menu-open').click();
  await expect(page.locator('[data-map=crossroads]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-map=shortcut]')).toBeDisabled();
  await expect(page.locator('[data-map=shortcut] small').last()).toHaveText('Clear wave 50 to unlock');
  await page.locator('[data-map=switchback]').click();
  await expect(page.locator('#map-text')).toHaveText('Switching to Switchback when the next wave starts.');
  await page.locator('#menu-close').click();
  // The Warden on slot 10 of Crossroads is clickable there.
  await clickSlot(page, 9, 'crossroads');
  await expect(page.locator('#panel-title')).toHaveText('Warden, level 60');
  await expect(page.locator('#toast')).toHaveText('Now on Switchback.', { timeout: 60_000 });
  await clickSlot(page, 9, 'switchback');
  await expect(page.locator('#panel-title')).toHaveText('Warden, level 60');
  expect(errors).toEqual([]);
});

for (const { name, width, height } of M6_SIZES) {
  test(`version 2 screens fit (${name})`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height });
    await seedSave(page, save(crossroads()));
    await page.goto('./');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/screens/v2-map-${name}.png` });
    await clickSlot(page, 2, 'crossroads');
    await expect(page.locator('#panel-title')).toHaveText('Cannon II, level 45');
    await page.screenshot({ path: `test-results/screens/v2-tower-${name}.png` });
    expect(await pageScrolls(page)).toBe(false);
    const small = await page.locator('#panel *:visible').evaluateAll((els) => els
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()))
      .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 14).map((e) => e.textContent));
    expect(small).toEqual([]);
    const short = await page.locator('#panel button:visible').evaluateAll((els) => els
      .filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.textContent));
    expect(short).toEqual([]);
    expect(errors).toEqual([]);
  });
}
