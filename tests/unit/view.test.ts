import { describe, expect, it } from 'vitest';
import { MAPS } from '../../src/config/map';
import { FrameStepper } from '../../src/platform/frame-stepper';
import { fitView, slotAt, toScreen } from '../../src/render/view';

describe('FrameStepper', () => {
  it('runs 30 steps per real second at 1x and 90 at 3x', () => {
    for (const [speed, expected] of [[1, 30], [3, 90]] as const) {
      const s = new FrameStepper();
      let steps = 0;
      for (let i = 0; i < 60; i++) steps += s.advance(1000 / 60, speed);
      expect(Math.abs(steps - expected)).toBeLessThanOrEqual(1);
    }
  });

  it('runs at most 12 steps and drops the surplus', () => {
    const s = new FrameStepper();
    expect(s.advance(60_000)).toBe(12);
    expect(s.alpha).toBe(0);
    expect(s.advance(0)).toBe(0);
  });

  it('ignores negative time', () => {
    expect(new FrameStepper().advance(-500)).toBe(0);
  });
});

describe('view', () => {
  it('keeps the aspect ratio and centers the map', () => {
    expect(fitView(1600, 1000)).toEqual({ scale: 100, left: 0, top: 50 });
    expect(fitView(2000, 900)).toEqual({ scale: 100, left: 200, top: 0 });
  });

  it('finds every slot on a 360 px wide phone, within 22 px', () => {
    const view = fitView(360, 202.5);
    MAPS.switchback.slots.forEach((slot, i) => {
      const s = toScreen(view, slot);
      expect(slotAt(view, s.x + 21, s.y, MAPS.switchback.slots)).toBe(i);
    });
    const first = toScreen(view, MAPS.switchback.slots[0]);
    expect(slotAt(view, first.x, first.y + 23, MAPS.switchback.slots)).toBeUndefined();
  });
});
