import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Title,
  Stack,
  Text,
  Card,
  Group,
  Button,
  SegmentedControl,
  Select,
  Checkbox,
  Alert,
  Skeleton,
} from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { useTranslation } from 'react-i18next';
import { useRootStore } from '@/stores';
import { NetworkGraph, type NetworkGraphHandle } from './NetworkGraph';
import {
  buildNetworkGraph,
  isHeavyGraph,
  type NetworkMode,
  type RelationEssence,
  type StoryLike,
} from './buildNetworkGraph';

const ESSENCE_OPTIONS: Array<{ value: RelationEssence | 'neutral'; label: string }> = [
  { value: 'allies', label: 'Союзники' },
  { value: 'starterToEnder', label: 'От первого ко второму' },
  { value: 'enderToStarter', label: 'От второго к первому' },
  { value: 'neutral', label: 'Нейтральные' },
];

function NetworkPage() {
  const { t } = useTranslation();
  const { relations, characters, api } = useRootStore();
  const graphRef = useRef<NetworkGraphHandle>(null);

  const [stories, setStories] = useState<Record<string, StoryLike>>({});
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<NetworkMode>('relations');
  const [essenceSelected, setEssenceSelected] = useState<Array<RelationEssence | 'neutral'>>([
    'allies',
    'starterToEnder',
    'enderToStarter',
    'neutral',
  ]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [drawn, setDrawn] = useState<ReturnType<typeof buildNetworkGraph> | null>(null);
  const [warnDismissed, setWarnDismissed] = useLocalStorage({
    key: 'nims-network-heavy-warn-dismissed',
    defaultValue: false,
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      relations.load(),
      characters.loadNames(),
      api.get<Record<string, StoryLike>>('getAllStories').then((s) => {
        if (!cancelled) setStories(s || {});
      }).catch(() => {
        if (!cancelled) setStories({});
      }),
    ]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const essenceFilter = useMemo(
    () => new Set(essenceSelected),
    [essenceSelected],
  );

  const preview = useMemo(
    () => buildNetworkGraph({
      mode,
      relations: relations.relations,
      stories,
      essenceFilter,
    }),
    [mode, relations.relations, stories, essenceFilter],
  );

  const draw = useCallback(() => {
    const next = buildNetworkGraph({
      mode,
      relations: relations.relations,
      stories,
      essenceFilter,
    });
    setDrawn(next);
    setRevision((r) => r + 1);
    setFocusId(null);
  }, [mode, relations.relations, stories, essenceFilter]);

  // Auto-draw once data is ready
  useEffect(() => {
    if (!loading && drawn === null) {
      draw();
    }
  }, [loading, drawn, draw]);

  const nodeOptions = useMemo(
    () => (drawn?.nodes || []).map((n) => ({ value: n.id, label: n.label })),
    [drawn],
  );

  const showHeavyWarn = drawn && isHeavyGraph(drawn) && !warnDismissed;

  if (loading) {
    return (
      <Stack gap="md">
        <Title order={2}>{t('network.title')}</Title>
        <Skeleton height={40} />
        <Skeleton height={360} />
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Title order={2}>{t('network.title')}</Title>

      <Card withBorder padding="md">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
            <SegmentedControl
              value={mode}
              onChange={(v) => setMode(v as NetworkMode)}
              data={[
                { value: 'relations', label: 'Отношения' },
                { value: 'coAppearance', label: 'Вместе в событиях' },
              ]}
            />
            <Group gap="xs">
              <Select
                placeholder="Показать узел"
                searchable
                clearable
                data={nodeOptions}
                value={focusId}
                onChange={(v) => {
                  setFocusId(v);
                  if (v) graphRef.current?.focusNode(v);
                }}
                w={220}
                disabled={!drawn?.nodes.length}
              />
              <Button onClick={draw}>Нарисовать</Button>
            </Group>
          </Group>

          {mode === 'relations' && (
            <Group gap="md" wrap="wrap">
              <Text size="sm" c="dimmed">Виды отношений:</Text>
              {ESSENCE_OPTIONS.map((opt) => (
                <Checkbox
                  key={opt.value}
                  label={opt.label}
                  checked={essenceSelected.includes(opt.value)}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setEssenceSelected((prev) => (
                      on ? [...prev, opt.value] : prev.filter((x) => x !== opt.value)
                    ));
                  }}
                />
              ))}
            </Group>
          )}

          <Group gap="lg">
            <Text size="sm" c="dimmed">
              Узлов в выборке: {preview.nodes.length}
            </Text>
            <Text size="sm" c="dimmed">
              Связей в выборке: {preview.edges.length}
            </Text>
            {drawn && (
              <Text size="sm" c="dimmed">
                На графе: {drawn.nodes.length} / {drawn.edges.length}
              </Text>
            )}
          </Group>
        </Stack>
      </Card>

      {showHeavyWarn && (
        <Alert
          color="orange"
          title="Тяжёлая отрисовка"
          withCloseButton
          onClose={() => setWarnDismissed(true)}
        >
          Отрисовка большой сети может занять заметное время и нагрузку на браузер.
          Рекомендуем сохранить данные перед работой с графом.
        </Alert>
      )}

      {drawn && drawn.nodes.length > 0 ? (
        <Card withBorder padding="xs">
          <NetworkGraph ref={graphRef} data={drawn} revision={revision} />
        </Card>
      ) : (
        <Text c="dimmed">{t('common.noData')}</Text>
      )}
    </Stack>
  );
}

export default observer(NetworkPage);
