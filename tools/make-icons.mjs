// Draws the app icons in code and saves them as PNG (SPEC section 12): `npm run icons`.
import { chromium } from '@playwright/test';
import { COLORS, SHADES } from '../src/render/palette.ts';

const SIZES = [192, 512];

/** Runs in the page. Everything sits inside the middle 80%, the safe zone of maskable icons. */
function draw({ size, c, k }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(size / 10, size / 10);
  const circle = (x, y, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  // Meadow ground in a faint checkerboard.
  ctx.fillStyle = k.meadow;
  ctx.fillRect(0, 0, 10, 10);
  ctx.fillStyle = k.meadowLight;
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) if ((x + y) % 2 === 0) ctx.fillRect(x, y, 1, 1);
  // A bend of road, edged, with dashes.
  ctx.lineJoin = 'round';
  const road = () => {
    ctx.beginPath();
    ctx.moveTo(0.5, 3.4);
    ctx.lineTo(6.9, 3.4);
    ctx.lineTo(6.9, 9.5);
  };
  ctx.strokeStyle = k.roadEdge;
  ctx.lineWidth = 1.75;
  road();
  ctx.stroke();
  ctx.strokeStyle = c.path;
  ctx.lineWidth = 1.45;
  road();
  ctx.stroke();
  ctx.strokeStyle = k.roadLine;
  ctx.lineWidth = 0.1;
  ctx.setLineDash([0.35, 0.45]);
  road();
  ctx.stroke();
  ctx.setLineDash([]);
  // A bush and an enemy with eyes on the road.
  circle(8.4, 1.9, 0.45, k.leaf);
  circle(8.9, 2.1, 0.4, k.leaf);
  circle(8.3, 1.7, 0.18, k.leafLight);
  circle(3.1, 3.55, 0.6, k.enemyDark);
  circle(3.1, 3.4, 0.6, c.enemy);
  circle(2.85, 3.15, 0.15, k.enemyLight);
  for (const dy of [-0.2, 0.2]) {
    circle(3.4, 3.3 + dy, 0.13, c.text);
    circle(3.46, 3.3 + dy, 0.07, c.background);
  }
  // A Bolt tower on its slot, aiming at the enemy.
  ctx.fillStyle = c.panel;
  ctx.strokeStyle = c.bolt;
  ctx.lineWidth = 0.22;
  ctx.beginPath();
  ctx.arc(4.2, 6.2, 1.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  circle(4.2, 6.2, 0.7, k.boltDark);
  ctx.save();
  ctx.translate(4.2, 6.2);
  ctx.rotate(Math.atan2(3.4 - 6.2, 3.1 - 4.2));
  ctx.strokeStyle = k.boltDark;
  ctx.lineWidth = 0.2;
  ctx.beginPath();
  ctx.arc(0.06, 0, 0.85, -1, 1);
  ctx.stroke();
  ctx.fillStyle = c.bolt;
  ctx.fillRect(0, -0.11, 1.05, 0.22);
  ctx.beginPath();
  ctx.moveTo(0.62, 0);
  ctx.lineTo(0, 0.45);
  ctx.lineTo(-0.62, 0);
  ctx.lineTo(0, -0.45);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  return canvas.toDataURL('image/png');
}

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
const { writeFile } = await import('node:fs/promises');
for (const size of SIZES) {
  const url = await page.evaluate(draw, { size, c: COLORS, k: SHADES });
  await writeFile(`public/icons/icon-${size}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`public/icons/icon-${size}.png`);
}
await browser.close();
