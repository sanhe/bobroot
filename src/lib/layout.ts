import type { LayoutNode, PanelRef, SplitDirection } from "./types";

export type DropEdge = "top" | "right" | "bottom" | "left";

export const ALL_PANEL_REFS: PanelRef[] = ["left", "right", "terminal", "agent"];

export function defaultLayout(): LayoutNode {
  return {
    kind: "split",
    direction: "column",
    sizes: [3, 1],
    children: [
      {
        kind: "split",
        direction: "row",
        sizes: [1, 1],
        children: [
          { kind: "leaf", ref: "left" },
          { kind: "leaf", ref: "right" },
        ],
      },
      {
        kind: "split",
        direction: "row",
        sizes: [1, 1],
        children: [
          { kind: "leaf", ref: "terminal" },
          { kind: "leaf", ref: "agent" },
        ],
      },
    ],
  };
}

export function buildLayoutFromLegacy(legacy: {
  rightPanelVisible?: boolean;
  panelSplit?: number;
  terminalVisible?: boolean;
  terminalHeight?: number;
}): { layout: LayoutNode; visibility: Record<PanelRef, boolean> } {
  const split = clampLegacySplit(legacy.panelSplit ?? 0.5);
  const layout: LayoutNode = {
    kind: "split",
    direction: "column",
    sizes: [3, 1],
    children: [
      {
        kind: "split",
        direction: "row",
        sizes: [split, 1 - split],
        children: [
          { kind: "leaf", ref: "left" },
          { kind: "leaf", ref: "right" },
        ],
      },
      {
        kind: "split",
        direction: "row",
        sizes: [1, 1],
        children: [
          { kind: "leaf", ref: "terminal" },
          { kind: "leaf", ref: "agent" },
        ],
      },
    ],
  };

  return {
    layout,
    visibility: {
      left: true,
      right: legacy.rightPanelVisible !== false,
      terminal: Boolean(legacy.terminalVisible),
      agent: false,
    },
  };
}

function clampLegacySplit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(0.95, Math.max(0.05, value));
}

export function collectPanelRefs(node: LayoutNode): Set<PanelRef> {
  const refs = new Set<PanelRef>();
  walkLeaves(node, (leaf) => {
    refs.add(leaf.ref);
  });
  return refs;
}

function walkLeaves(
  node: LayoutNode,
  visit: (leaf: { kind: "leaf"; ref: PanelRef }) => void,
): void {
  if (node.kind === "leaf") {
    visit(node);
    return;
  }
  for (const child of node.children) {
    walkLeaves(child, visit);
  }
}

export function ensureAllRefsPresent(layout: LayoutNode): LayoutNode {
  const present = collectPanelRefs(layout);
  let next = layout;
  for (const ref of ALL_PANEL_REFS) {
    if (!present.has(ref)) {
      next = appendLeafToRoot(next, ref);
    }
  }
  return removeUnknownRefs(next) ?? defaultLayout();
}

function appendLeafToRoot(node: LayoutNode, ref: PanelRef): LayoutNode {
  if (node.kind === "split" && node.direction === "column") {
    return {
      ...node,
      children: [...node.children, { kind: "leaf", ref }],
      sizes: [...node.sizes, defaultSizeFor(ref)],
    };
  }
  return {
    kind: "split",
    direction: "column",
    children: [node, { kind: "leaf", ref }],
    sizes: [3, defaultSizeFor(ref)],
  };
}

function defaultSizeFor(ref: PanelRef): number {
  return ref === "terminal" || ref === "agent" ? 1 : 1.5;
}

function removeUnknownRefs(node: LayoutNode): LayoutNode | null {
  if (node.kind === "leaf") {
    return ALL_PANEL_REFS.includes(node.ref) ? node : null;
  }
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, index) => {
    const cleaned = removeUnknownRefs(child);
    if (cleaned) {
      children.push(cleaned);
      sizes.push(node.sizes[index] ?? 1);
    }
  });
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0];
  }
  return { ...node, children, sizes };
}

export function normalizeLayout(node: LayoutNode | undefined): LayoutNode {
  if (!node) {
    return defaultLayout();
  }
  const cleaned = removeUnknownRefs(deduplicateLeaves(node));
  return ensureAllRefsPresent(cleaned ?? defaultLayout());
}

function deduplicateLeaves(node: LayoutNode): LayoutNode {
  const seen = new Set<PanelRef>();
  const walk = (current: LayoutNode): LayoutNode | null => {
    if (current.kind === "leaf") {
      if (seen.has(current.ref)) {
        return null;
      }
      seen.add(current.ref);
      return current;
    }
    const children: LayoutNode[] = [];
    const sizes: number[] = [];
    current.children.forEach((child, index) => {
      const updated = walk(child);
      if (updated) {
        children.push(updated);
        sizes.push(current.sizes[index] ?? 1);
      }
    });
    if (children.length === 0) {
      return null;
    }
    if (children.length === 1) {
      return children[0];
    }
    return { ...current, children, sizes };
  };
  return walk(node) ?? defaultLayout();
}

export function removeLeaf(node: LayoutNode, ref: PanelRef): LayoutNode | null {
  if (node.kind === "leaf") {
    return node.ref === ref ? null : node;
  }
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, index) => {
    const updated = removeLeaf(child, ref);
    if (updated !== null) {
      children.push(updated);
      sizes.push(node.sizes[index] ?? 1);
    }
  });
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0];
  }
  return { ...node, children, sizes };
}

export function insertLeaf(
  node: LayoutNode,
  targetRef: PanelRef,
  edge: DropEdge,
  newLeaf: LayoutNode,
): LayoutNode {
  const direction: SplitDirection = edge === "left" || edge === "right" ? "row" : "column";
  const before = edge === "left" || edge === "top";

  if (node.kind === "leaf") {
    if (node.ref !== targetRef) {
      return node;
    }
    const children = before ? [newLeaf, node] : [node, newLeaf];
    return { kind: "split", direction, children, sizes: [1, 1] };
  }

  const targetIndex = node.children.findIndex(
    (child) => child.kind === "leaf" && child.ref === targetRef,
  );
  if (targetIndex >= 0) {
    if (direction === node.direction) {
      const insertAt = before ? targetIndex : targetIndex + 1;
      const newChildren = [...node.children];
      newChildren.splice(insertAt, 0, newLeaf);
      const half = (node.sizes[targetIndex] ?? 1) / 2;
      const newSizes = [...node.sizes];
      newSizes[targetIndex] = half;
      newSizes.splice(insertAt, 0, half);
      return { ...node, children: newChildren, sizes: newSizes };
    }
    const targetLeaf = node.children[targetIndex];
    const subChildren = before ? [newLeaf, targetLeaf] : [targetLeaf, newLeaf];
    const subSplit: LayoutNode = {
      kind: "split",
      direction,
      children: subChildren,
      sizes: [1, 1],
    };
    const newChildren = [...node.children];
    newChildren[targetIndex] = subSplit;
    return { ...node, children: newChildren };
  }

  return {
    ...node,
    children: node.children.map((child) => insertLeaf(child, targetRef, edge, newLeaf)),
  };
}

export function moveLeaf(
  layout: LayoutNode,
  sourceRef: PanelRef,
  targetRef: PanelRef,
  edge: DropEdge,
): LayoutNode {
  if (sourceRef === targetRef) {
    return layout;
  }
  const removed = removeLeaf(layout, sourceRef);
  if (!removed) {
    return layout;
  }
  return insertLeaf(removed, targetRef, edge, { kind: "leaf", ref: sourceRef });
}

export function updateSplitSizes(
  node: LayoutNode,
  splitId: string,
  sizes: number[],
): LayoutNode {
  if (node.kind === "leaf") {
    return node;
  }
  if (splitIdOf(node) === splitId) {
    return { ...node, sizes };
  }
  return {
    ...node,
    children: node.children.map((child) => updateSplitSizes(child, splitId, sizes)),
  };
}

export function splitIdOf(node: LayoutNode): string {
  if (node.kind === "leaf") {
    return `leaf:${node.ref}`;
  }
  const childIds = node.children.map((child) =>
    child.kind === "leaf" ? child.ref : `split[${splitIdOf(child)}]`,
  );
  return `${node.direction}(${childIds.join(",")})`;
}

export function closestEdge(
  pointerX: number,
  pointerY: number,
  width: number,
  height: number,
): DropEdge {
  const distances: Record<DropEdge, number> = {
    top: pointerY,
    bottom: height - pointerY,
    left: pointerX,
    right: width - pointerX,
  };
  let closest: DropEdge = "right";
  let min = Infinity;
  for (const edge of Object.keys(distances) as DropEdge[]) {
    if (distances[edge] < min) {
      min = distances[edge];
      closest = edge;
    }
  }
  return closest;
}
