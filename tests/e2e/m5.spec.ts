import Decimal from 'break_infinity.js';
import { expect, test, type Page } from '@playwright/test';
import { defaultSettings } from '../../src/platform/settings';
import { encode } from '../../src/platform/save';
import { createState, refreshDamage } from '../../src/sim/sim';
import type { State, Tower } from '../../src/sim/types';
import { SIZES, clickSlot, collectErrors, pageScrolls } from './helpers';

/** Wave 104 cleared after 10 waves this run, with two towers standing. */
function ready(): State {
  const s = createState(3, 105);
  s.bestRun = 104;
  s.bestEver = 110;
  s.clearedThisRun = 10;
  s.gold = new Decimal(1e9);
  s.cores = new Decimal(2);
  for (const [slot, kind] of [[0, 'bolt'], [4, 'cannon']] as const) {
    const t: Tower = { slot, kind, level: 30, spec: null, cooldown: 0, log10Damage: 0, locks: [], buildPaid: new Decimal(50), upgradesPaid: new Decimal(0), tier: 1, kills: 0, boostTicks: 0, boostCooldown: 0 };
    refreshDamage(s, t);
    s.towers.push(t);
  }
  return s;
}

async function seed(page: Page, s: State): Promise<void> {
  await page.addInitScript((text) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('tdi.save', text);
  }, encode(s, defaultSettings(), Date.now()));
}

test('prestige: shown beforehand, confirmed, then Cores buy upgrades and automation rebuilds', async ({ page }, info) => {
  const errors = collectErrors(page);
  await seed(page, ready());
  await page.goto('./');
  await expect(page.locator('#cores')).toHaveText('2');
  await page.locator('#menu-open').click();
  await expect(page.locator('#prestige-text')).toHaveText('Prestige now for 12 Cores and start again from wave 55. Best wave this run: 104.');
  await page.screenshot({ path: info.outputPath('menu-before.png') });
  await page.locator('#prestige').click();
  await page.locator('#prestige-no').click();
  await expect(page.locator('#wave')).toHaveText('105');
  await page.locator('#prestige').click();
  await page.locator('#prestige-yes').click();
  await expect(page.locator('#menu')).not.toBeVisible();
  await expect(page.locator('#toast')).toHaveText('Prestige: +12 Cores. New run from wave 55.');
  await expect(page.locator('#wave')).toHaveText('55');
  await expect(page.locator('#cores')).toHaveText('14');
  await clickSlot(page, 0);
  await expect(page.locator('#panel-title')).toHaveText('Empty slot');

  await page.locator('#menu-open').click();
  await expect(page.locator('#prestige')).toBeDisabled();
  await expect(page.locator('#prestige-text')).toHaveText('Clear wave 100 first. Best wave this run: 0. Best ever: 110.');
  await expect(page.locator('#auto-upgrade')).toBeDisabled();
  await page.locator('[data-upgrade=autoUpgrade]').click();
  await expect(page.locator('[data-upgrade=autoUpgrade] .price')).toHaveText('Owned');
  await expect(page.locator('#auto-upgrade')).toBeChecked();
  await page.locator('[data-upgrade=power]').click();
  await expect(page.locator('[data-upgrade=power]')).toContainText('Power (level 1)');
  await expect(page.locator('#cores-text')).toHaveText('You have 4 Cores.');
  await expect(page.locator('[data-upgrade=autoCast]')).toBeDisabled();
  await page.screenshot({ path: info.outputPath('menu-after.png') });
  await page.locator('#menu-close').click();

  // Auto-upgrade rebuilds the recorded towers in the same slots.
  await clickSlot(page, 4);
  await expect(page.locator('#panel-title')).toHaveText(/^Cannon, level \d+$/, { timeout: 10_000 });
  await clickSlot(page, 0);
  await expect(page.locator('#panel-title')).toHaveText(/^Bolt, level \d+$/);

  // Everything survives a reload.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('#cores')).toHaveText('4');
  await page.locator('#menu-open').click();
  await expect(page.locator('[data-upgrade=autoUpgrade] .price')).toHaveText('Owned');
  await page.locator('#auto-upgrade').uncheck();
  await page.reload();
  await page.locator('#menu-open').click();
  await expect(page.locator('#auto-upgrade')).not.toBeChecked();
  expect(errors).toEqual([]);
});

for (const { name, width, height } of SIZES) {
  test(`menu with prestige fits (${name})`, async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, ready());
    await page.setViewportSize({ width, height });
    await page.goto('./');
    await expect(page.locator('#cores')).toHaveText('2');
    const overflow = await page.locator('#top').evaluate((e) => e.scrollWidth - e.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.locator('#menu-open').click();
    await page.locator('#prestige').click();
    await page.locator('#prestige-yes').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`prestige-${name}.png`) });
    expect(await pageScrolls(page)).toBe(false);
    for (const h of await page.locator('button:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(h).toBeGreaterThanOrEqual(44);
    }
    expect(errors).toEqual([]);
  });
}
