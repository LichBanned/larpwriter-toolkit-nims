import { useEffect, useMemo, useState } from 'react';
import {
  Stack, Text, Button, Group, Paper, ScrollArea, Loader, Alert, Badge, Box,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useRootStore } from '@/stores';
import {
  diffRevisions,
  formatDiffValue,
  humanizeCommand,
  type DiffEntry,
} from '@/utils/revisionDiff';

type RevRow = {
  id: number;
  revision: number;
  command?: string;
  reason?: string;
  actor?: string;
  created_at: string;
};

function kindLabel(kind: DiffEntry['kind']): string {
  if (kind === 'added') return 'добавлено';
  if (kind === 'removed') return 'удалено';
  return 'изменено';
}

function kindColor(kind: DiffEntry['kind']): string {
  if (kind === 'added') return 'teal';
  if (kind === 'removed') return 'red';
  return 'blue';
}

function ChangeCard({ entry }: { entry: DiffEntry }) {
  const beforeText = entry.before === undefined ? null : formatDiffValue(entry.before);
  const afterText = entry.after === undefined ? null : formatDiffValue(entry.after);
  const summaryOnly = entry.kind === 'changed' && beforeText == null && afterText != null;

  return (
    <Paper withBorder p="sm" radius="md" bg="var(--mantine-color-body)">
      <Group justify="space-between" mb={8} wrap="nowrap" align="flex-start">
        <Text size="sm" fw={600} style={{ lineHeight: 1.35 }}>
          {entry.label}
        </Text>
        <Badge size="sm" color={kindColor(entry.kind)} variant="light" style={{ flexShrink: 0 }}>
          {kindLabel(entry.kind)}
        </Badge>
      </Group>
      <Stack gap={6}>
        {summaryOnly && (
          <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {afterText}
          </Text>
        )}
        {!summaryOnly && beforeText != null && (
          <Box>
            <Text size="xs" c="dimmed" mb={2}>Было</Text>
            <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {beforeText}
            </Text>
          </Box>
        )}
        {!summaryOnly && afterText != null && (
          <Box>
            <Text size="xs" c="dimmed" mb={2}>
              {entry.kind === 'added' ? 'Значение' : 'Стало'}
            </Text>
            <Text size="sm" fw={500} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {afterText}
            </Text>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

export function EntityHistoryTab({
  entityType,
  entityId,
}: {
  entityType: 'character' | 'story' | 'player' | 'group';
  entityId: string;
}) {
  const { api } = useRootStore();
  const [rows, setRows] = useState<RevRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRev, setSelectedRev] = useState<number | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<RevRow | null>(null);
  const [currentSnap, setCurrentSnap] = useState<unknown>(null);
  const [previousSnap, setPreviousSnap] = useState<unknown>(null);
  const [previousRev, setPreviousRev] = useState<number | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<RevRow[]>('listEntityRevisions', {
        entityType,
        entityId,
        limit: 40,
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить историю');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSelectedRev(null);
    setSelectedMeta(null);
    setCurrentSnap(null);
    setPreviousSnap(null);
    setPreviousRev(null);
    void load();
  }, [entityType, entityId]);

  const changes = useMemo(
    () => (currentSnap != null ? diffRevisions(previousSnap, currentSnap) : []),
    [previousSnap, currentSnap],
  );

  async function view(revision: number) {
    const meta = rows.find((r) => r.revision === revision) || null;
    setSelectedRev(revision);
    setSelectedMeta(meta);
    setViewLoading(true);
    try {
      const older = rows
        .filter((r) => r.revision < revision)
        .sort((a, b) => b.revision - a.revision)[0];

      const curr = await api.get<any>('getEntityRevision', { entityType, entityId, revision });
      setCurrentSnap(curr?.snapshot ?? curr);

      if (older) {
        const prev = await api.get<any>('getEntityRevision', {
          entityType,
          entityId,
          revision: older.revision,
        });
        setPreviousSnap(prev?.snapshot ?? prev);
        setPreviousRev(older.revision);
      } else {
        setPreviousSnap(null);
        setPreviousRev(null);
      }
    } catch (e: any) {
      notifications.show({ message: e?.message || 'Ошибка', color: 'red' });
    } finally {
      setViewLoading(false);
    }
  }

  async function restore(revision: number) {
    if (!confirm(`Восстановить ревизию ${revision}?`)) return;
    try {
      await api.call('restoreEntityRevision', { entityType, entityId, revision });
      notifications.show({ message: `Восстановлено из r${revision}`, color: 'green' });
      setCurrentSnap(null);
      setPreviousSnap(null);
      setSelectedRev(null);
      setSelectedMeta(null);
      setPreviousRev(null);
      await load();
    } catch (e: any) {
      notifications.show({ message: e?.message || 'Ошибка восстановления', color: 'red' });
    }
  }

  if (loading && !rows.length) return <Loader size="sm" />;
  if (error) return <Alert color="red">{error}</Alert>;

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">История изменений</Text>
        <Button size="compact-xs" variant="default" onClick={() => void load()}>Обновить</Button>
      </Group>
      {!rows.length && <Text size="sm" c="dimmed">Пока нет сохранённых изменений</Text>}
      <Stack gap={6}>
        {rows.map((r) => (
          <Paper key={r.id} withBorder p="xs" radius="sm">
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={500} truncate>
                  {humanizeCommand(r.command)}
                </Text>
                <Text size="xs" c="dimmed">
                  {r.actor || 'неизвестно'}
                  {' · '}
                  {new Date(r.created_at).toLocaleString()}
                  {' · '}
                  r{r.revision}
                </Text>
              </div>
              <Group gap={4} style={{ flexShrink: 0 }}>
                <Button
                  size="compact-xs"
                  variant={selectedRev === r.revision ? 'filled' : 'light'}
                  onClick={() => void view(r.revision)}
                >
                  Смотреть
                </Button>
                {r.reason !== 'import' && (
                  <Button size="compact-xs" color="orange" variant="light" onClick={() => void restore(r.revision)}>
                    Восстановить
                  </Button>
                )}
              </Group>
            </Group>
          </Paper>
        ))}
      </Stack>

      {selectedRev != null && (
        <Paper withBorder p="sm" radius="md">
          <Group justify="space-between" mb="sm" wrap="wrap">
            <div>
              <Text size="sm" fw={600}>
                {selectedMeta ? humanizeCommand(selectedMeta.command) : `Ревизия r${selectedRev}`}
              </Text>
              <Text size="xs" c="dimmed">
                {previousRev != null
                  ? `Что изменилось с версии r${previousRev}`
                  : 'Первая сохранённая версия'}
              </Text>
            </div>
            {viewLoading && <Loader size="xs" />}
          </Group>

          {!viewLoading && (
            !changes.length ? (
              <Text size="sm" c="dimmed">
                {previousRev == null
                  ? 'Содержимое совпадает с пустым состоянием или поля ещё не заполнены.'
                  : 'Существенных отличий от предыдущей версии нет.'}
              </Text>
            ) : (
              <ScrollArea.Autosize mah={420} offsetScrollbars>
                <Stack gap="sm">
                  {changes.map((c) => (
                    <ChangeCard key={`${c.kind}:${c.path}`} entry={c} />
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            )
          )}
        </Paper>
      )}
    </Stack>
  );
}
