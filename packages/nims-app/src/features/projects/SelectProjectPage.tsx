import { useEffect, useState } from 'react';
import {
  Center, Stack, Title, Text, Button, Group, Paper, Loader, Alert, Badge,
} from '@mantine/core';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { useRootStore } from '@/stores';
import { AppCredits } from '@/components/AppCredits';

export const SelectProjectPage = observer(function SelectProjectPage() {
  const { projects, auth } = useRootStore();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void projects.load(true);
  }, [projects]);

  const memberProjects = projects.projects.filter((p) => !p.joinable && !p.archived_at);
  const joinable = projects.projects.filter((p) => p.joinable);

  async function onSelect(slug: string) {
    setBusy(slug);
    setError(null);
    try {
      await projects.select(slug);
    } catch (e: any) {
      setError(e?.message || 'Не удалось выбрать проект');
    } finally {
      setBusy(null);
    }
  }

  async function onJoin(slug: string) {
    setBusy(slug);
    setError(null);
    try {
      await projects.join(slug);
    } catch (e: any) {
      setError(e?.message || 'Не удалось подать заявку');
    } finally {
      setBusy(null);
    }
  }

  if (projects.loading && !projects.projects.length) {
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    );
  }

  return (
    <Center mih="100vh" p="md">
      <Stack maw={480} w="100%" gap="md">
        <div>
          <Title order={2}>Выбор проекта</Title>
          <Text c="dimmed" size="sm" mt={4}>
            {auth.user?.name}
            {auth.isServerAdmin ? ' · server-admin' : ''}
            {' · '}
            выберите проект для работы
          </Text>
        </div>
        {error && <Alert color="red">{error}</Alert>}
        {projects.lastError && <Alert color="orange">{projects.lastError}</Alert>}

        <Stack gap="xs">
          <Text fw={600} size="sm">Ваши проекты</Text>
          {!memberProjects.length && (
            <Text size="sm" c="dimmed">Пока нет участия в проектах</Text>
          )}
          {memberProjects.map((p) => (
            <Paper key={p.slug} withBorder p="sm" radius="md">
              <Group justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text fw={600} truncate>{p.name || p.slug}</Text>
                  <Group gap={6}>
                    <Text size="xs" c="dimmed">{p.slug}</Text>
                    {p.member_role && <Badge size="xs" variant="light">{p.member_role}</Badge>}
                  </Group>
                </div>
                <Button
                  size="compact-sm"
                  loading={busy === p.slug}
                  onClick={() => void onSelect(p.slug)}
                >
                  Открыть
                </Button>
              </Group>
            </Paper>
          ))}
        </Stack>

        {!!joinable.length && (
          <Stack gap="xs">
            <Text fw={600} size="sm">Доступны для участия</Text>
            {joinable.map((p) => (
              <Paper key={p.slug} withBorder p="sm" radius="md">
                <Group justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <Text fw={600} truncate>{p.name || p.slug}</Text>
                    <Text size="xs" c="dimmed">{p.slug}</Text>
                  </div>
                  <Button
                    size="compact-sm"
                    variant="light"
                    loading={busy === p.slug}
                    onClick={() => void onJoin(p.slug)}
                  >
                    Участвовать
                  </Button>
                </Group>
              </Paper>
            ))}
          </Stack>
        )}

        <Group justify="space-between">
          <Button variant="default" onClick={() => void auth.logout()}>Выйти</Button>
          {auth.isServerAdmin && (
            <Button variant="subtle" onClick={() => navigate('/projects')}>
              Управление проектами
            </Button>
          )}
        </Group>
        <AppCredits />
      </Stack>
    </Center>
  );
});
