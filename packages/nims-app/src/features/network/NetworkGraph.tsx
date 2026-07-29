import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { useMantineColorScheme } from '@mantine/core';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import type { Options, IdType } from 'vis-network';
import type { GraphData } from './buildNetworkGraph';
import 'vis-network/styles/vis-network.min.css';

export type NetworkGraphHandle = {
  focusNode: (id: string) => void;
  fit: () => void;
};

type Props = {
  data: GraphData;
  /** Bump to force full redraw (e.g. after «Нарисовать»). */
  revision: number;
};

type NodeRow = {
  id: string;
  label: string;
  title?: string;
  color?: object;
  font?: { color?: string; size?: number; face?: string };
};

type EdgeRow = {
  id: string;
  from: string;
  to: string;
  title?: string;
  value?: number;
  width?: number;
  arrows?: string;
};

const DIM = { background: '#c9c9c9', border: '#aaaaaa', highlight: { background: '#c9c9c9', border: '#aaaaaa' } };
const ACTIVE = { background: '#4dabf7', border: '#1c7ed6', highlight: { background: '#228be6', border: '#1864ab' } };
const NEIGHBOR = { background: '#74c0fc', border: '#339af0', highlight: { background: '#4dabf7', border: '#1c7ed6' } };
const DEFAULT_NODE = { background: '#97c2fc', border: '#2b7ce9', highlight: { background: '#d2e5ff', border: '#2b7ce9' } };

function labelColors(isDark: boolean) {
  return {
    normal: isDark ? '#e9ecef' : '#212529',
    active: isDark ? '#ffffff' : '#212529',
    dim: isDark ? '#868e96' : '#999999',
  };
}

function buildOptions(isDark: boolean): Options {
  const labels = labelColors(isDark);
  return {
    nodes: {
      shape: 'dot',
      scaling: {
        min: 10,
        max: 30,
        label: {
          min: 10,
          max: 24,
          drawThreshold: 5,
          maxVisible: 40,
        },
      },
      font: {
        size: 16,
        face: 'Tahoma, system-ui, sans-serif',
        color: labels.normal,
      },
      borderWidth: 1,
    },
    edges: {
      width: 1,
      color: {
        inherit: false,
        color: isDark ? '#868e96' : '#848484',
        highlight: '#2b8aef',
        opacity: 0.85,
      },
      smooth: {
        enabled: true,
        type: 'dynamic',
        roundness: 0.5,
      },
      selectionWidth: 2,
    },
    physics: {
      enabled: true,
      barnesHut: {
        gravitationalConstant: -8000,
        centralGravity: 0.15,
        springLength: 120,
        springConstant: 0.04,
        damping: 0.4,
        avoidOverlap: 0.2,
      },
      stabilization: {
        enabled: true,
        iterations: 180,
        updateInterval: 25,
      },
    },
    interaction: {
      hover: true,
      tooltipDelay: 120,
      multiselect: false,
      navigationButtons: false,
      keyboard: false,
    },
  };
}

export const NetworkGraph = forwardRef<NetworkGraphHandle, Props>(function NetworkGraph(
  { data, revision },
  ref,
) {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesRef = useRef<DataSet<NodeRow> | null>(null);
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  const highlightNeighborhood = (nodeId: IdType | null) => {
    const net = networkRef.current;
    const nodes = nodesRef.current;
    if (!net || !nodes) return;

    const labels = labelColors(isDarkRef.current);
    const allIds = nodes.getIds();
    if (nodeId == null) {
      allIds.forEach((id) => {
        nodes.update({ id: String(id), color: DEFAULT_NODE, font: { color: labels.normal } });
      });
      return;
    }

    const connected = new Set<IdType>(net.getConnectedNodes(nodeId) as IdType[]);
    connected.add(nodeId);

    allIds.forEach((id) => {
      if (id === nodeId) {
        nodes.update({ id: String(id), color: ACTIVE, font: { color: labels.active } });
      } else if (connected.has(id)) {
        nodes.update({ id: String(id), color: NEIGHBOR, font: { color: labels.active } });
      } else {
        nodes.update({ id: String(id), color: DIM, font: { color: labels.dim } });
      }
    });
  };

  useImperativeHandle(ref, () => ({
    focusNode: (id: string) => {
      const net = networkRef.current;
      if (!net) return;
      try {
        net.focus(id, {
          scale: 1.2,
          animation: { duration: 800, easingFunction: 'easeInOutQuad' },
        });
        net.selectNodes([id]);
        highlightNeighborhood(id);
      } catch {
        /* node missing */
      }
    },
    fit: () => {
      networkRef.current?.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
    },
  }));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const labels = labelColors(isDark);
    const nodes = new DataSet<NodeRow>(
      data.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        title: n.title,
        color: DEFAULT_NODE,
        font: { color: labels.normal },
      })),
    );
    const edges = new DataSet<EdgeRow>(
      data.edges.map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        title: e.title,
        value: e.value,
        width: e.width,
        arrows: e.arrows,
      })),
    );

    nodesRef.current = nodes;

    const net = new Network(el, { nodes, edges }, buildOptions(isDark));
    networkRef.current = net;

    const onClick = (params: { nodes: IdType[] }) => {
      const id = params.nodes[0];
      highlightNeighborhood(id ?? null);
    };
    net.on('click', onClick);

    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        net.setSize(`${Math.floor(width)}px`, `${Math.floor(height)}px`);
        net.redraw();
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      net.off('click', onClick);
      net.destroy();
      networkRef.current = null;
      nodesRef.current = null;
    };
    // revision / theme change force recreate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, isDark]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: 'min(60vh, 560px)',
        minHeight: 320,
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--mantine-color-default-border)',
        background: 'var(--mantine-color-body)',
      }}
    />
  );
});
