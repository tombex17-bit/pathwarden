import { GUIDE_DONE, type Settings } from '../platform/settings';
import type { SimEvent, State } from '../sim/types';
import { byId, setText } from './dom';
import { guideOver, guideProgress, guideStep, type GuideTarget, type GuideView } from './guide-steps';
import { say } from './toast';

const TARGETS: Readonly<Record<Exclude<GuideTarget, 'slot'>, string>> = {
  bolt: '[data-tower=bolt]', upgrade: '#upgrade', meteor: '[data-ability=meteor]', play: '#pause',
};

/** Walks a new player through building, upgrading and Meteor during the first waves. */
export class Guide {
  /** The map slot to highlight, if any. */
  slot: number | undefined;

  private readonly box = byId('guide');
  private readonly text = byId('guide-text');
  private lastTarget: string | undefined;

  constructor(private readonly settings: () => Settings | undefined, private readonly changed: () => void) {
    byId('guide-skip').addEventListener('click', () => {
      const s = settings();
      if (!s) return;
      s.guide = GUIDE_DONE;
      changed();
    });
  }

  update(state: State, view: GuideView, events: readonly SimEvent[]): void {
    const settings = this.settings();
    if (!settings) return;
    const before = settings.guide;
    settings.guide = guideOver(before, state) ? GUIDE_DONE : guideProgress(before, state, events);
    if (settings.guide !== before) {
      // Only when the player saw it end, not when a game loads past it.
      if (settings.guide === GUIDE_DONE && !this.box.hidden) say('Guide finished. Keep building and upgrading: every wave is a bit stronger.', 5000);
      this.changed();
    }

    const step = guideStep(settings.guide, state, view);
    this.box.hidden = step === undefined;
    if (step) setText(this.text, step.text);
    this.slot = step?.target === 'slot' ? step.slot : undefined;
    for (const [target, selector] of Object.entries(TARGETS)) {
      const el = document.querySelector(selector);
      el?.classList.toggle('guide-target', step?.target === target);
      // Small screens may have scrolled the button out of the panel; bring it back once.
      if (el && step?.target === target && this.lastTarget !== target) el.scrollIntoView({ block: 'nearest' });
    }
    this.lastTarget = step?.target;
  }
}
