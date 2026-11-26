import { byId, setText } from './dom';

const TOAST_MS = 2500;
let timer = 0;

/** Shows a short message over the map. */
export function say(text: string, ms = TOAST_MS): void {
  const toast = byId('toast');
  setText(toast, text);
  toast.hidden = false;
  clearTimeout(timer);
  timer = window.setTimeout(() => { toast.hidden = true; }, ms);
}
