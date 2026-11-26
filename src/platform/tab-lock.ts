export type LocksLike = Pick<LockManager, 'request'>;

const NAME = 'tdi.running';

/**
 * Runs the game in one tab only. Calls `onStart` once this tab may run; until then,
 * `onWaiting` is called if another tab is running. The lock is held until the tab closes.
 */
export async function claimTab(
  locks: LocksLike | undefined, handlers: { onStart: (locked: boolean) => void; onWaiting: () => void },
): Promise<void> {
  if (!locks) {
    handlers.onStart(false);
    return;
  }
  const hold = (): Promise<never> => {
    handlers.onStart(true);
    return new Promise<never>(() => undefined);
  };
  let waiting = false;
  await locks.request(NAME, { ifAvailable: true }, async (lock) => {
    if (lock) await hold();
    else waiting = true;
  });
  if (!waiting) return;
  handlers.onWaiting();
  await locks.request(NAME, hold);
}
