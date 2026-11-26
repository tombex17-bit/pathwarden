import Decimal from 'break_infinity.js';
import { BUY_AMOUNTS, SPEC_LEVEL, TOWERS, TOWER_KINDS, type BuyAmount, type SpecChoice, type TowerKind } from '../config/balance';
import { COLORS } from '../render/palette';
import { fillTower } from '../render/shapes';
import { buildCost, canAfford, levelsFor, sellValue, upgradeCost } from '../sim/economy';
import { towerStats } from '../sim/stats';
import type { Command, SimEvent, State, Tower } from '../sim/types';
import { button, byId, create, setText } from './dom';
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
    ctx.fillStyle = COLORS[kind];
    fillTower(ctx, kind, { x: 1 / 2.8, y: 1 / 2.8 });
  }
  return icon;
}

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
  }

  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'waveLost') setText(this.banner, `Wave ${e.wave} lost. Back to wave ${e.nextWave}.`);
      if (e.type === 'prestige') {
        this.selectedSlot = undefined;
        say(`Prestige: +${formatNumber(e.cores)} Cores. New run from wave ${e.wave}.`);
      }
    }
  }

  update(state: State): void {
    setText(this.wave, String(state.wave));
    setText(this.lives, String(Math.max(0, state.lives)));
    setText(this.gold, formatNumber(state.gold));
    setText(this.best, String(state.bestEver));
    setText(this.cores, formatNumber(state.cores));
    this.banner.hidden = state.restartTicks === 0;
    this.autoAdvance.checked = state.autoAdvance;

    const tower = state.towers.find((t) => t.slot === this.selectedSlot);
    this.shop.hidden = this.selectedSlot === undefined || tower !== undefined;
    this.tower.hidden = tower === undefined;
    if (tower) this.showTower(state, tower);
    else if (this.selectedSlot !== undefined) this.showShop(state);
    else {
      setText(this.title, 'Build');
      setText(this.text, 'Pick a slot on the map to place a tower.');
    }
  }

  private withSlot(action: (slot: number) => void): void {
    if (this.selectedSlot !== undefined) action(this.selectedSlot);
  }

  private showShop(state: State): void {
    setText(this.title, 'Empty slot');
    setText(this.text, 'Choose a tower.');
    const cost = buildCost(state.towers.length);
    for (const { el, price } of this.shopItems) {
      setText(price, formatNumber(cost, 'up'));
      el.disabled = !canAfford(state.gold, cost);
    }
  }

  private showTower(state: State, tower: Tower): void {
    const def = TOWERS[tower.kind];
    const stats = towerStats(tower.kind, tower.spec);
    setText(this.title, `${def.name}, level ${tower.level}`);
    const damage = Decimal.pow10(tower.log10Damage);
    const shownDamage = damage.lt(10) ? oneDecimal(damage.toNumber()) : formatNumber(damage);
    const spec = tower.spec ? `${def.specs[tower.spec].name}. ` : '';
    setText(
      this.text,
      `${spec}${shownDamage} damage, ${oneDecimal(stats.hitsPerSecond)} hits per second, range ${oneDecimal(stats.range)}`,
    );

    this.specs.hidden = tower.level < SPEC_LEVEL || tower.spec !== null;
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
}
