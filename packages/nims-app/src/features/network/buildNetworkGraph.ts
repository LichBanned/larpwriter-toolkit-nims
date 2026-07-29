export type RelationEssence = 'starterToEnder' | 'allies' | 'enderToStarter';

export type NetworkMode = 'relations' | 'coAppearance';

export interface RelationLike {
  starter: string;
  ender: string;
  essence?: RelationEssence[] | unknown;
}

export interface StoryLike {
  name: string;
  events?: Array<{
    name?: string;
    characters?: Record<string, unknown>;
  }>;
}

export interface GraphNode {
  id: string;
  label: string;
  title?: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  title?: string;
  value?: number;
  width?: number;
  arrows?: string;
  color?: { color?: string; highlight?: string; opacity?: number };
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const ESSENCE_LABEL: Record<RelationEssence, string> = {
  allies: 'союзники',
  starterToEnder: '→',
  enderToStarter: '←',
};

function asEssenceList(raw: unknown): RelationEssence[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is RelationEssence =>
    x === 'allies' || x === 'starterToEnder' || x === 'enderToStarter');
}

/** Neutral = no essence flags (or empty). */
function matchesEssenceFilter(essence: RelationEssence[], selected: Set<RelationEssence | 'neutral'>): boolean {
  if (essence.length === 0) return selected.has('neutral');
  return essence.some((e) => selected.has(e));
}

function edgeArrows(essence: RelationEssence[]): string | undefined {
  const hasTo = essence.includes('starterToEnder');
  const hasFrom = essence.includes('enderToStarter');
  if (hasTo && hasFrom) return 'to, from';
  if (hasTo) return 'to';
  if (hasFrom) return 'from';
  return undefined;
}

export function buildRelationsGraph(
  relations: RelationLike[],
  essenceFilter: Set<RelationEssence | 'neutral'>,
): GraphData {
  const nodeIds = new Set<string>();
  const edges: GraphEdge[] = [];

  relations.forEach((rel, i) => {
    const essence = asEssenceList(rel.essence);
    if (!matchesEssenceFilter(essence, essenceFilter)) return;
    if (!rel.starter || !rel.ender) return;

    nodeIds.add(rel.starter);
    nodeIds.add(rel.ender);

    const labels = essence.length
      ? essence.map((e) => ESSENCE_LABEL[e]).join(', ')
      : 'нейтральные';

    edges.push({
      id: `rel-${i}-${rel.starter}-${rel.ender}`,
      from: rel.starter,
      to: rel.ender,
      title: labels,
      arrows: edgeArrows(essence),
      width: essence.includes('allies') ? 2 : 1,
    });
  });

  const nodes: GraphNode[] = [...nodeIds].sort((a, b) => a.localeCompare(b, 'ru')).map((id) => ({
    id,
    label: id,
    title: id,
  }));

  return { nodes, edges };
}

/** Pair key for undirected co-appearance. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

export function buildCoAppearanceGraph(stories: Record<string, StoryLike>): GraphData {
  /** pairKey -> { count, storyNames } */
  const pairs = new Map<string, { count: number; stories: Set<string> }>();

  Object.values(stories).forEach((story) => {
    const storyName = story.name || '';
    const events = story.events || [];
    events.forEach((ev) => {
      const names = Object.keys(ev.characters || {}).sort((a, b) => a.localeCompare(b, 'ru'));
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const key = pairKey(names[i], names[j]);
          let entry = pairs.get(key);
          if (!entry) {
            entry = { count: 0, stories: new Set() };
            pairs.set(key, entry);
          }
          entry.count += 1;
          if (storyName) entry.stories.add(storyName);
        }
      }
    });
  });

  const nodeIds = new Set<string>();
  const edges: GraphEdge[] = [];
  let ei = 0;
  pairs.forEach((info, key) => {
    const [a, b] = key.split('||');
    nodeIds.add(a);
    nodeIds.add(b);
    const storyList = [...info.stories].sort((x, y) => x.localeCompare(y, 'ru'));
    edges.push({
      id: `co-${ei++}`,
      from: a,
      to: b,
      value: info.count,
      width: Math.min(1 + info.count * 0.4, 6),
      title: `Общих появлений в событиях: ${info.count}`
        + (storyList.length ? `\n${storyList.join(', ')}` : ''),
    });
  });

  const nodes: GraphNode[] = [...nodeIds].sort((a, b) => a.localeCompare(b, 'ru')).map((id) => ({
    id,
    label: id,
    title: id,
  }));

  return { nodes, edges };
}

export function buildNetworkGraph(opts: {
  mode: NetworkMode;
  relations: RelationLike[];
  stories: Record<string, StoryLike>;
  essenceFilter: Set<RelationEssence | 'neutral'>;
}): GraphData {
  if (opts.mode === 'coAppearance') {
    return buildCoAppearanceGraph(opts.stories);
  }
  return buildRelationsGraph(opts.relations, opts.essenceFilter);
}

export const HEAVY_NODE_THRESHOLD = 80;
export const HEAVY_EDGE_THRESHOLD = 200;

export function isHeavyGraph(data: GraphData): boolean {
  return data.nodes.length > HEAVY_NODE_THRESHOLD || data.edges.length > HEAVY_EDGE_THRESHOLD;
}
