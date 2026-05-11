import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  closestEdge,
  collectPanelRefs,
  moveLeaf,
  splitIdOf,
  updateSplitSizes,
  type DropEdge,
} from "../lib/layout";
import type { LayoutChangeDetails, LayoutNode, PanelRef } from "../lib/types";

const MIN_LEAF_FRACTION = 0.08;

export interface LayoutDragHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  isDragging: boolean;
}

interface LayoutProps {
  layout: LayoutNode;
  visibility: Record<PanelRef, boolean>;
  onLayoutChange: (next: LayoutNode, details?: LayoutChangeDetails) => void;
  renderPanel: (ref: PanelRef, dragHandlers: LayoutDragHandlers) => ReactNode;
}

export function Layout({
  layout,
  visibility,
  onLayoutChange,
  renderPanel,
}: LayoutProps) {
  const [dragRef, setDragRef] = useState<PanelRef | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    ref: PanelRef;
    edge: DropEdge;
  } | null>(null);
  const dropTargetRef = useRef<typeof dropTarget>(null);

  useEffect(() => {
    dropTargetRef.current = dropTarget;
  }, [dropTarget]);

  const visibleRefs = useMemo(() => {
    const allRefs = collectPanelRefs(layout);
    const visible: PanelRef[] = [];
    allRefs.forEach((ref) => {
      if (visibility[ref]) {
        visible.push(ref);
      }
    });
    return visible;
  }, [layout, visibility]);

  const startDrag = useCallback(
    (ref: PanelRef) => {
      if (visibleRefs.length <= 1) {
        return;
      }
      setDragRef(ref);
      setDropTarget(null);
      document.body.classList.add("layout-dragging");
    },
    [visibleRefs.length],
  );

  useEffect(() => {
    if (!dragRef) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const candidate = findPanelRefAt(event.clientX, event.clientY);
      if (!candidate || candidate.ref === dragRef) {
        setDropTarget(null);
        return;
      }
      const bounds = candidate.element.getBoundingClientRect();
      const edge = closestEdge(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        bounds.width,
        bounds.height,
      );
      setDropTarget({ ref: candidate.ref, edge });
    };

    const onPointerUp = () => {
      const target = dropTargetRef.current;
      if (target) {
        onLayoutChange(moveLeaf(layout, dragRef, target.ref, target.edge), {
          reason: "drag",
          sourceRef: dragRef,
          targetRef: target.ref,
          edge: target.edge,
        });
      }
      setDragRef(null);
      setDropTarget(null);
      document.body.classList.remove("layout-dragging");
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.classList.remove("layout-dragging");
    };
  }, [dragRef, layout, onLayoutChange]);

  const onSplitResize = useCallback(
    (splitId: string, sizes: number[], details: LayoutChangeDetails) => {
      onLayoutChange(updateSplitSizes(layout, splitId, sizes), details);
    },
    [layout, onLayoutChange],
  );

  return (
    <LayoutNodeView
      node={layout}
      visibility={visibility}
      dragRef={dragRef}
      dropTarget={dropTarget}
      onStartDrag={startDrag}
      onSplitResize={onSplitResize}
      renderPanel={renderPanel}
    />
  );
}

interface LayoutNodeViewProps {
  node: LayoutNode;
  visibility: Record<PanelRef, boolean>;
  dragRef: PanelRef | null;
  dropTarget: { ref: PanelRef; edge: DropEdge } | null;
  onStartDrag: (ref: PanelRef) => void;
  onSplitResize: (
    splitId: string,
    sizes: number[],
    details: LayoutChangeDetails,
  ) => void;
  renderPanel: (ref: PanelRef, dragHandlers: LayoutDragHandlers) => ReactNode;
}

function LayoutNodeView(props: LayoutNodeViewProps) {
  const { node } = props;

  if (node.kind === "leaf") {
    return <LeafView leaf={node} {...props} />;
  }

  return <SplitView split={node} {...props} />;
}

interface LeafViewProps extends LayoutNodeViewProps {
  leaf: { kind: "leaf"; ref: PanelRef };
}

function LeafView({
  leaf,
  visibility,
  dragRef,
  dropTarget,
  onStartDrag,
  renderPanel,
}: LeafViewProps) {
  const visible = visibility[leaf.ref];
  if (!visible) {
    return null;
  }

  const handlers: LayoutDragHandlers = {
    onPointerDown: (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      onStartDrag(leaf.ref);
    },
    isDragging: dragRef === leaf.ref,
  };

  const showDropIndicator =
    dragRef !== null &&
    dragRef !== leaf.ref &&
    dropTarget?.ref === leaf.ref;

  return (
    <div
      className={`layout-leaf ${dragRef === leaf.ref ? "layout-leaf-dragging" : ""}`}
      data-panel-ref={leaf.ref}
    >
      {renderPanel(leaf.ref, handlers)}
      {showDropIndicator ? <DropIndicator edge={dropTarget!.edge} /> : null}
    </div>
  );
}

interface SplitViewProps extends LayoutNodeViewProps {
  split: Extract<LayoutNode, { kind: "split" }>;
}

function SplitView({
  split,
  visibility,
  dragRef,
  dropTarget,
  onStartDrag,
  onSplitResize,
  renderPanel,
}: SplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visibleIndices = useMemo(
    () =>
      split.children
        .map((child, index) => ({ child, index }))
        .filter(({ child }) => isAnyDescendantVisible(child, visibility)),
    [split.children, visibility],
  );

  if (visibleIndices.length === 0) {
    return null;
  }

  if (visibleIndices.length === 1) {
    return (
      <LayoutNodeView
        node={visibleIndices[0].child}
        visibility={visibility}
        dragRef={dragRef}
        dropTarget={dropTarget}
        onStartDrag={onStartDrag}
        onSplitResize={onSplitResize}
        renderPanel={renderPanel}
      />
    );
  }

  const splitId = splitIdOf(split);

  const startResize = (handleAt: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const bounds = container.getBoundingClientRect();
    const isRow = split.direction === "row";
    const totalSize = isRow ? bounds.width : bounds.height;
    if (totalSize <= 0) {
      return;
    }

    const sizes = [...split.sizes];
    const sumOriginal = sumSizes(sizes);
    const beforeIndex = visibleIndices[handleAt].index;
    const afterIndex = visibleIndices[handleAt + 1].index;
    const combinedFraction =
      (sizes[beforeIndex] + sizes[afterIndex]) / sumOriginal;
    const startCombinedPx = combinedFraction * totalSize;
    const startBeforeFraction = sizes[beforeIndex] / sumOriginal;
    const startBeforePx = startBeforeFraction * totalSize;
    const handleStartCoord = isRow ? event.clientX : event.clientY;
    let latestSizes: number[] | null = null;

    document.body.classList.add("layout-resizing");

    const onMove = (moveEvent: PointerEvent) => {
      const coord = isRow ? moveEvent.clientX : moveEvent.clientY;
      const deltaPx = coord - handleStartCoord;
      let nextBeforePx = startBeforePx + deltaPx;
      const minPx = MIN_LEAF_FRACTION * totalSize;
      const maxPx = startCombinedPx - minPx;
      nextBeforePx = Math.min(Math.max(nextBeforePx, minPx), maxPx);
      const nextAfterPx = startCombinedPx - nextBeforePx;

      const nextBeforeFraction = (nextBeforePx / totalSize) * sumOriginal;
      const nextAfterFraction = (nextAfterPx / totalSize) * sumOriginal;
      const newSizes = [...sizes];
      newSizes[beforeIndex] = nextBeforeFraction;
      newSizes[afterIndex] = nextAfterFraction;
      latestSizes = newSizes;
      onSplitResize(splitId, newSizes, { reason: "resize", log: false });
    };

    const onUp = () => {
      if (latestSizes) {
        onSplitResize(splitId, latestSizes, {
          reason: "resize",
          splitId,
          direction: split.direction,
          beforeIndex,
          afterIndex,
          sizes: latestSizes.map(roundLayoutSize),
        });
      }
      document.body.classList.remove("layout-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const containerStyle: CSSProperties = {
    flexDirection: split.direction === "row" ? "row" : "column",
  };

  const elements: ReactNode[] = [];
  visibleIndices.forEach(({ child, index }, slotIndex) => {
    const flexGrow = Math.max(split.sizes[index] ?? 1, 0.01);
    elements.push(
      <div
        className="layout-slot"
        key={`slot-${index}`}
        style={{ flex: `${flexGrow} ${flexGrow} 0` }}
      >
        <LayoutNodeView
          node={child}
          visibility={visibility}
          dragRef={dragRef}
          dropTarget={dropTarget}
          onStartDrag={onStartDrag}
          onSplitResize={onSplitResize}
          renderPanel={renderPanel}
        />
      </div>,
    );

    if (slotIndex < visibleIndices.length - 1) {
      elements.push(
        <div
          aria-orientation={split.direction === "row" ? "vertical" : "horizontal"}
          className={`layout-resize-handle layout-resize-${split.direction}`}
          key={`handle-${slotIndex}`}
          onPointerDown={startResize(slotIndex)}
          role="separator"
          tabIndex={0}
        />,
      );
    }
  });

  return (
    <div
      className={`layout-split layout-split-${split.direction}`}
      ref={containerRef}
      style={containerStyle}
    >
      {elements}
    </div>
  );
}

function DropIndicator({ edge }: { edge: DropEdge }) {
  return <div className={`drop-indicator drop-indicator-${edge}`} />;
}

function findPanelRefAt(
  clientX: number,
  clientY: number,
): { ref: PanelRef; element: HTMLElement } | null {
  const initial = document.elementFromPoint(clientX, clientY);
  if (!(initial instanceof HTMLElement)) {
    return null;
  }
  const target = initial.closest<HTMLElement>("[data-panel-ref]");
  if (!target) {
    return null;
  }
  const ref = target.getAttribute("data-panel-ref") as PanelRef | null;
  if (!ref) {
    return null;
  }
  return { ref, element: target };
}

function isAnyDescendantVisible(
  node: LayoutNode,
  visibility: Record<PanelRef, boolean>,
): boolean {
  if (node.kind === "leaf") {
    return Boolean(visibility[node.ref]);
  }
  return node.children.some((child) => isAnyDescendantVisible(child, visibility));
}

function sumSizes(sizes: number[]): number {
  const sum = sizes.reduce((total, value) => total + value, 0);
  return sum > 0 ? sum : sizes.length;
}

function roundLayoutSize(size: number): number {
  return Math.round(size * 1000) / 1000;
}
