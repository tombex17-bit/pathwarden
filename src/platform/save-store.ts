import { decode, type SaveData } from './save';

export const MAIN_KEY = 'tdi.save';
export const BACKUP_KEY = 'tdi.backup';
/** A damaged main save is kept here before anything replaces it. */
export const DAMAGED_KEY = 'tdi.damaged';
const PROBE_KEY = 'tdi.probe';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type LoadResult =
  | { kind: 'new' }
  | { kind: 'loaded'; data: SaveData; from: 'main' | 'backup' }
  | { kind: 'corrupt' }
  | { kind: 'newer' }
  | { kind: 'unavailable' };

/** Keeps the save and its backup. Writes nothing until a load succeeded or the player chose to start over. */
export class SaveStore {
  private storage: StorageLike | undefined;
  private canWrite = false;
  /** The main save's text, if it is known to be valid. */
  private trusted: string | undefined;

  constructor(private readonly open: () => StorageLike) {}

  load(): LoadResult {
    let main: string | null;
    let backup: string | null;
    try {
      this.storage = this.open();
      this.storage.setItem(PROBE_KEY, '1');
      this.storage.removeItem(PROBE_KEY);
      main = this.storage.getItem(MAIN_KEY);
      backup = this.storage.getItem(BACKUP_KEY);
    } catch {
      this.storage = undefined;
      return { kind: 'unavailable' };
    }
    if (main === null && backup === null) {
      this.canWrite = true;
      return { kind: 'new' };
    }

    let newer = false;
    if (main !== null) {
      const result = decode(main);
      if (result.ok) {
        this.trusted = main;
        this.canWrite = true;
        return { kind: 'loaded', data: result.data, from: 'main' };
      }
      // A newer save is intact, so never fall back behind it.
      if (result.reason === 'newer') return { kind: 'newer' };
    }
    if (backup !== null) {
      const result = decode(backup);
      if (result.ok && this.allowOverwrite()) return { kind: 'loaded', data: result.data, from: 'backup' };
      newer = !result.ok && result.reason === 'newer';
    }
    return { kind: newer ? 'newer' : 'corrupt' };
  }

  /** Call once the player decided to replace an unreadable save; a copy of it is kept. */
  allowOverwrite(): boolean {
    if (!this.storage) return false;
    try {
      const main = this.storage.getItem(MAIN_KEY);
      if (main !== null && main !== this.trusted) this.storage.setItem(DAMAGED_KEY, main);
      this.canWrite = true;
    } catch {
      this.canWrite = false;
    }
    return this.canWrite;
  }

  /** Saves, keeping the previous valid save as the backup. Returns whether it worked. */
  save(text: string): boolean {
    if (!this.storage || !this.canWrite) return false;
    try {
      const previous = this.storage.getItem(MAIN_KEY);
      if (previous !== null && previous === this.trusted) this.storage.setItem(BACKUP_KEY, previous);
      this.storage.setItem(MAIN_KEY, text);
      this.trusted = text;
      return true;
    } catch {
      return false;
    }
  }
}
