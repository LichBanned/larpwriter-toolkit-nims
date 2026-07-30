import { useEffect, useState } from 'react';
import {
  Stack, Title, Text, Button, Group, Paper, TextInput, FileButton, Alert, Badge, Loader,
  PasswordInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { observer } from 'mobx-react-lite';
import { useRootStore } from '@/stores';

export const ProjectsPage = observer(function ProjectsPage() {
  const { projects, auth, api } = useRootStore();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saPass, setSaPass] = useState('');
  const [saPass2, setSaPass2] = useState('');
  const [saSaving, setSaSaving] = useState(false);

  useEffect(() => {
    void projects.load(false);
  }, [projects]);

  if (!auth.isServerAdmin) {
    return <Alert color="red">Только server-admin</Alert>;
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await projects.create(slug.trim(), name.trim() || slug.trim());
      setSlug('');
      setName('');
      notifications.show({ message: 'Проект создан', color: 'green' });
    } catch (e: any) {
      setError(e?.message || 'Ошибка создания');
    } finally {
      setBusy(false);
    }
  }

  async function archive(s: string) {
    if (!confirm(`Архивировать проект ${s}?`)) return;
    setBusy(true);
    try {
      await projects.archive(s);
      notifications.show({ message: 'Архивирован', color: 'green' });
    } catch (e: any) {
      notifications.show({ message: e?.message || 'Ошибка', color: 'red' });
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File | null) {
    if (!file) return;
    const importSlug = prompt('Slug нового/целевого проекта', file.name.replace(/\.json$/i, '') || 'imported');
    if (!importSlug) return;
    setBusy(true);
    try {
      const text = await file.text();
      const database = JSON.parse(text);
      await api.call('importProjectFromJson', { slug: importSlug.trim(), database });
      await projects.load(false);
      notifications.show({ message: `Импорт в ${importSlug}`, color: 'green' });
    } catch (e: any) {
      notifications.show({ message: e?.message || 'Ошибка импорта', color: 'red' });
    } finally {
      setBusy(false);
    }
  }

  async function changeServerAdminPassword() {
    if (!saPass.trim()) return;
    if (saPass !== saPass2) {
      notifications.show({ message: 'Пароли не совпадают', color: 'red' });
      return;
    }
    setSaSaving(true);
    try {
      await api.call('changeServerAdminPassword', { newPassword: saPass.trim() });
      setSaPass('');
      setSaPass2('');
      notifications.show({ message: 'Пароль суперадмина обновлён', color: 'green' });
    } catch (e: any) {
      notifications.show({ message: e?.message || 'Не удалось сменить пароль', color: 'red' });
    } finally {
      setSaSaving(false);
    }
  }

  return (
    <Stack gap="md">
      <Title order={3}>Проекты</Title>
      <Text c="dimmed" size="sm">Управление инстансом (server-admin)</Text>
      {error && <Alert color="red">{error}</Alert>}

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>Пароль суперадмина</Text>
          <Text size="sm" c="dimmed">
            Логин: <Text span fw={600}>{auth.user?.name}</Text>
            . Меняется здесь, не в админке проекта.
          </Text>
          <Group grow align="flex-end">
            <PasswordInput
              label="Новый пароль"
              value={saPass}
              onChange={(e) => setSaPass(e.currentTarget.value)}
              autoComplete="new-password"
            />
            <PasswordInput
              label="Повтор"
              value={saPass2}
              onChange={(e) => setSaPass2(e.currentTarget.value)}
              autoComplete="new-password"
            />
          </Group>
          <Group>
            <Button
              loading={saSaving}
              disabled={!saPass.trim() || saPass !== saPass2}
              onClick={() => void changeServerAdminPassword()}
            >
              Сохранить пароль
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>Создать проект</Text>
          <Group grow>
            <TextInput label="Slug" placeholder="my-game" value={slug} onChange={(e) => setSlug(e.currentTarget.value)} />
            <TextInput label="Название" placeholder="Моя игра" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          </Group>
          <Group>
            <Button loading={busy} disabled={!slug.trim()} onClick={() => void create()}>Создать</Button>
            <FileButton onChange={(f) => void importFile(f)} accept="application/json,.json">
              {(props) => <Button {...props} variant="light" loading={busy}>Импорт JSON</Button>}
            </FileButton>
          </Group>
        </Stack>
      </Paper>

      {projects.loading && <Loader size="sm" />}
      <Stack gap="xs">
        {projects.projects.filter((p) => !p.joinable).map((p) => (
          <Paper key={p.slug} withBorder p="sm" radius="md">
            <Group justify="space-between">
              <div>
                <Group gap="xs">
                  <Text fw={600}>{p.name || p.slug}</Text>
                  {p.archived_at && <Badge color="gray">архив</Badge>}
                </Group>
                <Text size="xs" c="dimmed">{p.slug}</Text>
              </div>
              <Group gap="xs">
                {!p.archived_at && (
                  <Button size="compact-sm" variant="light" onClick={() => void projects.select(p.slug)}>
                    Открыть
                  </Button>
                )}
                {!p.archived_at && (
                  <Button size="compact-sm" color="red" variant="light" loading={busy} onClick={() => void archive(p.slug)}>
                    Архив
                  </Button>
                )}
              </Group>
            </Group>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
});

export default ProjectsPage;
