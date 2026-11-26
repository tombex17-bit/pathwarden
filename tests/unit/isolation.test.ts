import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The ESLint config is plain JavaScript without types.
import { FORBIDDEN_FOLDERS, FORBIDDEN_GLOBALS } from '../../eslint.config.js';

const eslint = new ESLint();

async function rulesBroken(code: string, filePath = 'src/sim/fixture.ts'): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.map((m) => m.ruleId);
}

describe('sim isolation lint', () => {
  it('accepts clean simulation code', async () => {
    expect(await rulesBroken("import { WAVE } from '../config/balance';\nexport const a = Math.floor(WAVE.lives);\n")).toEqual([]);
  });

  it.each(FORBIDDEN_GLOBALS as string[])('rejects the global %s', async (name) => {
    expect(await rulesBroken(`export const a = ${name};\n`)).toContain('no-restricted-globals');
  });

  it.each([
    ...(FORBIDDEN_FOLDERS as string[]).flatMap((f) => [`../${f}`, `../${f}/thing`, `../${f}/deep/thing`]),
    '../app',
    'node:fs',
  ])('rejects importing %s', async (path) => {
    expect(await rulesBroken(`export * from '${path}';\n`)).toContain('no-restricted-imports');
    expect(await rulesBroken(`import { a } from '${path}';\nexport const b = a;\n`)).toContain('no-restricted-imports');
  });

  it('rejects Math.random and dynamic imports', async () => {
    expect(await rulesBroken('export const a = Math.random();\n')).toContain('no-restricted-properties');
    expect(await rulesBroken("export const a = import('../ui/hud');\n")).toContain('no-restricted-syntax');
  });

  it('only applies to sim/', async () => {
    expect(await rulesBroken('export const a = Math.random() + Date.now();\n', 'src/ui/fixture.ts')).toEqual([]);
  });
});
