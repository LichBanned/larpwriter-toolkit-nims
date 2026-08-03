export type DiffKind = 'added' | 'removed' | 'changed';

export type DiffEntry = {
  path: string;
  /** Human-readable field title */
  label: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
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

/** Short human text for a value; never dump huge JSON blobs. */
export function formatDiffValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'пусто';
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return 'пусто';
    if (t.length > 280) return `${t.slice(0, 280)}…`;
    return t;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return 'пусто';
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      return v.map(String).join(', ');
    }
    // list of events / objects — compact labels
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
    // Prefer common text fields
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

function summarizeArrayChange(before: unknown, after: unknown): DiffEntry | null {
  if (!Array.isArray(before) && !Array.isArray(after)) return null;
  const a = Array.isArray(before) ? before : [];
  const b = Array.isArray(after) ? after : [];
  if (same(a, b)) return null;

  // Primitive lists
  if (
    a.every((x) => x === null || typeof x !== 'object')
    && b.every((x) => x === null || typeof x !== 'object')
  ) {
    return null; // fall through to leaf flatten
  }

  const pickKey = (item: unknown, idx: number): string => {
    if (isPlainObject(item)) {
      const k = item.name || item.eventTitle || item.id || item.characterName;
      if (typeof k === 'string' && k) return k;
    }
    return `#${idx}`;
  };

  const mapA = new Map<string, unknown>();
  a.forEach((item, i) => mapA.set(pickKey(item, i), item));
  const mapB = new Map<string, unknown>();
  b.forEach((item, i) => mapB.set(pickKey(item, i), item));

  const added = [...mapB.keys()].filter((k) => !mapA.has(k));
  const removed = [...mapA.keys()].filter((k) => !mapB.has(k));
  const changed = [...mapB.keys()].filter((k) => mapA.has(k) && !same(mapA.get(k), mapB.get(k)));

  const bits: string[] = [];
  if (added.length) bits.push(`добавлено: ${added.slice(0, 5).join(', ')}${added.length > 5 ? '…' : ''}`);
  if (removed.length) bits.push(`удалено: ${removed.slice(0, 5).join(', ')}${removed.length > 5 ? '…' : ''}`);
  if (changed.length) bits.push(`изменено: ${changed.slice(0, 5).join(', ')}${changed.length > 5 ? '…' : ''}`);
  if (!bits.length) bits.push(`было ${a.length}, стало ${b.length}`);

  return {
    path: '',
    label: '',
    kind: 'changed',
    before: undefined,
    after: bits.join('; '),
  };
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

    // On create, skip empty new fields — noise
    if (isFirst && !hasA && hasB && isEmptyValue(after)) continue;
    // Skip empty→empty noise
    if (isEmptyValue(before) && isEmptyValue(after)) continue;

    // Prefer human summary for object arrays
    if ((Array.isArray(before) || Array.isArray(after))
      && !(Array.isArray(before) && before.every((x) => x === null || typeof x !== 'object')
        && Array.isArray(after) && after.every((x) => x === null || typeof x !== 'object'))) {
      const summary = summarizeArrayChange(before ?? [], after ?? []);
      if (summary) {
        entries.push({
          path,
          label: humanizePath(path),
          kind: !hasA ? 'added' : !hasB ? 'removed' : 'changed',
          before: !hasB ? formatDiffValue(before) : summary.before,
          after: !hasA ? formatDiffValue(after) : summary.after,
        });
        continue;
      }
    }

    if (!hasA && hasB) {
      entries.push({
        path, label: humanizePath(path), kind: 'added', after,
      });
    } else if (hasA && !hasB) {
      entries.push({
        path, label: humanizePath(path), kind: 'removed', before,
      });
    } else {
      entries.push({
        path, label: humanizePath(path), kind: 'changed', before, after,
      });
    }
  }
  return entries;
}
