export type DiffKind = 'added' | 'removed' | 'changed';

export type DiffEntry = {
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
};

/** Pull the entity body out of a revision snapshot wrapper. */
export function unwrapSnapshot(snapshot: unknown): unknown {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const s = snapshot as Record<string, unknown>;
  if (s.deleted) return { deleted: true, name: s.name ?? s.id };
  if ('fields' in s) return s.fields;
  if ('story' in s) return s.story;
  if ('group' in s) return s.group;
  if ('relation' in s) return s.relation;
  return snapshot;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function flatten(value: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (value === undefined) return out;
  if (value === null || typeof value !== 'object') {
    out[prefix || '(root)'] = value;
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out[prefix || '(root)'] = [];
      return out;
    }
    // Compare arrays as JSON when they hold objects (events, characters lists) —
    // leaf paths would be too noisy and unstable by index alone.
    const allPrimitive = value.every((x) => x === null || typeof x !== 'object');
    if (!allPrimitive) {
      out[prefix || '(root)'] = value;
      return out;
    }
    value.forEach((item, i) => {
      flatten(item, prefix ? `${prefix}[${i}]` : `[${i}]`, out);
    });
    return out;
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) {
    out[prefix || '(root)'] = {};
    return out;
  }
  for (const key of keys) {
    const next = prefix ? `${prefix}.${key}` : key;
    flatten((value as Record<string, unknown>)[key], next, out);
  }
  return out;
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'object' || typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

export function formatDiffValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'string') return v === '' ? '(пусто)' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/**
 * Diff selected revision against the previous one (what changed in this step).
 * If previous is missing, all leaves of current are reported as added.
 */
export function diffRevisions(previous: unknown, current: unknown): DiffEntry[] {
  const prevBody = unwrapSnapshot(previous);
  const currBody = unwrapSnapshot(current);

  if (isPlainObject(prevBody) && prevBody.deleted && !(isPlainObject(currBody) && currBody.deleted)) {
    return [{ path: '(сущность)', kind: 'added', after: currBody }];
  }
  if (!(isPlainObject(prevBody) && prevBody.deleted) && isPlainObject(currBody) && currBody.deleted) {
    return [{ path: '(сущность)', kind: 'removed', before: prevBody }];
  }

  const a = flatten(prevBody ?? {});
  const b = flatten(currBody ?? {});
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const entries: DiffEntry[] = [];
  for (const path of [...keys].sort()) {
    const hasA = Object.prototype.hasOwnProperty.call(a, path);
    const hasB = Object.prototype.hasOwnProperty.call(b, path);
    if (!hasA && hasB) entries.push({ path, kind: 'added', after: b[path] });
    else if (hasA && !hasB) entries.push({ path, kind: 'removed', before: a[path] });
    else if (!same(a[path], b[path])) {
      entries.push({ path, kind: 'changed', before: a[path], after: b[path] });
    }
  }
  return entries;
}
