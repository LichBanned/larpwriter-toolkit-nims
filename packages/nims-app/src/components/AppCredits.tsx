import { Anchor, Text, Stack } from '@mantine/core';

type AppCreditsProps = {
  /** Tighter spacing for narrow chrome (sidebar). */
  compact?: boolean;
};

const muted = (compact: boolean) => ({
  lineHeight: 1.35,
  opacity: 0.72,
  fontSize: compact ? 10 : undefined,
});

/** Quiet courtesy credit — original authors + rewrite. */
export function AppCredits({ compact = false }: AppCreditsProps) {
  const style = muted(compact);
  return (
    <Stack gap={2} py={compact ? 4 : 0}>
      <Text size="xs" c="dimmed" style={style}>
        Авторство оригинального НИМС принадлежит Тимофею Речкалову и Марии Хмелёвой (
        <Anchor
          href="https://trechkalov.com/"
          target="_blank"
          rel="noopener noreferrer"
          size="xs"
          c="dimmed"
          underline="hover"
          style={style}
        >
          trechkalov.com
        </Anchor>
        )
      </Text>
      <Text size="xs" c="dimmed" style={style}>
        Переосмысление: Александр Хренников
      </Text>
    </Stack>
  );
}
