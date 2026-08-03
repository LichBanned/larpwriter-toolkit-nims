import { describe, it, expect } from 'vitest';
import {
  collectedText,
  diffRevisions,
  diffText,
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

  it('shows exact added/removed text fragments', () => {
    const parts = diffText('Привет мир', 'Привет новый мир');
    expect(collectedText(parts, 'add')).toMatch(/новый/);
    expect(collectedText(parts, 'del')).toBe('');

    const removed = diffText('один два три', 'один три');
    expect(collectedText(removed, 'del')).toMatch(/два/);
  });

  it('expands event field text changes with textParts', () => {
    const prev = {
      name: 'S',
      story: {
        events: [{ name: 'Завязка', text: 'он пришёл домой' }],
      },
    };
    const curr = {
      name: 'S',
      story: {
        events: [{ name: 'Завязка', text: 'он пришёл домой поздно' }],
      },
    };
    const diff = diffRevisions(prev, curr);
    const textChange = diff.find((d) => d.path.includes('text'));
    expect(textChange?.textParts).toBeTruthy();
    expect(collectedText(textChange?.textParts, 'add')).toMatch(/поздно/);
  });
});
