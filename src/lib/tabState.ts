import type { PanelId, PanelState, SessionData, TabState } from "./types";

let nextId = 1;

export const DEFAULT_TERMINAL_HEIGHT = 240;
export const MIN_TERMINAL_HEIGHT = 168;
export const MAX_TERMINAL_HEIGHT = 520;
export const DEFAULT_PANEL_SPLIT = 0.5;
export const MIN_PANEL_SPLIT = 0.24;
export const MAX_PANEL_SPLIT = 0.76;

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

export function normalizeSession(session: SessionData, fallbackPath: string): SessionData {
  const rightPanelVisible = session.rightPanelVisible !== false;

  return {
    left: normalizePanel(session.left, fallbackPath),
    right: normalizePanel(session.right, fallbackPath),
    activePanel:
      rightPanelVisible && session.activePanel === "right" ? "right" : "left",
    rightPanelVisible,
    panelSplit: clampPanelSplit(session.panelSplit),
    terminalVisible: Boolean(session.terminalVisible),
    terminalHeight: clampTerminalHeight(session.terminalHeight),
    showHiddenFiles: Boolean(session.showHiddenFiles),
    window: session.window ?? null,
  };
}

export function clampTerminalHeight(
  height: unknown,
  maximum = MAX_TERMINAL_HEIGHT,
): number {
  if (typeof height !== "number" || !Number.isFinite(height)) {
    return DEFAULT_TERMINAL_HEIGHT;
  }

  const maxHeight = Math.max(
    MIN_TERMINAL_HEIGHT,
    Math.min(Math.round(maximum), MAX_TERMINAL_HEIGHT),
  );
  return Math.min(Math.max(Math.round(height), MIN_TERMINAL_HEIGHT), maxHeight);
}

export function clampPanelSplit(
  split: unknown,
  minimum = MIN_PANEL_SPLIT,
  maximum = MAX_PANEL_SPLIT,
): number {
  if (typeof split !== "number" || !Number.isFinite(split)) {
    return DEFAULT_PANEL_SPLIT;
  }

  const min = Math.max(0.05, Math.min(minimum, 0.5));
  const max = Math.min(0.95, Math.max(maximum, 0.5));
  return Math.min(Math.max(split, min), max);
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
