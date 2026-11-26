import { chromium, expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fitView, toScreen } from '../../src/render/view';
import { clickSlot, collectErrors, M6_SIZES, pageScrolls, pressPlay, seedSave } from './helpers';
import { boss, crowded, early, prestigeReady, save } from './scenes';

/** The tables of SPEC sections 12 and 22, written out again so the game's own palette file is checked against them. */
const SPEC_COLORS = new Set([
  '#12161F', '#1B2130', '#2A3347', '#E8ECF4', '#9AA6BD', '#F4C95D', '#F2845C', '#6EC5FF',
  '#E06CF0', '#8C8CFF', '#E5566D', '#FF2E55', '#FFD66B', '#57E0B5', '#6BD68A',
  // Section 22: art shades.
  '#161B26', '#13201C', '#162420', '#191B24', '#1D2029', '#211A1B', '#261E1F', '#0F1D17', '#13221B',
  '#222A3B', '#36415A', '#3A4560', '#4E5B7A', '#2E6650', '#3E8668', '#4A3A30', '#34507E',
  '#B8923A', '#B35E40', '#3C88B8', '#9E46AD', '#5C5CB8', '#3F8C58', '#A33A4D', '#F28A9B', '#B01F3B',
]);

interface Probe { colors: string[]; alphas: number[]; contexts: number; tones: number }
declare global { interface Window { probe: Probe } }

/** Records every color and opacity the game draws with, and every audio context and tone it makes. */
async function addProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const colors = new Set<string>();
    const alphas = new Set<number>();
    const probe = { contexts: 0, tones: 0, get colors() { return [...colors]; }, get alphas() { return [...alphas]; } };
    window.probe = probe;
    const proto = CanvasRenderingContext2D.prototype;
    const watch = (prop: 'fillStyle' | 'strokeStyle' | 'globalAlpha', record: (v: unknown) => void): void => {
      const real = Object.getOwnPropertyDescriptor(proto, prop)!;
      Object.defineProperty(proto, prop, {
        configurable: true,
        get() { return real.get!.call(this); },
        set(v) { record(v); real.set!.call(this, v); },
      });
    };
    watch('fillStyle', (v) => colors.add(String(v).toUpperCase()));
    watch('strokeStyle', (v) => colors.add(String(v).toUpperCase()));
    watch('globalAlpha', (v) => alphas.add(Number(v)));
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        probe.contexts++;
      }
    };
    const createOscillator = Real.prototype.createOscillator;
    Real.prototype.createOscillator = function (this: AudioContext) {
      probe.tones++;
      return createOscillator.call(this);
    };
  });
}

const probe = (page: Page): Promise<Probe> => page.evaluate(() => ({ ...window.probe, colors: window.probe.colors, alphas: window.probe.alphas }));

async function castMeteorOnPath(page: Page): Promise<void> {
  await page.locator('[data-ability=meteor]').click();
  const box = (await page.locator('#map').boundingBox())!;
  const at = toScreen(fitView(box.width, box.height), { x: 5, y: 1 });
  await page.mouse.click(box.x + at.x, box.y + at.y);
}

const hex = (rgb: string): string | undefined => {
  const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(rgb);
  if (!m) return undefined;
  if (m[4] !== undefined && Number(m[4]) === 0) return 'transparent';
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};

interface TextItem { text: string; size: number; color: string; background: string }
interface Target { what: string; width: number; height: number }

/** Every visible piece of text and every control, as the player sees them. */
function inspectPage(page: Page): Promise<{ texts: TextItem[]; targets: Target[]; cssColors: string[] }> {
  return page.evaluate(() => {
    const visible = (e: Element): boolean => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    };
    const background = (e: Element | null): string => {
      for (; e; e = e.parentElement) {
        const bg = getComputedStyle(e).backgroundColor;
        if (!/rgba\(.*, 0\)$/.test(bg) && bg !== 'transparent') return bg;
      }
      return 'rgb(18, 22, 31)';
    };
    const texts = [...document.querySelectorAll('body *')].filter((e) => visible(e)
      && [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== ''))
      .map((e) => ({ text: e.textContent!.trim().slice(0, 40), size: parseFloat(getComputedStyle(e).fontSize), color: getComputedStyle(e).color, background: background(e) }));
    const targets = [...document.querySelectorAll('button, textarea, label.option, a[href]')].filter(visible)
      .map((e) => ({ what: e.id || e.textContent!.trim().slice(0, 30), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }));
    const cssColors = [...document.querySelectorAll('*')].flatMap((e) => {
      const s = getComputedStyle(e);
      const borders = ['Top', 'Right', 'Bottom', 'Left'].filter((side) => parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0)
        .map((side) => s.getPropertyValue(`border-${side.toLowerCase()}-color`));
      return [s.color, s.backgroundColor, ...borders, ...(s.accentColor === 'auto' ? [] : [s.accentColor])];
    });
    return { texts, targets, cssColors: [...new Set(cssColors)] };
  });
}

function luminance(rgb: string): number {
  const [r, g, b] = rgb.match(/\d+/g)!.slice(0, 3).map((n) => {
    const c = Number(n) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function checkScreen(found: Awaited<ReturnType<typeof inspectPage>>, where: string): void {
  for (const t of found.texts) {
    expect.soft(t.size, `${where}: "${t.text}" font size`).toBeGreaterThanOrEqual(14);
    expect.soft(contrast(t.color, t.background), `${where}: "${t.text}" contrast`).toBeGreaterThanOrEqual(4.5);
  }
  for (const t of found.targets) {
    expect.soft(Math.min(t.width, t.height), `${where}: ${t.what} size`).toBeGreaterThanOrEqual(44);
  }
  for (const c of found.cssColors) {
    const h = hex(c);
    expect.soft(h === 'transparent' || (h !== undefined && SPEC_COLORS.has(h)), `${where}: CSS color ${c}`).toBe(true);
  }
}

for (const { name, width, height } of M6_SIZES) {
  test(`text, targets, colors and no page scroll (${name})`, async ({ page }) => {
    const errors = collectErrors(page);
    await addProbe(page);
    await page.setViewportSize({ width, height });
    await seedSave(page, save(prestigeReady()));
    await page.goto('./');
    await expect(page.locator('#wave')).toHaveText('105');
    checkScreen(await inspectPage(page), 'build panel');
    await clickSlot(page, 1);
    await expect(page.locator('#shop')).toBeVisible();
    checkScreen(await inspectPage(page), 'shop');
    await clickSlot(page, 0);
    await expect(page.locator('#specs')).toBeVisible();
    checkScreen(await inspectPage(page), 'tower');
    expect(await pageScrolls(page)).toBe(false);
    await page.locator('#menu-open').click();
    await page.locator('#prestige').click();
    checkScreen(await inspectPage(page), 'menu');
    expect(await pageScrolls(page)).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('the map is drawn only in the palette colors', async ({ page }) => {
  const errors = collectErrors(page);
  await addProbe(page);
  await seedSave(page, save(boss()));
  await page.goto('./');
  await clickSlot(page, 0);
  await castMeteorOnPath(page);
  await page.keyboard.press('2');
  const box = (await page.locator('#map').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.waitForTimeout(1500);
  const { colors } = await probe(page);
  // Every tower, both enemy colors and all ability colors were used.
  expect(colors.length).toBeGreaterThanOrEqual(10);
  for (const c of colors) expect(SPEC_COLORS, c).toContain(c);
  expect(errors).toEqual([]);
});

test('turning the device keeps the game, selection and aiming', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await seedSave(page, save(early()));
  await page.goto('./');
  await clickSlot(page, 0);
  await expect(page.locator('#panel-title')).toHaveText('Bolt, level 3');
  const gold = await page.locator('#gold').textContent();
  await page.locator('[data-ability=meteor]').click();
  await page.setViewportSize({ width: 640, height: 360 });
  await expect(page.locator('#panel-title')).toHaveText('Bolt, level 3');
  await expect(page.locator('[data-ability=meteor]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#wave')).toHaveText('2');
  expect(Number(await page.locator('#gold').textContent())).toBeGreaterThanOrEqual(Number(gold));
  expect(await pageScrolls(page)).toBe(false);
  await page.keyboard.press('Escape');
  // Taps land on the right slot in the new layout.
  await clickSlot(page, 4);
  await expect(page.locator('#panel-title')).toHaveText('Cannon, level 1');
  await page.setViewportSize({ width: 360, height: 640 });
  await clickSlot(page, 0);
  await expect(page.locator('#panel-title')).toHaveText('Bolt, level 3');
  expect(errors).toEqual([]);
});

for (const motion of ['reduce', 'no-preference'] as const) {
  test(`effects with prefers-reduced-motion: ${motion}`, async ({ page }) => {
    const errors = collectErrors(page);
    await addProbe(page);
    await page.emulateMedia({ reducedMotion: motion });
    await seedSave(page, save(boss()));
    await page.goto('./');
    await castMeteorOnPath(page);
    await page.waitForTimeout(1500);
    // Only zones (0.15) are see-through when motion is reduced; fades use every other value.
    const fading = (await probe(page)).alphas.filter((a) => a !== 1 && a !== 0.15);
    if (motion === 'reduce') expect(fading).toEqual([]);
    else expect(fading.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}

test('sound: nothing before input, mute and volume obeyed and kept after reload', async ({ page }) => {
  const errors = collectErrors(page);
  await addProbe(page);
  // A full field keeps towers firing, so silence below means muting worked, not a quiet moment.
  // Music is checked on its own below; here it stays off so only sound effects count.
  await seedSave(page, save(crowded(), { musicMuted: true }));
  await page.goto('./');
  await page.waitForTimeout(1500);
  expect(await probe(page)).toMatchObject({ contexts: 0, tones: 0 });

  await page.locator('#panel-title').click();
  await expect.poll(async () => (await probe(page)).tones).toBeGreaterThan(0);
  expect((await probe(page)).contexts).toBe(1);
  // At most 8 shots and 8 deaths a second, plus a few rarer sounds.
  const before = (await probe(page)).tones;
  await page.waitForTimeout(2000);
  const heard = (await probe(page)).tones - before;
  expect(heard).toBeGreaterThanOrEqual(8);
  expect(heard).toBeLessThanOrEqual(2 * (8 + 8 + 4));

  await page.locator('#menu-open').click();
  await page.locator('#muted').check();
  await page.locator('#menu-close').click();
  const muted = (await probe(page)).tones;
  await castMeteorOnPath(page);
  await page.waitForTimeout(2000);
  expect((await probe(page)).tones).toBe(muted);

  await page.reload();
  await page.waitForTimeout(1000);
  expect(await probe(page)).toMatchObject({ contexts: 0, tones: 0 });
  await page.locator('#menu-open').click();
  await expect(page.locator('#muted')).toBeChecked();
  await expect(page.locator('#volume')).toHaveValue('60');
  await page.locator('#muted').uncheck();
  await page.locator('#volume').fill('0');
  await expect(page.locator('#volume-text')).toHaveText('0%');
  await page.locator('#menu-close').click();
  await page.waitForTimeout(1500);
  expect((await probe(page)).tones).toBe(0);

  await page.locator('#menu-open').click();
  await page.locator('#volume').fill('35');
  await page.reload();
  await page.locator('#menu-open').click();
  await expect(page.locator('#muted')).not.toBeChecked();
  await expect(page.locator('#volume')).toHaveValue('35');
  await expect(page.locator('#volume-text')).toHaveText('35%');
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('tdi.save')!).settings);
  expect(settings).toMatchObject({ speed: 1, volume: 0.35, muted: false });
  expect(errors).toEqual([]);
});

test('music: nothing before input, then plays; mute and volume obeyed and kept', async ({ page }) => {
  const errors = collectErrors(page);
  await addProbe(page);
  // A brand-new game waits for its first tower, so no game sounds play: only music.
  await page.goto('./');
  await page.waitForTimeout(1500);
  expect(await probe(page)).toMatchObject({ contexts: 0, tones: 0 });
  await page.locator('#panel-title').click();
  await expect.poll(async () => (await probe(page)).tones, { timeout: 10_000 }).toBeGreaterThan(3);

  await page.locator('#menu-open').click();
  await expect(page.locator('#music-volume')).toHaveValue('50');
  await page.locator('#music-muted').check();
  // Notes already scheduled may still start; after that, nothing new.
  await page.waitForTimeout(1500);
  const muted = (await probe(page)).tones;
  await page.waitForTimeout(3000);
  expect((await probe(page)).tones).toBe(muted);

  await page.locator('#music-volume').fill('20');
  await expect(page.locator('#music-volume-text')).toHaveText('20%');
  await page.reload();
  await page.locator('#menu-open').click();
  await expect(page.locator('#music-muted')).toBeChecked();
  await expect(page.locator('#music-volume')).toHaveValue('20');
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('tdi.save')!).settings);
  expect(settings).toMatchObject({ musicVolume: 0.2, musicMuted: true });
  expect(errors).toEqual([]);
});

/** Reads width and height from a PNG's header. */
function pngSize(bytes: Buffer): [number, number] {
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test('installable: manifest, icons and service worker scope', async ({ page, baseURL }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(baseURL);
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const manifestUrl = new URL(href!, page.url());
  const manifest = await (await page.request.get(manifestUrl.href)).json();
  expect(manifest).toMatchObject({ display: 'standalone', start_url: './', scope: './', background_color: '#12161F' });
  const sizes = new Set<string>();
  for (const icon of manifest.icons as { src: string; sizes: string }[]) {
    const bytes = await (await page.request.get(new URL(icon.src, manifestUrl).href)).body();
    expect(pngSize(bytes).join('x')).toBe(icon.sizes);
    sizes.add(icon.sizes);
  }
  expect([...sizes].sort()).toEqual(['192x192', '512x512']);
  expect(errors).toEqual([]);
});

test('the browser itself finds nothing stopping install', async ({ baseURL }) => {
  // Test pages normally run in a private profile, which browsers never install from.
  const profile = mkdtempSync(join(tmpdir(), 'tdi-profile-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'msedge', baseURL });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto('./');
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    expect(installabilityErrors).toEqual([]);
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('loads and plays with no network after the first visit', async ({ page, context }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await clickSlot(page, 0);
  await page.locator('[data-tower=bolt]').click();
  await pressPlay(page);
  await page.waitForTimeout(300);
  await context.setOffline(true);
  await page.reload();
  // The page shows 70 gold until the saved game starts.
  await expect(page.locator('#gold')).not.toHaveText('70');
  await clickSlot(page, 0);
  await expect(page.locator('#panel-title')).toHaveText('Bolt, level 1');
  // A new tab works offline too.
  const other = await context.newPage();
  await other.goto('./');
  await expect(other.locator('#blocker-title')).toHaveText('Running in another tab');
  await other.close();
  await expect(page.locator('#wave')).not.toHaveText('');
  expect(errors).toEqual([]);
});

test('3x keeps at least 85 steps a second with 4x CPU slowdown', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await seedSave(page, save(crowded(), { speed: 3 }));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('./');
  await expect(page.locator('#speed')).toHaveText('3x');
  // The game saves every 10 s; two saves give steps over real time.
  const read = (): Promise<{ savedAt: number; tick: number }> => page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('tdi.save')!);
    return { savedAt: s.savedAt, tick: s.state.tick };
  });
  const next = async (after: number): Promise<{ savedAt: number; tick: number }> => {
    await expect.poll(async () => (await read()).savedAt, { timeout: 30_000 }).toBeGreaterThan(after);
    return read();
  };
  const first = await next((await read()).savedAt);
  const second = await next(first.savedAt);
  const rate = (second.tick - first.tick) / ((second.savedAt - first.savedAt) / 1000);
  process.stdout.write(`3x with 4x CPU slowdown: ${rate.toFixed(1)} steps per second\n`);
  expect(rate).toBeGreaterThanOrEqual(85);
  expect(errors).toEqual([]);
});
