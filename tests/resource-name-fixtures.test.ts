import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { inferVideoName } from '../electron/main/services/quark/filename';

const cases = JSON.parse(readFileSync(new URL('./fixtures/resource-name-cases.json', import.meta.url), 'utf8')) as {
  shared: Array<{ id: string; filename: string; parents?: string[]; hint: { title: string; year: number | null; season: number | null; episode: number | null } }>;
};

it.each(cases.shared)('Windows 与 TV 共用命名样本：$id', ({ filename, parents, hint }) => {
  expect(inferVideoName(filename, parents)).toEqual(hint);
});
