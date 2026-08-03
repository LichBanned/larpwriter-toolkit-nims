import { useCallback, useEffect, useState } from 'react';
import {
  Stack, Title, Text, Button, Group, Paper, TextInput, FileButton, Alert, Badge, Loader,
  PasswordInput, Table, Modal,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { observer } from 'mobx-react-lite';
import { useRootStore } from '@/stores';

type AccountRow = {
  username: string;
  kind: string;
  is_server_admin: boolean;
  projects: string[];
};

function kindLabel(kind: string) {
  if (kind === 'both') return 'орг+игрок';
  if (kind === 'player') return 'игрок';
  return 'организатор';
}

export const ProjectsPage = observer(function ProjectsPage() {
  const { projects, auth, api } = useRootStore();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [passOpened, { open: openPass, close: closePass }] = useDisclosure(false);
  const [passUser, setPassUser] = useState<string | null>(null);
  const [passValue, setPassValue] = useState('');
  const [passValue2, setPassValue2] = useState('');
  const [passSaving, setPassSaving] = useState(false);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const rows = await api.get<AccountRow[]>('listAccounts');
      setAccounts(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      notifications.show({ message: e?.message || 'Не удалось загрузить аккаунты', color: 'red' });
      setAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void projects.load(false);
    void loadAccounts();
  }, [projects, loadAccounts]);

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
      notifications.show({ message: `Импорт контента в ${importSlug} (пользователи не изменялись)`, color: 'green' });
    } catch (e: any) {
      notifications.show({ message: e?.message || 'Ошибка импорта', color: 'red' });
    } finally {
      setBusy(false);
    }
  }

  function openChangePassword(username: string) {
    setPassUser(username);
    setPassValue('');
    setPassValue2('');
    openPass();
  }

  async function confirmPasswordChange() {
    if (!passUser || !passValue.trim()) return;
    if (passValue !== passValue2) {
      notifications.show({ message: 'Пароли не совпадают', color: 'red' });
      return;
    }
    setPassSaving(true);
    try {
      await api.call('changeAccountPassword', {
        userName: passUser,
        newPassword: passValue.trim(),
      });
      notifications.show({ message: `Пароль для «${passUser}» обновлён`, color: 'green' });
      setPassUser(null);
      setPassValue('');
      setPassValue2('');
      closePass();
    } catch (e: any) {
      notifications.show({ message: e?.message || 'Не удалось сменить пароль', color: 'red' });
    } finally {
      setPassSaving(false);
    }
  }

  return (
    <Stack gap="md">
      <Title order={3}>Проекты</Title>
      <Text c="dimmed" size="sm">Управление инстансом (server-admin)</Text>
      {error && <Alert color="red">{error}</Alert>}

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <div>
              <Text fw={600}>Пароли аккаунтов</Text>
              <Text size="sm" c="dimmed">
                Смена паролей только здесь. Хранятся в таблице accounts, не в проектах.
              </Text>
            </div>
            <Button variant="light" size="compact-sm" loading={accountsLoading} onClick={() => void loadAccounts()}>
              Обновить
            </Button>
          </Group>
          {accountsLoading && accounts.length === 0 ? (
            <Loader size="sm" />
          ) : accounts.length === 0 ? (
            <Text c="dimmed" size="sm">Нет аккаунтов</Text>
          ) : (
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Логин</Table.Th>
                  <Table.Th>Тип</Table.Th>
                  <Table.Th>Проекты</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {accounts.map((a) => (
                  <Table.Tr key={a.username}>
                    <Table.Td>
                      <Group gap="xs">
                        <Text fw={a.username === auth.user?.name ? 600 : 400}>{a.username}</Text>
                        {a.is_server_admin && <Badge size="xs" color="violet">суперадмин</Badge>}
                        {a.username === auth.user?.name && <Badge size="xs" color="gray" variant="outline">вы</Badge>}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{kindLabel(a.kind)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {a.projects.length ? a.projects.join(', ') : '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Button size="compact-xs" variant="subtle" onClick={() => openChangePassword(a.username)}>
                        Пароль
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
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

      <Modal
        opened={passOpened}
        onClose={() => { closePass(); setPassUser(null); setPassValue(''); setPassValue2(''); }}
        title={passUser ? `Новый пароль: ${passUser}` : 'Смена пароля'}
      >
        <Stack>
          <PasswordInput
            label="Новый пароль"
            value={passValue}
            onChange={(e) => setPassValue(e.currentTarget.value)}
            autoFocus
            autoComplete="new-password"
          />
          <PasswordInput
            label="Повтор"
            value={passValue2}
            onChange={(e) => setPassValue2(e.currentTarget.value)}
            autoComplete="new-password"
          />
          <Group justify="flex-end">
            <Button
              variant="subtle"
              onClick={() => { closePass(); setPassUser(null); setPassValue(''); setPassValue2(''); }}
            >
              Отмена
            </Button>
            <Button
              loading={passSaving}
              disabled={!passValue.trim() || passValue !== passValue2}
              onClick={() => void confirmPasswordChange()}
            >
              Сохранить
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
});

export default ProjectsPage;
