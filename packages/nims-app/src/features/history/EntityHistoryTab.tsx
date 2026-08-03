import { useEffect, useMemo, useState } from 'react';
import {
  Stack, Text, Button, Group, Paper, Code, ScrollArea, Loader, Alert, Badge, Table,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useRootStore } from '@/stores';
import {
  diffRevisions,
  formatDiffValue,
  unwrapSnapshot,
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
  if (kind === 'added') return 'green';
  if (kind === 'removed') return 'red';
  return 'yellow';
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
    setSelectedRev(revision);
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
        <Text size="sm" c="dimmed">Ревизии сущности</Text>
        <Button size="compact-xs" variant="default" onClick={() => void load()}>Обновить</Button>
      </Group>
      {!rows.length && <Text size="sm" c="dimmed">Пока нет сохранённых ревизий</Text>}
      <Stack gap={6}>
        {rows.map((r) => (
          <Paper key={r.id} withBorder p="xs" radius="sm">
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Group gap={6}>
                  <Badge size="sm" variant="light">r{r.revision}</Badge>
                  {r.reason && <Badge size="sm" color="gray">{r.reason}</Badge>}
                  <Text size="xs" c="dimmed">{r.command || '—'}</Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {r.actor || '—'} · {new Date(r.created_at).toLocaleString()}
                </Text>
              </div>
              <Group gap={4}>
                <Button size="compact-xs" variant="light" onClick={() => void view(r.revision)}>
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
        <Paper withBorder p="sm" radius="sm">
          <Group justify="space-between" mb={8}>
            <Text size="sm" fw={600}>
              Ревизия r{selectedRev}
              {previousRev != null ? ` · изменения относительно r${previousRev}` : ' · первая версия'}
            </Text>
            {viewLoading && <Loader size="xs" />}
          </Group>

          {!viewLoading && (
            <Stack gap="md">
              <div>
                <Text size="sm" fw={600} mb={6}>Внесённые изменения</Text>
                {!changes.length ? (
                  <Text size="sm" c="dimmed">
                    {previousRev == null
                      ? 'Нет предыдущей ревизии для сравнения — это первая запись.'
                      : 'Отличий от предыдущей ревизии не найдено.'}
                  </Text>
                ) : (
                  <ScrollArea.Autosize mah={280}>
                    <Table striped highlightOnHover withTableBorder withColumnBorders fz="xs">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Поле</Table.Th>
                          <Table.Th w={90}>Тип</Table.Th>
                          <Table.Th>Было</Table.Th>
                          <Table.Th>Стало</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {changes.map((c) => (
                          <Table.Tr key={`${c.kind}:${c.path}`}>
                            <Table.Td>
                              <Text size="xs" ff="monospace">{c.path}</Text>
                            </Table.Td>
                            <Table.Td>
                              <Badge size="xs" color={kindColor(c.kind)} variant="light">
                                {kindLabel(c.kind)}
                              </Badge>
                            </Table.Td>
                            <Table.Td>
                              <Code block style={{ whiteSpace: 'pre-wrap', maxWidth: 280 }}>
                                {c.kind === 'added' ? '—' : formatDiffValue(c.before)}
                              </Code>
                            </Table.Td>
                            <Table.Td>
                              <Code block style={{ whiteSpace: 'pre-wrap', maxWidth: 280 }}>
                                {c.kind === 'removed' ? '—' : formatDiffValue(c.after)}
                              </Code>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea.Autosize>
                )}
              </div>

              <div>
                <Text size="sm" fw={600} mb={6}>
                  {previousRev != null
                    ? `Предыдущая версия (r${previousRev})`
                    : 'Предыдущая версия'}
                </Text>
                {previousSnap == null ? (
                  <Text size="sm" c="dimmed">Нет предыдущей ревизии (создание сущности).</Text>
                ) : (
                  <ScrollArea h={220}>
                    <Code block style={{ whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(unwrapSnapshot(previousSnap), null, 2)}
                    </Code>
                  </ScrollArea>
                )}
              </div>
            </Stack>
          )}
        </Paper>
      )}
    </Stack>
  );
}
