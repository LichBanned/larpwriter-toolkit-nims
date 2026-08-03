export type DiffKind = 'added' | 'removed' | 'changed';

export type TextDiffPart = {
  type: 'equal' | 'add' | 'del';
  text: string;
};

export type DiffEntry = {
  path: string;
  /** Human-readable field title */
  label: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
  /** Word-level parts when both sides are text */
  textParts?: TextDiffPart[];
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Имя',
  displayName: 'Отображаемое имя',
  bio: 'Биография',
  text: 'Текст',
  story: 'Сюжет',
  events: 'События',
  characters: 'Персонажи',
  inventory: 'Инвентарь',
  adaptations: 'Адаптации',
  masterTime: 'Время мастера',
  eventTitle: 'Заголовок события',
  time: 'Время',
  description: 'Описание',
  filter: 'Фильтр',
  masterText: 'Текст мастера',
  starter: 'От кого',
  ender: 'К кому',
  origin: 'Происхождение',
  essence: 'Суть',
  ready: 'Готовность',
  deleted: 'Удалено',
  '(сущность)': 'Сущность',
  '(root)': 'Данные',
};

const COMMAND_LABELS: Record<string, string> = {
  updateProfileField: 'Изменение поля профиля',
  createProfile: 'Создание профиля',
  renameProfile: 'Переименование профиля',
  removeProfile: 'Удаление профиля',
  createStory: 'Создание сюжета',
  renameStory: 'Переименование сюжета',
  removeStory: 'Удаление сюжета',
  setWriterStory: 'Текст / адаптация сюжета',
  createEvent: 'Добавление события',
  moveEvent: 'Перемещение события',
  cloneEvent: 'Клонирование события',
  mergeEvents: 'Объединение событий',
  removeEvent: 'Удаление события',
  setEventOriginProperty: 'Свойство события',
  addStoryCharacter: 'Персонаж добавлен в сюжет',
  removeStoryCharacter: 'Персонаж убран из сюжета',
  switchStoryCharacters: 'Замена персонажей в сюжете',
  updateCharacterInventory: 'Инвентарь персонажа',
  onChangeCharacterActivity: 'Активность персонажа',
  addCharacterToEvent: 'Персонаж добавлен в событие',
  removeCharacterFromEvent: 'Персонаж убран из события',
  setEventAdaptationProperty: 'Адаптация события',
  createGroup: 'Создание группы',
  renameGroup: 'Переименование группы',
  removeGroup: 'Удаление группы',
  saveFilterToGroup: 'Фильтр группы',
  updateGroupProfileField: 'Поле группы',
  createCharacterRelation: 'Создание отношения',
  removeCharacterRelation: 'Удаление отношения',
  setCharacterRelationText: 'Текст отношения',
  setRelationReadyStatus: 'Статус готовности отношения',
  setRelationEssence: 'Суть отношения',
  setRelationOrigin: 'Происхождение отношения',
  restoreEntityRevision: 'Восстановление из истории',
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

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (isPlainObject(v) && Object.keys(v).length === 0) return true;
  return false;
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

export function humanizePath(path: string): string {
  if (FIELD_LABELS[path]) return FIELD_LABELS[path];
  const parts = path.split('.').map((part) => {
    const m = part.match(/^(.+)\[(\d+)\]$/);
    if (m) {
      const base = FIELD_LABELS[m[1]] || m[1];
      return `${base} №${Number(m[2]) + 1}`;
    }
    return FIELD_LABELS[part] || part;
  });
  return parts.join(' → ');
}

export function humanizeCommand(command?: string | null): string {
  if (!command) return 'Изменение';
  return COMMAND_LABELS[command] || command;
}

function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) || [];
}

/**
 * Word-level LCS diff. Highlights exactly which fragments were removed/added.
 */
export function diffText(before: string, after: string): TextDiffPart[] {
  if (before === after) return before ? [{ type: 'equal', text: before }] : [];
  if (!before) return after ? [{ type: 'add', text: after }] : [];
  if (!after) return before ? [{ type: 'del', text: before }] : [];

  const a = tokenize(before);
  const b = tokenize(after);
  // Cap cost for huge texts — fall back to prefix/suffix + middle replace
  if (a.length * b.length > 400_000 || a.length > 2500 || b.length > 2500) {
    return diffTextCoarse(before, after);
  }

  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? (dp[i + 1][j + 1] + 1) as number
        : Math.max(dp[i + 1][j], dp[i][j + 1]) as number;
    }
  }

  const raw: TextDiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ type: 'equal', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: 'del', text: a[i] });
      i += 1;
    } else {
      raw.push({ type: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    raw.push({ type: 'del', text: a[i] });
    i += 1;
  }
  while (j < m) {
    raw.push({ type: 'add', text: b[j] });
    j += 1;
  }

  return mergeParts(collapseEqualParts(raw));
}

function diffTextCoarse(before: string, after: string): TextDiffPart[] {
  let prefix = 0;
  const maxPref = Math.min(before.length, after.length);
  while (prefix < maxPref && before[prefix] === after[prefix]) prefix += 1;
  // avoid splitting UTF-16 surrogate / mid-word: back off to whitespace
  while (prefix > 0 && before[prefix - 1] !== ' ' && before[prefix - 1] !== '\n') prefix -= 1;

  let suffix = 0;
  const maxSuf = Math.min(before.length - prefix, after.length - prefix);
  while (
    suffix < maxSuf
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  while (suffix > 0) {
    const ch = before[before.length - suffix];
    if (ch === ' ' || ch === '\n') break;
    suffix -= 1;
  }

  const parts: TextDiffPart[] = [];
  if (prefix) parts.push({ type: 'equal', text: before.slice(0, prefix) });
  const del = before.slice(prefix, before.length - suffix);
  const add = after.slice(prefix, after.length - suffix);
  if (del) parts.push({ type: 'del', text: del });
  if (add) parts.push({ type: 'add', text: add });
  if (suffix) parts.push({ type: 'equal', text: before.slice(before.length - suffix) });
  return mergeParts(collapseEqualParts(parts));
}

function mergeParts(parts: TextDiffPart[]): TextDiffPart[] {
  const out: TextDiffPart[] = [];
  for (const p of parts) {
    if (!p.text) continue;
    const last = out[out.length - 1];
    if (last && last.type === p.type) last.text += p.text;
    else out.push({ ...p });
  }
  return out;
}

/** Collapse long unchanged middle stretches so the UI focuses on edits. */
function collapseEqualParts(parts: TextDiffPart[]): TextDiffPart[] {
  const MAX_EDGE = 80;
  return parts.map((p) => {
    if (p.type !== 'equal' || p.text.length <= MAX_EDGE * 2 + 5) return p;
    const head = p.text.slice(0, MAX_EDGE);
    const tail = p.text.slice(-MAX_EDGE);
    return { type: 'equal', text: `${head} … ${tail}` };
  });
}

export function collectedText(parts: TextDiffPart[] | undefined, type: 'add' | 'del'): string {
  if (!parts) return '';
  return parts.filter((p) => p.type === type).map((p) => p.text).join('').trim();
}

/** Short human text for a value; never dump huge JSON blobs. */
export function formatDiffValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'пусто';
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return 'пусто';
    if (t.length > 400) return `${t.slice(0, 400)}…`;
    return t;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return 'пусто';
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      return v.map(String).join(', ');
    }
    const labels = v.slice(0, 8).map((item, i) => {
      if (!isPlainObject(item)) return String(item);
      const title = item.name || item.eventTitle || item.text || item.characterName;
      if (typeof title === 'string' && title.trim()) {
        const short = title.trim().length > 40 ? `${title.trim().slice(0, 40)}…` : title.trim();
        return short;
      }
      return `элемент ${i + 1}`;
    });
    const more = v.length > 8 ? ` и ещё ${v.length - 8}` : '';
    return `${v.length} шт.: ${labels.join('; ')}${more}`;
  }
  if (isPlainObject(v)) {
    if (v.deleted) return 'удалено';
    const keys = Object.keys(v);
    if (keys.length === 0) return 'пусто';
    for (const k of ['text', 'name', 'description', 'bio']) {
      if (typeof v[k] === 'string' && (v[k] as string).trim()) {
        return formatDiffValue(v[k]);
      }
    }
    return keys.slice(0, 6).map((k) => {
      const val = formatDiffValue(v[k]);
      return `${humanizePath(k)}: ${val}`;
    }).join('; ') + (keys.length > 6 ? '…' : '');
  }
  try {
    const s = JSON.stringify(v);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return String(v);
  }
}

function itemLabel(item: unknown, idx: number): string {
  if (isPlainObject(item)) {
    const k = item.name || item.eventTitle || item.id || item.characterName;
    if (typeof k === 'string' && k.trim()) {
      const t = k.trim();
      return t.length > 48 ? `${t.slice(0, 48)}…` : t;
    }
  }
  return `элемент ${idx + 1}`;
}

function pickKey(item: unknown, idx: number): string {
  if (isPlainObject(item)) {
    const k = item.name || item.eventTitle || item.id || item.characterName;
    if (typeof k === 'string' && k) return k;
  }
  return `#${idx}`;
}

function makeStringEntry(
  path: string,
  label: string,
  kind: DiffKind,
  before?: unknown,
  after?: unknown,
): DiffEntry {
  const entry: DiffEntry = {
    path, label, kind, before, after,
  };
  if (kind === 'changed' && typeof before === 'string' && typeof after === 'string') {
    entry.textParts = diffText(before, after);
  }
  return entry;
}

/** Expand object-array diffs into per-item field changes with text highlights. */
function expandObjectArrayDiffs(
  path: string,
  before: unknown,
  after: unknown,
): DiffEntry[] {
  const a = Array.isArray(before) ? before : [];
  const b = Array.isArray(after) ? after : [];
  const mapA = new Map<string, { item: unknown; idx: number }>();
  const mapB = new Map<string, { item: unknown; idx: number }>();
  a.forEach((item, i) => mapA.set(pickKey(item, i), { item, idx: i }));
  b.forEach((item, i) => mapB.set(pickKey(item, i), { item, idx: i }));

  const entries: DiffEntry[] = [];
  const baseLabel = humanizePath(path);

  for (const key of mapB.keys()) {
    if (mapA.has(key)) continue;
    const { item, idx } = mapB.get(key)!;
    entries.push(makeStringEntry(
      `${path}.${key}`,
      `${baseLabel} → «${itemLabel(item, idx)}»`,
      'added',
      undefined,
      item,
    ));
  }
  for (const key of mapA.keys()) {
    if (mapB.has(key)) continue;
    const { item, idx } = mapA.get(key)!;
    entries.push(makeStringEntry(
      `${path}.${key}`,
      `${baseLabel} → «${itemLabel(item, idx)}»`,
      'removed',
      item,
      undefined,
    ));
  }
  for (const key of mapB.keys()) {
    if (!mapA.has(key)) continue;
    const left = mapA.get(key)!;
    const right = mapB.get(key)!;
    if (same(left.item, right.item)) continue;
    const flatA = flatten(left.item ?? {});
    const flatB = flatten(right.item ?? {});
    const fields = new Set([...Object.keys(flatA), ...Object.keys(flatB)]);
    let fieldChanges = 0;
    for (const field of [...fields].sort()) {
      const bv = Object.prototype.hasOwnProperty.call(flatA, field) ? flatA[field] : undefined;
      const av = Object.prototype.hasOwnProperty.call(flatB, field) ? flatB[field] : undefined;
      if (same(bv, av)) continue;
      if (isEmptyValue(bv) && isEmptyValue(av)) continue;
      fieldChanges += 1;
      const fieldLabel = `${baseLabel} → «${itemLabel(right.item, right.idx)}» → ${humanizePath(field)}`;
      if (bv === undefined) {
        entries.push(makeStringEntry(`${path}.${key}.${field}`, fieldLabel, 'added', undefined, av));
      } else if (av === undefined) {
        entries.push(makeStringEntry(`${path}.${key}.${field}`, fieldLabel, 'removed', bv, undefined));
      } else {
        entries.push(makeStringEntry(`${path}.${key}.${field}`, fieldLabel, 'changed', bv, av));
      }
    }
    if (fieldChanges === 0) {
      entries.push(makeStringEntry(
        `${path}.${key}`,
        `${baseLabel} → «${itemLabel(right.item, right.idx)}»`,
        'changed',
        left.item,
        right.item,
      ));
    }
  }
  return entries;
}

/**
 * Diff selected revision against the previous one (only real changes).
 */
export function diffRevisions(previous: unknown, current: unknown): DiffEntry[] {
  const prevBody = unwrapSnapshot(previous);
  const currBody = unwrapSnapshot(current);
  const isFirst = previous == null;

  if (isPlainObject(prevBody) && prevBody.deleted && !(isPlainObject(currBody) && currBody.deleted)) {
    return [{ path: '(сущность)', label: 'Сущность', kind: 'added', after: 'создана заново' }];
  }
  if (!(isPlainObject(prevBody) && prevBody.deleted) && isPlainObject(currBody) && currBody.deleted) {
    return [{ path: '(сущность)', label: 'Сущность', kind: 'removed', before: 'существовала', after: 'удалена' }];
  }

  const a = flatten(prevBody ?? {});
  const b = flatten(currBody ?? {});
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const entries: DiffEntry[] = [];

  for (const path of [...keys].sort()) {
    const hasA = Object.prototype.hasOwnProperty.call(a, path);
    const hasB = Object.prototype.hasOwnProperty.call(b, path);
    const before = hasA ? a[path] : undefined;
    const after = hasB ? b[path] : undefined;

    if (hasA && hasB && same(before, after)) continue;
    if (isFirst && !hasA && hasB && isEmptyValue(after)) continue;
    if (isEmptyValue(before) && isEmptyValue(after)) continue;

    // Object arrays → per-item / per-field diffs with text highlights
    if ((Array.isArray(before) || Array.isArray(after))
      && !(Array.isArray(before) && before.every((x) => x === null || typeof x !== 'object')
        && Array.isArray(after) && after.every((x) => x === null || typeof x !== 'object'))) {
      entries.push(...expandObjectArrayDiffs(path, before ?? [], after ?? []));
      continue;
    }

    if (!hasA && hasB) {
      entries.push(makeStringEntry(path, humanizePath(path), 'added', undefined, after));
    } else if (hasA && !hasB) {
      entries.push(makeStringEntry(path, humanizePath(path), 'removed', before, undefined));
    } else {
      entries.push(makeStringEntry(path, humanizePath(path), 'changed', before, after));
    }
  }
  return entries;
}
