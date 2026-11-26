import Decimal from 'break_infinity.js';
import {
  BUY_AMOUNTS, CHALLENGES, ENEMIES, HERO, MERGE, OVERDRIVE, RALLY, RANKS, SPEC_LEVEL, TOWERS, TOWER_KINDS,
  type BuyAmount, type EnemyKind, type SpecChoice, type TowerKind,
} from '../config/balance';
import { MAPS, MAZE } from '../config/map';
import { drawEnemy, drawTower } from '../render/art';
import { buildCost, canAfford, levelsFor, sellValue, upgradeCost } from '../sim/economy';
import { canCallWave, canEditWalls } from '../sim/sim';
import { rankOf } from '../sim/stats';
import { builtTowers, heroOf, isHero } from '../sim/towers';
import { towerStats } from '../sim/stats';
import type { Command, SimEvent, State, Tower } from '../sim/types';
import { button, byId, create, setText } from './dom';
import { foeRows } from './foes';
import { formatNumber } from './format';
import { say } from './toast';

function towerIcon(kind: TowerKind): HTMLCanvasElement {
  const icon = create('canvas');
  const size = 72;
  icon.width = size;
  icon.height = size;
  const ctx = icon.getContext('2d');
  if (ctx) {
    ctx.scale(size * 1.4, size * 1.4);
    drawTower(ctx, kind, { x: 1 / 2.8, y: 1 / 2.8 }, -Math.PI / 2);
  }
  return icon;
}

function enemyIcon(kind: EnemyKind): HTMLCanvasElement {
  const icon = create('canvas');
  const size = 72;
  icon.width = size;
  icon.height = size;
  const ctx = icon.getContext('2d');
  if (ctx) {
    // One cell fills the icon, so sizes compare as on the map.
    ctx.scale(size, size);
    drawEnemy(ctx, kind, { x: 0.5, y: 0.55 }, { x: 1, y: 0 }, false);
  }
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

const TIER_NAMES = ['', '', ' II', ' III'];

/** A tower's name with its tier, such as "Bolt II". */
export const towerName = (t: Tower): string => `${TOWERS[t.kind].name}${TIER_NAMES[t.tier] ?? ''}`;

const oneDecimal = (n: number): string => String(Math.round(n * 10) / 10);
const CHOICES: readonly SpecChoice[] = ['a', 'b'];

/** Shows the state in the DOM and turns clicks into commands. */
export class Hud {
  selectedSlot: number | undefined;

  private amount: BuyAmount = 1;
  private readonly wave = byId('wave');
  private readonly lives = byId('lives');
  private readonly gold = byId('gold');
  private readonly best = byId('best');
  private readonly cores = byId('cores');
  private readonly banner = byId('banner');
  private readonly title = byId('panel-title');
  private readonly text = byId('panel-text');
  private readonly shop = byId('shop');
  private readonly tower = byId('tower');
  private readonly specs = byId('specs');
  private readonly upgrade = byId<HTMLButtonElement>('upgrade');
  private readonly sell = byId<HTMLButtonElement>('sell');
  private readonly autoAdvance = byId<HTMLInputElement>('auto-advance');
  private readonly foes = byId('foes');
  private foesShown = '';
  private readonly callWave = byId<HTMLButtonElement>('call-wave');
  private readonly boost = byId<HTMLButtonElement>('boost');
  private readonly pause = byId<HTMLButtonElement>('pause');
  private readonly challengeBadge = byId('challenge-badge');
  private paused = false;
  private readonly wallsEdit = byId<HTMLButtonElement>('walls-edit');
  /** Map clicks place and remove Maze walls while this is on. */
  editingWalls = false;
  private readonly extra = byId('tower-extra');
  private readonly merge = byId('merge');
  private mergeShown = '';

  private readonly heroItem = (() => {
    const el = button(() => this.withSlot((slot) => this.send({ type: 'placeHero', slot })));
    el.classList.add('buy');
    el.id = 'place-hero';
    const name = create('span');
    const price = create('span', 'price');
    el.append(towerIcon('warden'), name, price, create('small', '', TOWERS.warden.text));
    this.shop.append(el);
    return { el, name, price };
  })();

  private readonly shopItems = TOWER_KINDS.map((kind) => {
    const el = button(() => this.withSlot((slot) => this.send({ type: 'build', slot, tower: kind })));
    el.classList.add('buy');
    el.dataset.tower = kind;
    const price = create('span', 'price');
    el.append(towerIcon(kind), create('span', '', TOWERS[kind].name), price, create('small', '', TOWERS[kind].text));
    this.shop.append(el);
    return { el, price };
  });

  private readonly specItems = CHOICES.map((choice) => {
    const el = button(() => this.withSlot((slot) => this.send({ type: 'specialize', slot, choice })));
    el.dataset.spec = choice;
    const name = create('span');
    const text = create('small');
    el.append(name, text);
    this.specs.append(el);
    return { choice, name, text };
  });

  private readonly amountItems = BUY_AMOUNTS.map((amount) => {
    const el = button(() => { this.amount = amount; });
    el.dataset.amount = String(amount);
    el.textContent = amount === 'max' ? 'Max' : `${amount}`;
    byId('amounts').append(el);
    return { el, amount };
  });

  constructor(private readonly send: (command: Command) => void) {
    this.upgrade.addEventListener('click', () => {
      this.withSlot((slot) => send({ type: 'upgrade', slot, amount: this.amount }));
    });
    this.sell.addEventListener('click', () => this.withSlot((slot) => send({ type: 'sell', slot })));
    this.autoAdvance.addEventListener('change', () => {
      send({ type: 'setOption', option: 'autoAdvance', value: this.autoAdvance.checked });
    });
    this.callWave.addEventListener('click', () => send({ type: 'callWave' }));
    this.pause.addEventListener('click', () => send({ type: 'setPause', paused: !this.paused }));
    this.boost.addEventListener('click', () => this.withSlot((slot) => {
      const hero = this.boost.dataset.rally === 'true';
      send(hero ? { type: 'rally' } : { type: 'boost', slot });
    }));
    this.wallsEdit.addEventListener('click', () => { this.editingWalls = !this.editingWalls; });
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || document.querySelector('dialog[open]')) return;
      if (e.key === 'n' || e.key === 'N') send({ type: 'callWave' });
      // Space pauses, unless a button or text field has the focus and would take it.
      const target = e.target as HTMLElement | null;
      if (e.key === ' ' && !(target && /^(BUTTON|INPUT|TEXTAREA)$/.test(target.tagName))) {
        e.preventDefault();
        send({ type: 'setPause', paused: !this.paused });
      }
    });
  }

  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'waveLost') setText(this.banner, `Wave ${e.wave} lost. Back to wave ${e.nextWave}.`);
      if (e.type === 'prestige') {
        this.selectedSlot = undefined;
        say(`Prestige: +${formatNumber(e.cores)} Cores. New run from wave ${e.wave}.`);
      }
      if (e.type === 'waveClear' && e.wave === HERO.unlockWave) say('The Warden is ready: pick an empty slot to place your hero.', 5000);
      for (const map of Object.values(MAPS)) {
        if (e.type === 'waveClear' && map.unlockWave > 0 && e.wave === map.unlockWave) say(`New map: ${map.name}. Pick it in the menu.`, 5000);
      }
      if (e.type === 'mapChange') say(`Now on ${MAPS[e.map].name}.`);
      if (e.type === 'merge') say(`Merged into ${TOWERS[e.kind].name}${TIER_NAMES[e.tier] ?? ''}.`);
      if (e.type === 'rankUp' && e.kind !== 'warden') say(`${TOWERS[e.kind].name} in slot ${e.slot + 1} reached rank ${e.rank}.`);
    }
  }

  update(state: State): void {
    setText(this.wave, String(state.wave));
    setText(this.lives, String(Math.max(0, state.lives)));
    setText(this.gold, formatNumber(state.gold));
    setText(this.best, String(state.bestEver));
    setText(this.cores, formatNumber(state.cores));
    this.banner.hidden = state.restartTicks === 0;
    this.paused = state.paused;
    this.pause.setAttribute('aria-pressed', String(state.paused));
    setText(byId('pause-label'), state.paused ? 'Play' : 'Pause');
    byId('paused-badge').hidden = !state.paused;
    this.challengeBadge.hidden = state.challenges.length === 0;
    if (state.challenges.length > 0) setText(this.challengeBadge, `Challenge: ${state.challenges.map((c) => CHALLENGES[c].name).join(', ')}`);
    this.autoAdvance.checked = state.autoAdvance;

    const tower = state.towers.find((t) => t.slot === this.selectedSlot);
    this.shop.hidden = this.selectedSlot === undefined || tower !== undefined;
    this.tower.hidden = tower === undefined;
    if (tower) this.showTower(state, tower);
    else if (this.selectedSlot !== undefined) this.showShop(state);
    else {
      setText(this.title, 'Build');
      setText(this.text, state.holdForTower
        ? 'Wave 1 starts when you build your first tower. Pick a slot on the map.'
        : 'Pick a slot on the map to place a tower.');
    }
    const callable = this.selectedSlot === undefined && canCallWave(state);
    this.callWave.hidden = !callable;
    if (callable) setText(this.callWave, `Next wave now (N)`);
    const maze = state.map === 'maze' || state.nextMap === 'maze';
    byId('walls').hidden = !maze || this.selectedSlot !== undefined;
    if (!maze) this.editingWalls = false;
    if (maze) {
      this.wallsEdit.setAttribute('aria-pressed', String(this.editingWalls));
      setText(this.wallsEdit, this.editingWalls ? 'Done placing walls' : 'Place walls');
      setText(byId('walls-text'), `${state.walls.length} of ${MAZE.maxWalls} walls. ${canEditWalls(state) ? 'Tap squares to add or remove walls.' : 'Walls change only while the road is empty.'}`);
    }
    this.foes.hidden = this.selectedSlot !== undefined;
    if (!this.foes.hidden) this.showFoes(state);
  }

  /** The enemies left in this wave. Rebuilt only when something shown changes. */
  private showFoes(state: State): void {
    const rows = foeRows(state).map((r) => ({
      kind: r.kind, left: r.left, hp: formatNumber(r.hp), gold: formatNumber(r.gold), speed: oneDecimal(r.speed),
    }));
    const key = `${state.wave}|${JSON.stringify(rows)}`;
    if (key === this.foesShown) return;
    this.foesShown = key;
    setText(byId('foes-title'), rows.length > 0 ? `Wave ${state.wave} enemies left` : `Wave ${state.wave} cleared`);
    byId('foe-list').replaceChildren(...rows.map((r) => {
      const def = ENEMIES[r.kind];
      const row = create('div', 'foe');
      row.dataset.enemy = r.kind;
      const details = [`Gold ${r.gold}`, `Speed ${r.speed}`, def.note].filter(Boolean).join(' · ');
      row.append(
        enemyIcon(r.kind), create('span', 'foe-name', `${def.name} ×${r.left}`),
        create('span', 'foe-hp', `HP ${r.hp}`), create('small', '', details),
      );
      return row;
    }));
  }

  private withSlot(action: (slot: number) => void): void {
    if (this.selectedSlot !== undefined) action(this.selectedSlot);
  }

  private showShop(state: State): void {
    setText(this.title, 'Empty slot');
    setText(this.text, 'Choose a tower.');
    const cost = buildCost(builtTowers(state));
    for (const { el, price } of this.shopItems) {
      setText(price, formatNumber(cost, 'up'));
      el.disabled = !canAfford(state.gold, cost);
    }
    const { el, name, price } = this.heroItem;
    el.hidden = state.bestEver < HERO.unlockWave;
    const hero = heroOf(state);
    setText(name, hero ? 'Move the Warden here' : 'Place the Warden here');
    const wait = Math.ceil(state.heroMoveTicks / 30);
    setText(price, hero && wait > 0 ? `${wait} s` : 'Free');
    el.disabled = hero !== undefined && wait > 0;
  }

  private showTower(state: State, tower: Tower): void {
    const def = TOWERS[tower.kind];
    const stats = towerStats(tower.kind, tower.spec);
    setText(this.title, `${towerName(tower)}, level ${tower.level}`);
    const hero = isHero(tower);
    for (const el of [byId('amounts'), this.upgrade, this.sell]) el.hidden = hero;
    const damage = Decimal.pow10(tower.log10Damage);
    const shownDamage = damage.lt(10) ? oneDecimal(damage.toNumber()) : formatNumber(damage);
    const spec = tower.spec ? `${def.specs[tower.spec].name}. ` : '';
    setText(
      this.text,
      `${spec}${shownDamage} damage, ${oneDecimal(stats.hitsPerSecond)} hits per second, range ${oneDecimal(stats.range)}`,
    );

    const rank = rankOf(tower.kills);
    const nextRank = RANKS.kills[rank];
    const ranks = `Rank ${rank} of ${RANKS.kills.length}, ${tower.kills} kills${nextRank ? `; next rank at ${nextRank}` : ''}.`;
    setText(this.extra, hero
      ? `Boosts towers within ${HERO.auraRange} cells by ${Math.round((HERO.auraMult - 1) * 100)}%. Next level: ${formatNumber(state.heroXp)} of ${formatNumber(upgradeCost(tower.level), 'up')} experience, from half of all gold earned. To move it, pick an empty slot. ${ranks}`
      : ranks);
    this.showMerge(state, tower);
    this.showBoost(state, tower, hero);

    this.specs.hidden = hero || tower.level < SPEC_LEVEL || tower.spec !== null;
    for (const { choice, name, text } of this.specItems) {
      setText(name, def.specs[choice].name);
      setText(text, def.specs[choice].text);
    }

    for (const { el, amount } of this.amountItems) el.setAttribute('aria-pressed', String(amount === this.amount));
    const count = levelsFor(this.amount, state.gold, tower.level);
    const cost = upgradeCost(tower.level, count);
    setText(this.upgrade, `Upgrade +${count} for ${formatNumber(cost, 'up')}`);
    this.upgrade.disabled = !canAfford(state.gold, cost);
    setText(this.sell, `Sell for ${formatNumber(sellValue(tower))}`);
  }

  /** Overdrive for a tower, Rally for the Warden: ready, running, or cooling down. */
  private showBoost(state: State, tower: Tower, hero: boolean): void {
    const { boost } = this;
    boost.dataset.rally = String(hero);
    const left = hero ? state.rallyTicks : tower.boostTicks;
    const wait = hero ? state.rallyCooldown : tower.boostCooldown;
    const name = hero
      ? `Rally: all towers x${RALLY.damageMult} damage for ${RALLY.seconds} s`
      : `Overdrive: x${OVERDRIVE.speedMult} attack speed for ${OVERDRIVE.seconds} s`;
    if (left > 0) setText(boost, `${hero ? 'Rally' : 'Overdrive'} active: ${Math.ceil(left / 30)} s`);
    else if (wait > 0) setText(boost, `${hero ? 'Rally' : 'Overdrive'} ready in ${Math.ceil(wait / 30)} s`);
    else setText(boost, name);
    boost.disabled = left > 0 || wait > 0;
  }

  /** Towers this one can merge with, as buttons. Rebuilt only when something shown changes. */
  private showMerge(state: State, tower: Tower): void {
    this.merge.hidden = isHero(tower);
    if (this.merge.hidden) return;
    const partners = state.towers.filter((t) => t !== tower && t.kind === tower.kind && t.spec === tower.spec && t.tier === tower.tier);
    const ready = (t: Tower): boolean => Math.min(t.level, tower.level) >= MERGE.minLevel && tower.tier < MERGE.maxTier;
    const text = tower.tier >= MERGE.maxTier
      ? 'Already at the highest tier.'
      : `Two ${towerName(tower)} towers at level ${MERGE.minLevel} or more, with the same specialization, merge into one with x${MERGE.tierMult} damage and the higher level. The other slot is freed.`;
    const key = `${tower.slot}|${text}|${partners.map((t) => `${t.slot}:${t.level}:${ready(t)}`).join()}`;
    if (key === this.mergeShown) return;
    this.mergeShown = key;
    setText(byId('merge-text'), text);
    byId('merge-list').replaceChildren(...partners.map((t) => {
      const el = button(() => this.send({ type: 'merge', slot: tower.slot, from: t.slot }));
      el.dataset.mergeFrom = String(t.slot);
      el.textContent = `Merge with ${towerName(t)} in slot ${t.slot + 1} (level ${t.level})`;
      el.disabled = !ready(t);
      return el;
    }));
  }
}
