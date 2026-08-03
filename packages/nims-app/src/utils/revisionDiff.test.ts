import { describe, it, expect } from 'vitest';
import {
  diffRevisions,
  formatDiffValue,
  humanizeCommand,
  humanizePath,
  unwrapSnapshot,
} from './revisionDiff';

describe('revisionDiff', () => {
  it('unwraps character fields', () => {
    expect(unwrapSnapshot({ name: 'Hero', fields: { bio: 'a' } })).toEqual({ bio: 'a' });
  });

  it('lists only changed fields', () => {
    const prev = { name: 'Hero', fields: { bio: 'old', age: 20 } };
    const curr = { name: 'Hero', fields: { bio: 'new', age: 20, city: 'Msk' } };
    const diff = diffRevisions(prev, curr);
    expect(diff.map((d) => d.path).sort()).toEqual(['bio', 'city']);
    expect(diff.find((d) => d.path === 'bio')?.kind).toBe('changed');
    expect(diff.find((d) => d.path === 'city')?.kind).toBe('added');
    expect(diff.find((d) => d.path === 'age')).toBeUndefined();
  });

  it('skips empty fields on first revision', () => {
    const diff = diffRevisions(null, {
      name: 'Hero',
      fields: { bio: 'hi', empty: '', other: null },
    });
    expect(diff.map((d) => d.path)).toEqual(['bio']);
  });

  it('marks deletion', () => {
    const diff = diffRevisions(
      { name: 'Hero', fields: { bio: 'x' } },
      { name: 'Hero', deleted: true },
    );
    expect(diff[0]?.kind).toBe('removed');
  });

  it('formats values human-readably', () => {
    expect(formatDiffValue('')).toBe('пусто');
    expect(formatDiffValue(true)).toBe('да');
    expect(formatDiffValue(['a', 'b'])).toBe('a, b');
    expect(humanizePath('events')).toBe('События');
    expect(humanizeCommand('updateProfileField')).toMatch(/профил/i);
  });

  it('summarizes object-array changes without dumping JSON', () => {
    const prev = {
      name: 'S',
      story: {
        events: [{ name: 'A', text: 'one' }, { name: 'B', text: 'two' }],
      },
    };
    const curr = {
      name: 'S',
      story: {
        events: [{ name: 'A', text: 'ONE' }, { name: 'C', text: 'three' }],
      },
    };
    const diff = diffRevisions(prev, curr);
    const ev = diff.find((d) => d.path === 'events');
    expect(ev).toBeTruthy();
    expect(String(ev?.after)).toMatch(/добавлено|изменено|удалено/);
    expect(ev?.before).toBeUndefined();
  });
});
