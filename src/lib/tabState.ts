import { buildLayoutFromLegacy, normalizeLayout } from "./layout";
import type {
  FilePropertyVisibility,
  LayoutNode,
  PanelId,
  PanelRef,
  PanelState,
  SessionData,
  TabState,
  TerminalAppearance,
  TerminalTheme,
} from "./types";
import {
  DEFAULT_FILE_PROPERTY_VISIBILITY,
  DEFAULT_TERMINAL_APPEARANCE,
} from "./types";

let nextId = 1;

export function createTab(path: string): TabState {
  return {
    id: `tab-${Date.now()}-${nextId++}`,
    path,
    selectedPaths: [],
    history: [path],
    historyIndex: 0,
  };
}

export function createPanel(path: string): PanelState {
  const tab = createTab(path);
  return {
    tabs: [tab],
    activeTabId: tab.id,
  };
}

export function activeTab(panel: PanelState): TabState {
  return panel.tabs.find((tab) => tab.id === panel.activeTabId) ?? panel.tabs[0];
}

export function oppositePanel(panel: PanelId): PanelId {
  return panel === "left" ? "right" : "left";
}

export function normalizePanel(panel: PanelState, fallbackPath: string): PanelState {
  const tabs = panel.tabs.length > 0 ? panel.tabs : [createTab(fallbackPath)];
  const activeTabId = tabs.some((tab) => tab.id === panel.activeTabId)
    ? panel.activeTabId
    : tabs[0].id;

  return {
    tabs: tabs.map((tab) => ({
      ...tab,
      selectedPaths: tab.selectedPaths ?? [],
      history: tab.history?.length ? tab.history : [tab.path],
      historyIndex: Math.min(
        Math.max(tab.historyIndex ?? 0, 0),
        Math.max((tab.history?.length ?? 1) - 1, 0),
      ),
    })),
    activeTabId,
  };
}

export function normalizeSession(
  session: Partial<SessionData> & {
    rightPanelVisible?: boolean;
    panelSplit?: number;
    terminalVisible?: boolean;
    terminalHeight?: number;
  },
  fallbackPath: string,
): SessionData {
  const left = normalizePanel(session.left ?? { tabs: [], activeTabId: "" }, fallbackPath);
  const right = normalizePanel(session.right ?? { tabs: [], activeTabId: "" }, fallbackPath);

  const { layout, visibility } = resolveLayoutAndVisibility(session);

  const activePanel = session.activePanel === "right" && visibility.right ? "right" : "left";

  return {
    left,
    right,
    activePanel,
    showHiddenFiles: Boolean(session.showHiddenFiles),
    layout,
    visibility,
    filePropertyVisibility: normalizeFilePropertyVisibility(session.filePropertyVisibility),
    terminalAppearance: normalizeTerminalAppearance(session.terminalAppearance),
    window: session.window ?? null,
  };
}

function normalizeFilePropertyVisibility(
  visibility: Partial<FilePropertyVisibility> | undefined,
): FilePropertyVisibility {
  return {
    ...DEFAULT_FILE_PROPERTY_VISIBILITY,
    ...visibility,
  };
}

function normalizeTerminalAppearance(
  appearance: Partial<TerminalAppearance> | undefined,
): TerminalAppearance {
  const theme: TerminalTheme =
    appearance?.theme === "light" || appearance?.theme === "dark"
      ? appearance.theme
      : DEFAULT_TERMINAL_APPEARANCE.theme;
  const fontSize =
    typeof appearance?.fontSize === "number"
      ? clamp(Math.round(appearance.fontSize), 10, 22)
      : DEFAULT_TERMINAL_APPEARANCE.fontSize;

  return {
    theme,
    fontSize,
  };
}

function resolveLayoutAndVisibility(session: {
  layout?: LayoutNode;
  visibility?: Partial<Record<PanelRef, boolean>>;
  rightPanelVisible?: boolean;
  panelSplit?: number;
  terminalVisible?: boolean;
  terminalHeight?: number;
}): { layout: LayoutNode; visibility: Record<PanelRef, boolean> } {
  if (session.layout) {
    const layout = normalizeLayout(session.layout);
    const visibility: Record<PanelRef, boolean> = {
      left: session.visibility?.left ?? true,
      right: session.visibility?.right ?? true,
      terminal: session.visibility?.terminal ?? false,
      agent: session.visibility?.agent ?? false,
    };
    return { layout, visibility };
  }

  const built = buildLayoutFromLegacy(session);
  return { layout: normalizeLayout(built.layout), visibility: built.visibility };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function navigateTab(tab: TabState, path: string): TabState {
  const nextHistory = tab.history.slice(0, tab.historyIndex + 1);
  nextHistory.push(path);
  return {
    ...tab,
    path,
    selectedPaths: [],
    history: nextHistory,
    historyIndex: nextHistory.length - 1,
  };
}

export function navigateTabBack(tab: TabState): TabState {
  if (tab.historyIndex <= 0) {
    return tab;
  }

  const historyIndex = tab.historyIndex - 1;
  return {
    ...tab,
    path: tab.history[historyIndex],
    selectedPaths: [],
    historyIndex,
  };
}

export function navigateTabForward(tab: TabState): TabState {
  if (tab.historyIndex >= tab.history.length - 1) {
    return tab;
  }

  const historyIndex = tab.historyIndex + 1;
  return {
    ...tab,
    path: tab.history[historyIndex],
    selectedPaths: [],
    historyIndex,
  };
}

export function replaceTabPath(tab: TabState, path: string): TabState {
  const nextHistory = [...tab.history];
  nextHistory[tab.historyIndex] = path;
  return {
    ...tab,
    path,
    selectedPaths: [],
    history: nextHistory,
  };
}
