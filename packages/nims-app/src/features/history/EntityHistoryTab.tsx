import { useEffect, useState } from 'react';
import {
  Stack, Text, Button, Group, Paper, Code, ScrollArea, Loader, Alert, Badge,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useRootStore } from '@/stores';

type RevRow = {
  id: number;
  revision: number;
  command?: string;
  reason?: string;
  actor?: string;
  created_at: string;
};

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
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [selectedRev, setSelectedRev] = useState<number | null>(null);
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
    void load();
  }, [entityType, entityId]);

  async function view(revision: number) {
    setSelectedRev(revision);
    try {
      const data = await api.get<any>('getEntityRevision', { entityType, entityId, revision });
      setSnapshot(data?.snapshot ?? data);
    } catch (e: any) {
      notifications.show({ message: e?.message || 'Ошибка', color: 'red' });
    }
  }

  async function restore(revision: number) {
    if (!confirm(`Восстановить ревизию ${revision}?`)) return;
    try {
      await api.call('restoreEntityRevision', { entityType, entityId, revision });
      notifications.show({ message: `Восстановлено из r${revision}`, color: 'green' });
      setSnapshot(null);
      setSelectedRev(null);
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
                <Button size="compact-xs" variant="light" onClick={() => void view(r.revision)}>Смотреть</Button>
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
      {selectedRev != null && snapshot != null && (
        <Paper withBorder p="sm" radius="sm">
          <Text size="sm" fw={600} mb={6}>Snapshot r{selectedRev}</Text>
          <ScrollArea h={240}>
            <Code block style={{ whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(snapshot, null, 2)}
            </Code>
          </ScrollArea>
        </Paper>
      )}
    </Stack>
  );
}
