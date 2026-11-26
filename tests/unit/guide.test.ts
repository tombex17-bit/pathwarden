import Decimal from 'break_infinity.js';
import { describe, expect, it } from 'vitest';
import { GOLD } from '../../src/config/balance';
import { GUIDE_DONE, GUIDE_STEPS } from '../../src/platform/settings';
import { createNewGame, createState, step } from '../../src/sim/sim';
import type { State } from '../../src/sim/types';
import { foeRows } from '../../src/ui/foes';
import { GUIDE_SLOTS, guideOver, guideProgress, guideStep, type GuideView } from '../../src/ui/guide-steps';
import { addTower, emptyField, place } from './helpers';

const nothing: GuideView = { selectedSlot: undefined, aiming: undefined };
const { built, upgraded, meteor, second } = GUIDE_STEPS;

describe('guide steps', () => {
  it('starts by pointing at the best slot, then at Bolt', () => {
    const s = createNewGame(1);
    expect(guideStep(0, s, nothing)).toMatchObject({ target: 'slot', slot: GUIDE_SLOTS[0] });
    expect(guideStep(0, s, { ...nothing, selectedSlot: 3 })).toEqual({
      text: `Pick Bolt: fast single shots for 50 of your ${GOLD.start} gold.`, target: 'bolt',
    });
  });

  it('asks for an upgrade only once it is affordable, pointing at the tower and then the button', () => {
    const s = createNewGame(1);
    step(s, [{ type: 'build', slot: 5, tower: 'bolt' }]);
    s.gold = new Decimal(10);
    expect(guideStep(built, s, nothing)).toEqual({ text: 'Defeated enemies give gold. At 22 gold you can upgrade your tower.' });
    s.gold = new Decimal(30);
    expect(guideStep(built, s, nothing)).toMatchObject({ target: 'slot', slot: 5 });
    expect(guideStep(built, s, { ...nothing, selectedSlot: 5 })).toMatchObject({ target: 'upgrade' });
  });

  it('teaches Meteor once 3 enemies are out and it is ready', () => {
    const s = emptyField();
    s.gold = new Decimal(0);
    addTower(s, 5, 'bolt', { level: 2 });
    const done = built | upgraded;
    place(s, 'grunt', 1);
    place(s, 'grunt', 2);
    expect(guideStep(done, s, nothing)?.target).toBeUndefined();
    place(s, 'grunt', 3);
    expect(guideStep(done, s, nothing)).toMatchObject({ target: 'meteor' });
    expect(guideStep(done, s, { ...nothing, aiming: 'meteor' })?.text).toBe('Now tap where the enemies are bunched up.');
    s.cooldowns.meteor = 10;
    expect(guideStep(done, s, nothing)?.target).toBeUndefined();
  });

  it('then asks for a second tower in the next free guided slot', () => {
    const s = emptyField();
    addTower(s, 0, 'bolt', { level: 2 });
    s.gold = new Decimal(10);
    const done = built | upgraded | meteor;
    expect(guideStep(done, s, nothing)?.text).toBe('More towers cover more of the path. Save up 80 gold for a second one.');
    s.gold = new Decimal(80);
    // Slot 0 is taken here, so the guide points at slot 5.
    expect(guideStep(done, s, nothing)).toMatchObject({ target: 'slot', slot: 5 });
    expect(guideStep(done, s, { ...nothing, selectedSlot: 5 })).toMatchObject({ target: 'bolt' });
  });

  it('records steps from the state and from Meteor casts', () => {
    const s = emptyField();
    expect(guideProgress(0, s, [])).toBe(0);
    addTower(s, 0, 'bolt');
    expect(guideProgress(0, s, [])).toBe(built);
    addTower(s, 1, 'bolt', { level: 3 });
    expect(guideProgress(0, s, [{ type: 'cast', ability: 'stasis', x: 0, y: 0 }])).toBe(built | second | upgraded);
    expect(guideProgress(0, s, [{ type: 'cast', ability: 'meteor', x: 0, y: 0 }])).toBe(GUIDE_DONE);
  });

  it('ends when every step is done, or once wave 3 is cleared', () => {
    const s: State = createNewGame(1);
    expect(guideOver(GUIDE_DONE, s)).toBe(true);
    expect(guideStep(GUIDE_DONE, s, nothing)).toBeUndefined();
    s.bestEver = 2;
    expect(guideOver(0, s)).toBe(false);
    s.bestEver = 3;
    expect(guideOver(0, s)).toBe(true);
  });
});

describe('enemy list', () => {
  it('counts enemies on the field and still to come, by kind, with their stats', () => {
    const s = createState(1, 20);
    s.spawns = [{ tick: 5, kind: 'grunt' }, { tick: 9, kind: 'boss' }];
    s.enemies = [];
    place(s, 'grunt', 1);
    place(s, 'shielded', 2);
    const rows = foeRows(s);
    expect(rows.map((r) => [r.kind, r.left])).toEqual([['grunt', 2], ['shielded', 1], ['boss', 1]]);
    const grunt = rows[0]!;
    expect(grunt.hp.toNumber()).toBeCloseTo(14 * 1.09 ** 19, 6);
    expect(grunt.gold.toNumber()).toBeCloseTo(2 * 1.065 ** 19, 6);
    expect(grunt.speed).toBe(2);
    expect(rows[2]!.hp.toNumber()).toBeCloseTo(140 * 1.09 ** 19, 4);
  });

  it('is empty once the wave is beaten', () => {
    const s = emptyField();
    expect(foeRows(s)).toEqual([]);
  });
});
