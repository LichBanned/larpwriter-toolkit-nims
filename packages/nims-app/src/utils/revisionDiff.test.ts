import { describe, it, expect } from 'vitest';
import { diffRevisions, formatDiffValue, unwrapSnapshot } from './revisionDiff';

describe('revisionDiff', () => {
  it('unwraps character fields', () => {
    expect(unwrapSnapshot({ name: 'Hero', fields: { bio: 'a' } })).toEqual({ bio: 'a' });
  });

  it('lists field changes against previous', () => {
    const prev = { name: 'Hero', fields: { bio: 'old', age: 20 } };
    const curr = { name: 'Hero', fields: { bio: 'new', age: 20, city: 'Msk' } };
    const diff = diffRevisions(prev, curr);
    expect(diff).toEqual(expect.arrayContaining([
      { path: 'bio', kind: 'changed', before: 'old', after: 'new' },
      { path: 'city', kind: 'added', after: 'Msk' },
    ]));
    expect(diff.find((d) => d.path === 'age')).toBeUndefined();
  });

  it('marks deletion', () => {
    const diff = diffRevisions(
      { name: 'Hero', fields: { bio: 'x' } },
      { name: 'Hero', deleted: true },
    );
    expect(diff[0]?.kind).toBe('removed');
  });

  it('formats empty string', () => {
    expect(formatDiffValue('')).toBe('(пусто)');
  });
});
