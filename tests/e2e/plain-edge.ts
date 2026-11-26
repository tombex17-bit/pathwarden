import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Playwright makes every page believe it is focused and visible, so tabs never really hide.
// This drives Edge directly: opening another tab hides the first one, like a person would.

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

interface Reply { id?: number; result?: Record<string, unknown>; error?: { message: string } }

export interface PlainTab {
  evaluate<T>(expression: string): Promise<T>;
  /** Opens another tab in front. */
  hide(): Promise<void>;
  /** Switches back. */
  show(): Promise<void>;
  close(): Promise<void>;
}

export async function openPlainTab(url: string): Promise<PlainTab> {
  if (!EDGE) throw new Error('Edge is not installed');
  const profile = mkdtempSync(join(tmpdir(), 'tdi-edge-'));
  const browser = spawn(EDGE, ['--headless=new', '--remote-debugging-port=0', '--no-first-run', `--user-data-dir=${profile}`, 'about:blank']);
  const endpoint = await new Promise<string>((resolve, reject) => {
    browser.on('error', reject);
    browser.stderr.on('data', (chunk: Buffer) => {
      const match = /ws:\/\/\S+/.exec(chunk.toString());
      if (match) resolve(match[0]);
    });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve) => socket.addEventListener('open', resolve));
  const pending = new Map<number, (reply: Reply) => void>();
  let nextId = 1;
  socket.addEventListener('message', (e) => {
    const reply = JSON.parse(String(e.data)) as Reply;
    if (reply.id === undefined) return;
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  });
  const send = async (method: string, params: object = {}, sessionId?: string): Promise<Record<string, unknown>> => {
    const id = nextId++;
    const reply = await new Promise<Reply>((resolve) => {
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
    return reply.result ?? {};
  };

  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

  return {
    async evaluate<T>(expression: string): Promise<T> {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true }, String(sessionId));
      if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
      return (result as { value: T }).value;
    },
    async hide() {
      await send('Target.createTarget', { url: 'about:blank' });
    },
    async show() {
      await send('Target.activateTarget', { targetId });
    },
    async close() {
      const exited = new Promise((resolve) => browser.on('exit', resolve));
      await send('Browser.close').catch(() => undefined);
      await exited;
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}
