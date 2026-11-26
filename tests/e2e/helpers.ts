import type { Page } from '@playwright/test';
import { MAPS, type MapId } from '../../src/config/map';
import { fitView, toScreen } from '../../src/render/view';

export const SIZES = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'portrait', width: 360, height: 640 },
  { name: 'landscape', width: 640, height: 360 },
];

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export async function clickSlot(page: Page, slot: number, map: MapId = 'switchback'): Promise<void> {
  const box = (await page.locator('#map').boundingBox())!;
  const at = toScreen(fitView(box.width, box.height), MAPS[map].slots[slot]!);
  await page.mouse.click(box.x + at.x, box.y + at.y);
}

export async function pageScrolls(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth > d.clientWidth || d.scrollHeight > d.clientHeight;
  });
}

/** The four sizes SPEC section 12 must hold at. */
export const M6_SIZES = [
  { name: 'phone-portrait', width: 360, height: 640 },
  { name: 'phone-landscape', width: 640, height: 360 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1920, height: 1080 },
];

/** Puts a save in place before the first load only, so reloads keep what the game saved. */
export async function seedSave(page: Page, text: string): Promise<void> {
  await page.addInitScript((save) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('tdi.save', save);
  }, text);
}
