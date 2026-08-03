import { useEffect, useMemo, Fragment } from 'react';
import {
  AppShell as MantineAppShell,
  Burger,
  Group,
  NavLink,
  ScrollArea,
  Text,
  ActionIcon,
  Tooltip,
  Button,
  Alert,
  Divider,
  Select,
  Stack,
} from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { observer } from 'mobx-react-lite';
import { McpTokenModal } from '@/features/mcp/McpTokenModal';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AppCredits } from '@/components/AppCredits';
import { useRootStore } from '@/stores';
import { useIsCompact } from '@/hooks/useIsCompact';
import { useIsMobile } from '@/hooks/useIsMobile';

type NavItem =
  | { path: string; labelKey: string; icon: string }
  | { action: 'mcp'; labelKey: string; icon: string };

type NavSection = {
  title: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    title: 'Обзор',
    items: [
      { path: '/', labelKey: 'nav.overview', icon: '📋' },
      { path: '/timeline', labelKey: 'nav.timeline', icon: '⏱️' },
      { path: '/network', labelKey: 'nav.network', icon: '🕸️' },
      { path: '/role-grid', labelKey: 'nav.roleGrid', icon: '▦' },
    ],
  },
  {
    title: 'Люди',
    items: [
      { path: '/characters', labelKey: 'nav.characters', icon: '👤' },
      { path: '/players', labelKey: 'nav.players', icon: '🎮' },
    ],
  },
  {
    title: 'Сюжет',
    items: [
      { path: '/stories', labelKey: 'nav.stories', icon: '📖' },
      { path: '/groups', labelKey: 'nav.groups', icon: '👥' },
      { path: '/relations', labelKey: 'nav.relations', icon: '🔗' },
      { path: '/adaptations', labelKey: 'nav.adaptations', icon: '✍️' },
      { path: '/briefings', labelKey: 'nav.briefings', icon: '📄' },
    ],
  },
  {
    title: 'Инструменты',
    items: [
      { path: '/profile-filter', labelKey: 'nav.profileFilter', icon: '🧰' },
      { path: '/search', labelKey: 'nav.search', icon: '🔍' },
      { action: 'mcp', labelKey: 'nav.mcp', icon: '🔌' },
    ],
  },
  {
    title: 'Админ',
    items: [
      { path: '/admin', labelKey: 'nav.admin', icon: '⚙️' },
      { path: '/projects', labelKey: 'Проекты', icon: '📁' },
    ],
  },
];

const allNavItems = navSections.flatMap((s) => s.items);

export const AppShell = observer(function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure();
  const [mcpOpened, { open: openMcp, close: closeMcp }] = useDisclosure();
  /** null = no explicit choice → auto-collapse on compact screens */
  const [userCollapsed, setUserCollapsed] = useLocalStorage<boolean | null>({
    key: 'nims-nav-collapsed-user',
    defaultValue: null,
    serialize: (v) => JSON.stringify(v),
    deserialize: (v) => {
      if (v == null || v === '') return null;
      try {
        return JSON.parse(v) as boolean | null;
      } catch {
        return null;
      }
    },
  });
  const isCompact = useIsCompact();
  const isMobile = useIsMobile();
  const collapsed = userCollapsed !== null ? userCollapsed : isCompact;
  const setCollapsed = (next: boolean) => setUserCollapsed(next);
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { auth, permissions, projects } = useRootStore();

  useEffect(() => {
    if (auth.isLoggedIn) void projects.load(false);
  }, [auth.isLoggedIn, projects]);

  // Icon-only rail is for desktop/tablet compact only — never in the mobile drawer.
  const iconOnly = collapsed && !isMobile;
  const navWidth = iconOnly ? 64 : 220;

  const pageTitle = useMemo(() => {
    const item = allNavItems.find((n) => 'path' in n && n.path === location.pathname);
    return item ? t(item.labelKey) : 'NIMS';
  }, [location.pathname, t]);

  useEffect(() => { closeMobile(); }, [location.pathname]);

  const go = (path: string) => {
    navigate(path);
    closeMobile();
  };

  const onNav = (item: NavItem) => {
    if ('action' in item && item.action === 'mcp') {
      openMcp();
      closeMobile();
      return;
    }
    if ('path' in item) go(item.path);
  };

  const renderNavItem = (item: NavItem) => {
    const key = 'path' in item ? item.path : item.action;
    const active = 'path' in item && location.pathname === item.path;
    if (iconOnly) {
      return (
        <Tooltip key={key} label={t(item.labelKey)} position="right" withArrow>
          <ActionIcon
            variant={active ? 'filled' : 'subtle'}
            size={44}
            onClick={() => onNav(item)}
            aria-label={t(item.labelKey)}
            style={{ width: '100%', marginBottom: 4, minHeight: 44 }}
          >
            <span style={{ fontSize: 18 }}>{item.icon}</span>
          </ActionIcon>
        </Tooltip>
      );
    }
    return (
      <NavLink
        key={key}
        label={t(item.labelKey)}
        leftSection={<span aria-hidden style={{ fontSize: 18 }}>{item.icon}</span>}
        active={active}
        onClick={() => onNav(item)}
        styles={{
          root: { minHeight: 44, borderRadius: 8, marginBottom: 2 },
          label: { fontSize: 'var(--mantine-font-size-sm)' },
        }}
      />
    );
  };

  return (
    <MantineAppShell
      header={{ height: 52 }}
      navbar={{ width: navWidth, breakpoint: 'md', collapsed: { mobile: !mobileOpened } }}
      padding={{ base: 'sm', md: 'md' }}
      transitionDuration={200}
      styles={{
        navbar: {
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        },
        main: {
          paddingBottom: 'calc(var(--mantine-spacing-md) + env(safe-area-inset-bottom, 0px))',
        },
      }}
    >
      <MantineAppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <Burger
              opened={mobileOpened}
              onClick={toggleMobile}
              hiddenFrom="md"
              size="sm"
              aria-label="Меню"
            />
            <Tooltip label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} position="bottom">
              <ActionIcon
                variant="default"
                onClick={() => setCollapsed(!collapsed)}
                size="lg"
                visibleFrom="md"
                aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
              >
                <Text size="sm" fw={600} style={{ lineHeight: 1 }}>
                  {collapsed ? '»' : '«'}
                </Text>
              </ActionIcon>
            </Tooltip>
            <Text fw={700} size="lg" style={{ cursor: 'pointer', flexShrink: 0 }} onClick={() => go('/')}>
              NIMS
            </Text>
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
                    minWidth: isMobile ? 110 : 160,
                    maxWidth: isMobile ? 180 : 200,
                  },
                  input: { minHeight: 36 },
                }}
              />
            )}
            <Text size="sm" c="dimmed" truncate style={{ minWidth: 0 }} visibleFrom="sm">
              {pageTitle}
            </Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {auth.user && (
              <Text size="sm" c="dimmed" visibleFrom="md" truncate maw={180}>
                {auth.user.name}
                {auth.user.role ? ` · ${auth.user.role}` : ''}
              </Text>
            )}
            <ThemeToggle compact />
            <Button
              size="compact-sm"
              variant="default"
              visibleFrom="md"
              onClick={() => void auth.logout()}
            >
              Выйти
            </Button>
          </Group>
        </Group>
      </MantineAppShell.Header>

      <MantineAppShell.Navbar p="xs">
        <MantineAppShell.Section grow component={ScrollArea} type="scroll" offsetScrollbars>
          {navSections.map((section, sectionIndex) => {
            const items = section.items.filter((item) => {
              if ('path' in item && item.path === '/projects') return auth.isServerAdmin;
              if ('path' in item && item.path === '/admin') return auth.isOrganizer;
              return true;
            });
            if (!items.length) return null;
            return (
            <Fragment key={section.title}>
              {sectionIndex > 0 && <Divider my={iconOnly ? 6 : 8} />}
              {!iconOnly && (
                <Text
                  size="xs"
                  c="dimmed"
                  tt="uppercase"
                  fw={600}
                  px="xs"
                  mb={4}
                  style={{ letterSpacing: '0.04em' }}
                >
                  {section.title}
                </Text>
              )}
              {items.map(renderNavItem)}
            </Fragment>
            );
          })}
        </MantineAppShell.Section>
        <MantineAppShell.Section hiddenFrom="md" mt="xs">
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
        {!iconOnly && (
          <MantineAppShell.Section mt="xs">
            <Divider mb="xs" />
            <AppCredits compact />
          </MantineAppShell.Section>
        )}
      </MantineAppShell.Navbar>

      <MantineAppShell.Main>
        {permissions.loadError && (
          <Alert color="orange" mb="sm" title="Права доступа не загружены">
            {permissions.loadError}. Режим редактора и владельцы могут отображаться неверно.
          </Alert>
        )}
        {children}
      </MantineAppShell.Main>

      <McpTokenModal opened={mcpOpened} onClose={closeMcp} />
    </MantineAppShell>
  );
});
