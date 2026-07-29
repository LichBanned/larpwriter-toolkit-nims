import { useMemo, useState, type ReactNode } from 'react';
import { Card, Stack, TextInput, Text, Button, Badge, Group, Tooltip, Switch } from '@mantine/core';
import { OwnerBadge, ownerColor } from './OwnerBadge';
import { useIsMobile } from '@/hooks/useIsMobile';

export type EntityListStatus = 'done' | 'wip' | 'empty';

export interface EntitySidebarProps {
  items: string[];
  selected: string | null;
  onSelect: (name: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
  emptyText?: string;
  /** Optional count badge per item (e.g. relations) */
  badgeCounts?: Record<string, number>;
  /** Optional status marker per item */
  itemStatuses?: Record<string, EntityListStatus>;
  statusLegend?: boolean;
  /** entityName → organizer ('' = unassigned) */
  owners?: Record<string, string>;
  /** Show group-by-owner toggle (default true when owners provided) */
  allowGroupByOwner?: boolean;
  /** Content above the search field (e.g. status filter chips) */
  header?: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Full-width list (mobile master stack) */
  fullWidth?: boolean;
}

const STATUS_META: Record<EntityListStatus, { color: string; label: string; title: string }> = {
  done: { color: 'green', label: '✓', title: 'Завершена' },
  wip: { color: 'orange', label: '…', title: 'Незавершена' },
  empty: { color: 'gray', label: '○', title: 'Пустая' },
};

const UNASSIGNED = 'Не привязаны';

const listItemStyles = {
  root: {
    height: 'auto',
    minHeight: 44,
    paddingBlock: 8,
    fontSize: 'var(--mantine-font-size-sm)',
  },
  label: {
    whiteSpace: 'normal' as const,
    textAlign: 'left' as const,
    fontSize: 'var(--mantine-font-size-sm)',
    lineHeight: 1.35,
  },
};

export function EntitySidebar({
  items,
  selected,
  onSelect,
  filter,
  onFilterChange,
  emptyText = 'Нет данных',
  badgeCounts,
  itemStatuses,
  statusLegend,
  owners,
  allowGroupByOwner,
  header,
  footer,
  width,
  fullWidth = false,
}: EntitySidebarProps) {
  const isMobile = useIsMobile();
  const listWidth = width ?? 240;
  const [groupByOwner, setGroupByOwner] = useState(false);
  const showOwnerUi = !!owners && (allowGroupByOwner !== false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((n) => {
      const owner = (owners?.[n] || '').toLowerCase();
      return n.toLowerCase().includes(q) || owner.includes(q);
    });
  }, [items, filter, owners]);

  const groups = useMemo(() => {
    if (!groupByOwner || !owners) {
      return [{ owner: '', names: filtered }];
    }
    const map = new Map<string, string[]>();
    for (const name of filtered) {
      const owner = (owners[name] || '').trim() || UNASSIGNED;
      if (!map.has(owner)) map.set(owner, []);
      map.get(owner)!.push(name);
    }
    const keys = [...map.keys()].sort((a, b) => {
      if (a === UNASSIGNED) return 1;
      if (b === UNASSIGNED) return -1;
      return a.localeCompare(b);
    });
    return keys.map((owner) => ({
      owner,
      names: (map.get(owner) || []).sort((a, b) => a.localeCompare(b)),
    }));
  }, [filtered, groupByOwner, owners]);

  const renderItem = (name: string) => {
    const count = badgeCounts?.[name] ?? 0;
    const status = itemStatuses?.[name];
    const meta = status ? STATUS_META[status] : null;
    const owner = owners?.[name] || '';

    const isSelected = selected === name;

    return (
      <Button
        key={name}
        variant="default"
        size="sm"
        fullWidth
        justify="space-between"
        onClick={() => onSelect(name)}
        styles={{
          ...listItemStyles,
          root: {
            ...listItemStyles.root,
            paddingInline: 12,
            // Neutral selected state: theme text on hover bg — no blue-on-blue
            background: isSelected
              ? 'var(--mantine-color-default-hover)'
              : undefined,
            borderColor: isSelected
              ? 'var(--mantine-color-gray-5)'
              : undefined,
            boxShadow: isSelected
              ? 'inset 3px 0 0 var(--mantine-color-blue-6)'
              : undefined,
            color: 'var(--mantine-color-text)',
          },
          inner: {
            justifyContent: 'space-between',
            width: '100%',
          },
          label: {
            ...listItemStyles.label,
            flex: 1,
            minWidth: 0,
            width: '100%',
            color: 'inherit',
          },
        }}
      >
        <Group gap="sm" wrap="nowrap" justify="space-between" style={{ width: '100%' }}>
          <Text
            size="sm"
            fw={isSelected ? 600 : 500}
            truncate
            c="inherit"
            style={{ flex: 1, minWidth: 0, textAlign: 'left' }}
          >
            {name}
          </Text>
          <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
            {showOwnerUi && !groupByOwner && (
              owner ? (
                <Tooltip label={`Владелец: ${owner}`} withArrow>
                  <Badge
                    size="xs"
                    color={ownerColor(owner)}
                    variant="light"
                    maw={88}
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'none' }}
                  >
                    {owner}
                  </Badge>
                </Tooltip>
              ) : (
                <Badge size="xs" color="gray" variant="outline" style={{ textTransform: 'none' }}>
                  —
                </Badge>
              )
            )}
            {meta && (
              <Tooltip label={meta.title} withArrow>
                <Badge size="sm" color={meta.color} variant="filled" circle>
                  {meta.label}
                </Badge>
              </Tooltip>
            )}
            {count > 0 && <Badge size="sm" circle>{count}</Badge>}
          </Group>
        </Group>
      </Button>
    );
  };

  return (
    <Card
      shadow="sm"
      padding="sm"
      withBorder
      style={{
        width: fullWidth ? '100%' : listWidth,
        minWidth: fullWidth ? 0 : 160,
        // Compact picker: readable column, not a stretched empty band
        maxWidth: fullWidth ? (isMobile ? '100%' : 440) : 400,
        marginInline: fullWidth && !isMobile ? 'auto' : undefined,
        flexShrink: 0,
        alignSelf: fullWidth ? 'center' : 'stretch',
        resize: fullWidth ? undefined : 'horizontal',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Stack gap={4} style={{ flex: 1, minHeight: 0 }}>
        {header}
        <TextInput
          size="sm"
          placeholder={showOwnerUi ? 'Поиск по имени или владельцу…' : 'Поиск…'}
          value={filter}
          onChange={(e) => onFilterChange(e.currentTarget.value)}
          mb={4}
        />
        {showOwnerUi && (
          <Switch
            size="sm"
            label="Группировать по владельцу"
            checked={groupByOwner}
            onChange={(e) => setGroupByOwner(e.currentTarget.checked)}
            mb={4}
          />
        )}
        {statusLegend && itemStatuses && (
          <Group gap="xs" mb={4} wrap="wrap">
            <Badge size="xs" color="green" variant="light">✓ готово</Badge>
            <Badge size="xs" color="orange" variant="light">… в работе</Badge>
            <Badge size="xs" color="gray" variant="light">○ пустая</Badge>
          </Group>
        )}
        <div style={{
          overflowY: 'auto',
          flex: 1,
          maxHeight: fullWidth || isMobile ? undefined : 'calc(100vh - 240px)',
        }}>
          <Stack gap={groupByOwner ? 'sm' : 4}>
            {groups.map((g) => (
              <Stack key={g.owner || '__flat'} gap={4}>
                {groupByOwner && g.owner && (
                  <Group gap={8} px={4} mt={4} align="center">
                    <Text size="sm" fw={700} c="dimmed">
                      {g.owner === UNASSIGNED ? UNASSIGNED : g.owner}
                    </Text>
                    <Badge size="md" variant="light" color={g.owner === UNASSIGNED ? 'gray' : ownerColor(g.owner)}>
                      {g.names.length}
                    </Badge>
                  </Group>
                )}
                {g.names.map(renderItem)}
              </Stack>
            ))}
            {items.length === 0 && (
              <Text size="sm" c="dimmed" ta="center" py="md">{emptyText}</Text>
            )}
            {items.length > 0 && filtered.length === 0 && (
              <Text size="sm" c="dimmed" ta="center" py="md">Ничего не найдено</Text>
            )}
          </Stack>
        </div>
        {footer}
      </Stack>
    </Card>
  );
}

export { OwnerBadge };
