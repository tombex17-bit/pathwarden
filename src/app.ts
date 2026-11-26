import type { Point } from './config/map';
import { encode, exportText, importText, type SaveData } from './platform/save';
import { SaveStore } from './platform/save-store';
import { Session, deservesSummary, type Away, type OnResult } from './platform/session';
import { SPEEDS, defaultSettings } from './platform/settings';
import { SoundPlayer } from './platform/audio';
import { MusicPlayer } from './platform/music';
import { SoundPicker } from './platform/sounds';
import { registerOffline } from './platform/offline';
import { claimTab } from './platform/tab-lock';
import { Renderer } from './render/renderer';
import { fitView, slotAt, toGrid, type View } from './render/view';
import { layoutOf } from './sim/path';
import { createNewGame } from './sim/sim';
import { say } from './ui/toast';
import type { Command } from './sim/types';
import { AbilityBar } from './ui/ability-bar';
import { byId, setText } from './ui/dom';
import { formatDuration, formatNumber } from './ui/format';
import { Guide } from './ui/guide';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';

const SAVE_EVERY_MS = 10_000;
const NO_STORAGE = 'This browser is not storing data, so progress will not be kept.';

const canvas = byId<HTMLCanvasElement>('map');
const renderer = new Renderer(canvas);
const store = new SaveStore(() => window.localStorage);
/** The running game; unset while another tab runs or a damaged save needs a decision. */
let session: Session | undefined;
let lastSave = 0;
/** Where the mouse is, in pixels on the page; unset for touch. */
let pointer: Point | undefined;
const player = new SoundPlayer();
const music = new MusicPlayer();
const picker = new SoundPicker();
const PURCHASES = new Set<Command['type']>(['build', 'upgrade', 'specialize', 'buyPermanent']);

const send = (command: Command, onResult?: OnResult): void => {
  session?.send(command, (result) => {
    onResult?.(result);
    if (result.ok && PURCHASES.has(command.type) && picker.allow('purchase', performance.now())) player.play({ name: 'purchase' });
    // Options are settings, so they are saved at once, like prestiges and permanent upgrades.
    if (result.ok && (command.type === 'setOption' || command.type === 'prestige' || command.type === 'buyPermanent')) save();
  });
};
const hud = new Hud(send);
const abilities = new AbilityBar(send);
const menu = new Menu({
  exported: () => session && exportText(encode(session.state, session.settings, Date.now())),
  readImport: importText,
  // Imported games start now: time since the export is not paid.
  replaceWith: (data) => replaceGame({ ...data, savedAt: Date.now() }),
  reset: () => replaceGame(newGame()),
  settings: () => session?.settings,
  setSound: (volume, muted) => {
    if (!session) return;
    Object.assign(session.settings, { volume, muted });
    player.setVolume(volume, muted);
    save();
  },
  setMusic: (musicVolume, musicMuted) => {
    if (!session) return;
    Object.assign(session.settings, { musicVolume, musicMuted });
    music.setVolume(musicVolume, musicMuted);
    save();
  },
}, send);

const guide = new Guide(() => session?.settings, () => save());

function newGame(): SaveData {
  return { state: createNewGame(Math.floor(Math.random() * 2 ** 31)), settings: defaultSettings(), savedAt: Date.now() };
}

function run(data: SaveData): void {
  session = new Session(data.state, data.settings, Date.now(), data.savedAt);
  if (document.visibilityState === 'hidden') session.hide(Date.now());
  hud.selectedSlot = undefined;
  abilities.cancel();
  byId('blocker').hidden = true;
  byId('away').hidden = true;
  showAway(session.loadedAway);
  setText(byId('speed'), `${data.settings.speed}x`);
  player.setVolume(data.settings.volume, data.settings.muted);
  music.setVolume(data.settings.musicVolume, data.settings.musicMuted);
}

function replaceGame(data: SaveData): void {
  store.allowOverwrite();
  run(data);
  save();
}

function save(): void {
  if (!session) return;
  session.flush();
  lastSave = performance.now();
  if (!store.save(encode(session.state, session.settings, Date.now()))) warn(NO_STORAGE);
}

function warn(text: string): void {
  setText(byId('warning'), text);
  byId('warning').hidden = false;
}

function block(title: string, text: string, canReplace: boolean): void {
  setText(byId('blocker-title'), title);
  setText(byId('blocker-text'), text);
  byId('blocker-menu').hidden = !canReplace;
  byId('blocker').hidden = false;
}

function showAway(away: Away | undefined): void {
  if (!deservesSummary(away)) return;
  setText(byId('away-text'), `You were away for ${formatDuration(away.seconds)} and earned ${formatNumber(away.gold)} gold.`);
  byId('away').hidden = false;
}

function start(locked: boolean): void {
  byId('blocker').hidden = true;
  if (!locked) warn('This browser cannot tell whether the game is open in another tab. Use only one tab.');
  const loaded = store.load();
  switch (loaded.kind) {
    case 'loaded':
      run(loaded.data);
      if (loaded.from === 'backup') warn('The last save was damaged, so an earlier one was loaded.');
      break;
    case 'new':
      run(newGame());
      break;
    case 'unavailable':
      run(newGame());
      warn(NO_STORAGE);
      break;
    case 'corrupt':
      block('Your save is damaged', 'Neither the save nor its backup can be read. Nothing has been overwritten. You can import a save or start a new game.', true);
      break;
    case 'newer':
      block('Your save is from a newer version', 'Reload the page to get the latest version of the game. Nothing has been overwritten.', true);
      break;
  }
}

// The view is measured at each use, because the last drawn frame may be missing or out of date.
function locate(clientX: number, clientY: number): { view: View; x: number; y: number } {
  const box = canvas.getBoundingClientRect();
  return { view: fitView(box.width, box.height), x: clientX - box.left, y: clientY - box.top };
}

canvas.addEventListener('click', (e) => {
  if (!session) return;
  const { view, x, y } = locate(e.clientX, e.clientY);
  if (abilities.aiming) {
    abilities.castAt(toGrid(view, x, y));
    return;
  }
  const point = toGrid(view, x, y);
  if (hud.editingWalls) {
    send({ type: 'toggleWall', ...point }, (result) => { if (!result.ok) say(result.reason); });
    return;
  }
  const slot = slotAt(view, x, y, layoutOf(session.state).slots);
  if (slot !== undefined) {
    hud.selectedSlot = slot;
    return;
  }
  // Away from slots, a click hits the nearest enemy; a click on nothing clears the selection.
  send({ type: 'tap', ...point }, (result) => {
    if (!result.ok) hud.selectedSlot = undefined;
  });
});
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  abilities.cancel();
});
canvas.addEventListener('pointermove', (e) => {
  pointer = e.pointerType === 'touch' ? undefined : { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerleave', () => { pointer = undefined; });

byId('away-close').addEventListener('click', () => { byId('away').hidden = true; });
byId('speed').addEventListener('click', () => {
  if (!session) return;
  const { settings } = session;
  settings.speed = SPEEDS[SPEEDS.indexOf(settings.speed) + 1] ?? SPEEDS[0];
  setText(byId('speed'), `${settings.speed}x`);
  save();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    session?.hide(Date.now());
    player.pause();
    save();
  } else {
    player.resume();
    showAway(session?.show(Date.now()));
  }
});
window.addEventListener('pagehide', save);
// Browsers let audio start only from user input (SPEC section 13).
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => {
  player.unlock();
  if (player.context) music.attach(player.context);
}, { capture: true });
registerOffline();

let last = performance.now();
function frame(now: number): void {
  const elapsed = Math.max(0, now - last);
  last = now;
  if (session) {
    const { events, away } = session.frame(elapsed, Date.now());
    showAway(away);
    renderer.onEvents(events);
    for (const sound of picker.pick(events, now)) player.play(sound);
    // Boss fights get the tenser music.
    music.mood = session.state.enemies.some((e) => e.kind === 'boss') ? 'tense' : 'calm';
    hud.onEvents(events);
    let preview;
    if (abilities.aiming && pointer) {
      const { view, x, y } = locate(pointer.x, pointer.y);
      preview = { ability: abilities.aiming, at: toGrid(view, x, y) };
    }
    guide.update(session.state, { selectedSlot: hud.selectedSlot, aiming: abilities.aiming }, events);
    renderer.draw(session.state, session.alpha, elapsed, hud.selectedSlot, preview, guide.slot, hud.editingWalls);
    canvas.style.cursor = abilities.aiming ? 'crosshair' : '';
    hud.update(session.state);
    abilities.update(session.state);
    menu.update(session.state);
    if (now - lastSave >= SAVE_EVERY_MS) save();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

void claimTab(navigator.locks as LockManager | undefined, {
  onStart: start,
  onWaiting: () => block('Running in another tab', 'Close the other tab to play here.', false),
});
