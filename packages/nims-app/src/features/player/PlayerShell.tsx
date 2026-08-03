import { Fragment, useEffect, useState } from 'react';
import {
  AppShell as MantineAppShell,
  Group,
  Text,
  Button,
  NavLink,
  Burger,
  Divider,
  Stack,
  Tooltip,
  Box,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useNavigate, useLocation } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import { Select } from '@mantine/core';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AppCredits } from '@/components/AppCredits';
import { useRootStore } from '@/stores';

const playerNav = [
  { path: '/', label: 'О вас', icon: '🧑', always: true },
  { path: '/questionnaire', label: 'Анкета', icon: '📝', always: true },
  { path: '/character', label: 'Персонаж', icon: '🎭', always: false },
  { path: '/role-grid', label: 'Сетка ролей', icon: '▦', always: true, option: 'roleGrid' },
] as const;

export const PlayerShell = observer(function PlayerShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { auth, api, projects } = useRootStore();
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure();
  const [hasCharacter, setHasCharacter] = useState(false);
  const [roleGridAllowed, setRoleGridAllowed] = useState(true);

  useEffect(() => {
    void projects.load(false);
  }, [projects]);

  useEffect(() => {
    let cancelled = false;
    api.get<{ character?: { name: string } }>('getPlayerProfileInfo')
      .then((info) => {
        if (!cancelled) setHasCharacter(!!info?.character);
      })
      .catch(() => {
        if (!cancelled) setHasCharacter(false);
      });
    return () => { cancelled = true; };
  }, [api, location.pathname]);

  useEffect(() => {
    let cancelled = false;
    api.get<{ allowRoleGridView?: boolean }>('getPlayersOptions')
      .then((opts) => {
        if (!cancelled) setRoleGridAllowed(opts?.allowRoleGridView !== false);
      })
      .catch(() => {
        if (!cancelled) setRoleGridAllowed(false);
      });
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => {
    closeMobile();
  }, [location.pathname, closeMobile]);

  const go = (path: string) => {
    navigate(path);
    closeMobile();
  };

  return (
    <MantineAppShell
      header={{ height: 52 }}
      navbar={{ width: 200, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
      padding={{ base: 'sm', md: 'md' }}
      styles={{
        main: {
          paddingBottom: 'calc(var(--mantine-spacing-md) + env(safe-area-inset-bottom, 0px))',
        },
      }}
    >
      <MantineAppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" aria-label="Меню" />
            <Text fw={700} size="lg" style={{ flexShrink: 0 }}>NIMS</Text>
            {auth.user?.projectSlug && (
              <Select
                size="xs"
                aria-label="Проект"
                allowDeselect={false}
                value={auth.user.projectSlug}
                data={projects.projects
                  .filter((p) => !p.joinable && !p.archived_at)
                  .map((p) => ({ value: p.slug, label: p.name || p.slug }))}
                onChange={(slug) => {
                  if (slug && slug !== auth.user?.projectSlug) {
                    projects.beginSwitch(slug);
                  }
                }}
                styles={{
                  root: {
                    flex: '1 1 auto',
                    minWidth: 110,
                    maxWidth: 180,
                  },
                  input: { minHeight: 36 },
                }}
              />
            )}
            <Text size="sm" c="dimmed" visibleFrom="sm">Кабинет игрока</Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {auth.user && (
              <Text size="sm" c="dimmed" visibleFrom="sm" truncate maw={140}>
                {auth.user.name}
              </Text>
            )}
            <ThemeToggle compact />
            <Button
              size="compact-sm"
              variant="default"
              visibleFrom="sm"
              onClick={() => void auth.logout()}
            >
              Выйти
            </Button>
          </Group>
        </Group>
      </MantineAppShell.Header>

      <MantineAppShell.Navbar p="xs">
        <MantineAppShell.Section grow>
          {playerNav.map((item) => {
            if ('option' in item && item.option === 'roleGrid' && !roleGridAllowed) {
              return null;
            }
            const disabled = !item.always && !hasCharacter;
            const link = (
              <NavLink
                label={item.label}
                leftSection={<span aria-hidden style={{ fontSize: 18 }}>{item.icon}</span>}
                active={location.pathname === item.path}
                disabled={disabled}
                onClick={() => { if (!disabled) go(item.path); }}
                styles={{
                  root: { minHeight: 44, borderRadius: 8, marginBottom: 2 },
                }}
              />
            );
            if (!disabled) return <Fragment key={item.path}>{link}</Fragment>;
            return (
              <Tooltip
                key={item.path}
                label="Персонаж ещё не привязан к вашему профилю"
                position="right"
                withArrow
              >
                <Box>{link}</Box>
              </Tooltip>
            );
          })}
        </MantineAppShell.Section>
        <MantineAppShell.Section hiddenFrom="sm" mt="xs">
          <Divider mb="sm" />
          <Stack gap="xs">
            {auth.user && (
              <Text size="sm" c="dimmed" truncate>
                {auth.user.name}
              </Text>
            )}
            <Button
              fullWidth
              variant="default"
              styles={{ root: { minHeight: 44 } }}
              onClick={() => void auth.logout()}
            >
              Выйти
            </Button>
          </Stack>
        </MantineAppShell.Section>
        <MantineAppShell.Section mt="xs">
          <Divider mb="xs" />
          <AppCredits compact />
        </MantineAppShell.Section>
      </MantineAppShell.Navbar>

      <MantineAppShell.Main>
        {children}
      </MantineAppShell.Main>
    </MantineAppShell>
  );
});
