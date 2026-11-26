import { PERMANENT, PERMANENT_KINDS } from '../config/balance';
import type { Decoded, SaveData } from '../platform/save';
import type { Settings } from '../platform/settings';
import type { Send } from './ability-bar';
import { coresFor, headStartWave, permanentCost, prestigeBlocker } from '../sim/prestige';
import type { State } from '../sim/types';
import { button, byId, create, setText } from './dom';
import { formatNumber } from './format';

export interface MenuActions {
  /** Text to export, or undefined while no game is running. */
  exported(): string | undefined;
  readImport(text: string): Decoded;
  replaceWith(data: SaveData): void;
  reset(): void;
  /** The running game's settings, or undefined while no game is running. */
  settings(): Settings | undefined;
  setSound(volume: number, muted: boolean): void;
}

const on = (id: string, action: () => void): void => byId(id).addEventListener('click', action);

/** The menu dialog. Replacing or erasing a game always takes a second click. */
export class Menu {
  private readonly dialog = byId<HTMLDialogElement>('menu');
  private readonly exportText = byId<HTMLTextAreaElement>('export-text');
  private readonly importText = byId<HTMLTextAreaElement>('import-text');
  private readonly importMessage = byId('import-message');
  private readonly importConfirm = byId('import-confirm');
  private readonly resetConfirm = byId('reset-confirm');
  private checked: SaveData | undefined;
  private readonly prestigeConfirm = byId('prestige-confirm');
  private readonly prestigeButton = byId<HTMLButtonElement>('prestige');
  private readonly muted = byId<HTMLInputElement>('muted');
  private readonly volume = byId<HTMLInputElement>('volume');
  private readonly toggles = {
    autoUpgrade: byId<HTMLInputElement>('auto-upgrade'),
    autoCast: byId<HTMLInputElement>('auto-cast'),
  };

  private readonly upgrades = PERMANENT_KINDS.map((kind) => {
    const el = button(() => this.send({ type: 'buyPermanent', upgrade: kind }));
    el.classList.add('perm');
    el.dataset.upgrade = kind;
    const price = create('span', 'price');
    el.append(create('span', '', PERMANENT[kind].name), price, create('small', '', PERMANENT[kind].text));
    byId('permanent').append(el);
    return { kind, el, price };
  });

  get isOpen(): boolean {
    return this.dialog.open;
  }

  constructor(private readonly actions: MenuActions, private readonly send: Send) {
    on('prestige', () => { this.prestigeConfirm.hidden = false; });
    on('prestige-no', () => { this.prestigeConfirm.hidden = true; });
    on('prestige-yes', () => {
      this.prestigeConfirm.hidden = true;
      this.dialog.close();
      send({ type: 'prestige' });
    });
    for (const [option, el] of Object.entries(this.toggles)) {
      el.addEventListener('change', () => send({ type: 'setOption', option: option as 'autoUpgrade' | 'autoCast', value: el.checked }));
    }
    on('menu-open', () => this.open());
    on('blocker-menu', () => this.open());
    on('menu-close', () => this.dialog.close());
    on('export-copy', () => void this.copy());
    on('import-check', () => this.checkImport());
    on('import-no', () => this.clearImport());
    on('import-yes', () => {
      const data = this.checked;
      if (!data) return;
      this.dialog.close();
      actions.replaceWith(data);
    });
    on('reset', () => { this.resetConfirm.hidden = false; });
    on('reset-no', () => { this.resetConfirm.hidden = true; });
    on('reset-yes', () => {
      this.dialog.close();
      actions.reset();
    });
    this.importText.addEventListener('input', () => this.clearImport());
    const sound = (): void => {
      this.showVolume();
      actions.setSound(Number(this.volume.value) / 100, this.muted.checked);
    };
    this.muted.addEventListener('change', sound);
    this.volume.addEventListener('change', sound);
    this.volume.addEventListener('input', () => this.showVolume());
  }

  private open(): void {
    const text = this.actions.exported();
    byId('export-section').hidden = text === undefined;
    this.exportText.value = text ?? '';
    setText(byId('export-copy'), 'Copy');
    this.importText.value = '';
    this.clearImport();
    this.resetConfirm.hidden = true;
    this.prestigeConfirm.hidden = true;
    const settings = this.actions.settings();
    this.muted.disabled = this.volume.disabled = !settings;
    if (settings) {
      this.muted.checked = settings.muted;
      this.volume.value = String(Math.round(settings.volume * 100));
    }
    this.showVolume();
    this.dialog.showModal();
  }

  /** Keeps the prestige and upgrade sections current while the menu is open. */
  update(state: State | undefined): void {
    if (!this.dialog.open || !state) return;
    const blocker = prestigeBlocker(state);
    this.prestigeButton.disabled = blocker !== undefined;
    if (blocker) this.prestigeConfirm.hidden = true;
    setText(byId('prestige-text'), blocker
      ? `${blocker}. Best wave this run: ${state.bestRun}. Best ever: ${state.bestEver}.`
      : `Prestige now for ${formatNumber(coresFor(state.bestRun))} Cores and start again from wave ${headStartWave(state.bestEver)}. Best wave this run: ${state.bestRun}.`);
    setText(byId('cores-text'), `You have ${formatNumber(state.cores)} Cores.`);
    for (const { kind, el, price } of this.upgrades) {
      const def = PERMANENT[kind];
      const owned = (kind === 'autoUpgrade' || kind === 'autoCast') && state.owned[kind];
      const level = kind === 'power' ? state.power : kind === 'greed' ? state.greed : undefined;
      const cost = permanentCost(state, kind);
      setText(el.firstElementChild as HTMLElement, level === undefined ? def.name : `${def.name} (level ${level})`);
      setText(price, owned ? 'Owned' : formatNumber(cost, 'up'));
      el.disabled = owned || !state.cores.gte(cost);
    }
    for (const [option, el] of Object.entries(this.toggles) as ['autoUpgrade' | 'autoCast', HTMLInputElement][]) {
      el.disabled = !state.owned[option];
      if (document.activeElement !== el) el.checked = state.options[option];
    }
  }

  private showVolume(): void {
    setText(byId('volume-text'), `${this.volume.value}%`);
  }

  private async copy(): Promise<void> {
    this.exportText.select();
    try {
      await navigator.clipboard.writeText(this.exportText.value);
      setText(byId('export-copy'), 'Copied');
    } catch {
      setText(byId('export-copy'), 'Text selected. Copy it yourself.');
    }
  }

  private checkImport(): void {
    this.clearImport();
    const result = this.actions.readImport(this.importText.value);
    this.importMessage.hidden = false;
    if (!result.ok) {
      setText(this.importMessage, result.reason === 'newer'
        ? 'This save is from a newer version of the game.'
        : 'This text is not a valid save. Nothing was changed.');
      return;
    }
    const { state } = result.data;
    this.checked = result.data;
    setText(this.importMessage, `Wave ${state.wave}, best wave ${state.bestEver}, ${formatNumber(state.gold)} gold. Replace your current game?`);
    this.importConfirm.hidden = false;
  }

  private clearImport(): void {
    this.checked = undefined;
    this.importMessage.hidden = true;
    this.importConfirm.hidden = true;
  }
}
