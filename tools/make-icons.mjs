// Draws the app icons in code and saves them as PNG (SPEC section 12): `npm run icons`.
import { chromium } from '@playwright/test';
import { COLORS } from '../src/render/palette.ts';

const SIZES = [192, 512];

/** Runs in the page. Everything sits inside the middle 80%, the safe zone of maskable icons. */
function draw({ size, c }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(size / 10, size / 10);
  ctx.fillStyle = c.background;
  ctx.fillRect(0, 0, 10, 10);
  // A bend of path with an enemy on it.
  ctx.strokeStyle = c.path;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(1, 3.2);
  ctx.lineTo(6.8, 3.2);
  ctx.lineTo(6.8, 9);
  ctx.stroke();
  ctx.fillStyle = c.enemy;
  ctx.beginPath();
  ctx.arc(3, 3.2, 0.55, 0, Math.PI * 2);
  ctx.fill();
  // A Bolt tower on its slot.
  ctx.fillStyle = c.panel;
  ctx.strokeStyle = c.bolt;
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  ctx.arc(4.2, 6.2, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = c.bolt;
  ctx.beginPath();
  ctx.moveTo(4.2, 5.1);
  ctx.lineTo(5, 6.2);
  ctx.lineTo(4.2, 7.3);
  ctx.lineTo(3.4, 6.2);
  ctx.closePath();
  ctx.fill();
  return canvas.toDataURL('image/png');
}

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
const { writeFile } = await import('node:fs/promises');
for (const size of SIZES) {
  const url = await page.evaluate(draw, { size, c: COLORS });
  await writeFile(`public/icons/icon-${size}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`public/icons/icon-${size}.png`);
}
await browser.close();
