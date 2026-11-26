import { ABILITIES, ABILITY_KINDS, TICKS_PER_SECOND, type AbilityKind } from '../config/balance';
import type { Point } from '../config/map';
import { isUnlocked } from '../sim/abilities';
import type { Command, CommandResult, State } from '../sim/types';
import { button, byId, create, setText } from './dom';
import { say } from './toast';

export type Send = (command: Command, onResult?: (result: CommandResult) => void) => void;

/** The four ability buttons, choosing what to aim, and messages about casts. */
export class AbilityBar {
  /** The ability waiting for a point on the map. */
  aiming: AbilityKind | undefined;

  /** Abilities whose cast has been sent but not answered yet. */
  private readonly waiting = new Set<AbilityKind>();

  private readonly items = ABILITY_KINDS.map((ability, i) => {
    const el = button(() => this.toggle(ability));
    el.classList.add('ability');
    el.dataset.ability = ability;
    el.title = ABILITIES[ability].text;
    const fill = create('span', 'fill');
    const status = create('small');
    el.append(fill, create('span', 'name', ABILITIES[ability].name), status);
    el.setAttribute('aria-keyshortcuts', String(i + 1));
    byId('abilities').append(el);
    return { ability, el, fill, status, key: String(i + 1) };
  });

  constructor(private readonly send: Send) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') this.cancel();
      const item = this.items.find((x) => x.key === e.key);
      if (item && !item.el.disabled) this.toggle(item.ability);
    });
  }

  cancel(): void {
    this.aiming = undefined;
  }

  /** Casts the aimed ability; it stays aimed if the cast is refused. */
  castAt(at: Point): void {
    const ability = this.aiming;
    if (!ability || this.waiting.has(ability)) return;
    this.waiting.add(ability);
    this.send({ type: 'cast', ability, x: at.x, y: at.y }, (result) => {
      this.waiting.delete(ability);
      if (!result.ok) say(result.reason);
      else if (this.aiming === ability) this.cancel();
    });
  }

  update(state: State): void {
    for (const { ability, el, fill, status, key } of this.items) {
      const { unlockWave, cooldownSeconds } = ABILITIES[ability];
      const unlocked = isUnlocked(state, ability);
      const left = state.cooldowns[ability];
      const ready = unlocked && left === 0;
      el.disabled = !ready;
      if (!ready && this.aiming === ability) this.cancel();
      el.setAttribute('aria-pressed', String(this.aiming === ability));
      fill.style.width = unlocked ? `${(100 * left) / (cooldownSeconds * TICKS_PER_SECOND)}%` : '0';
      let text = `Key ${key}`;
      if (!unlocked) text = `Clear ${unlockWave}`;
      else if (left > 0) text = `${Math.ceil(left / TICKS_PER_SECOND)} s`;
      else if (this.aiming === ability) text = 'Pick a point';
      setText(status, text);
    }
  }

  private toggle(ability: AbilityKind): void {
    this.aiming = this.aiming === ability ? undefined : ability;
  }
}
