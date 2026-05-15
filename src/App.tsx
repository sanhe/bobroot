import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { flushSync } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  Bot,
  Copy,
  Eye,
  EyeOff,
  FolderPlus,
  FolderSync,
  MoveRight,
  Music2,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Terminal as TerminalIcon,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  copyItems,
  createFolder,
  getHomeDir,
  listDirectory,
  loadSession,
  logAction,
  moveItems,
  moveToTrash,
  openPath,
  openPathWithPlayer,
  permanentlyDelete,
  previewPath,
  revealPath,
  renameItem,
  saveSession,
  watchDirectories,
} from "./lib/api";
import { basename } from "./lib/format";
import {
  activeTab,
  createPanel,
  createTab,
  navigateTab,
  navigateTabBack,
  navigateTabForward,
  normalizeSession,
  oppositePanel,
} from "./lib/tabState";
import { defaultLayout } from "./lib/layout";
import {
  currentPlatform,
  copyPathShortcut,
  hiddenFilesShortcut,
  newFolderShortcut,
  permanentDeleteShortcut,
  revealActionLabel,
  syncPanelShortcut,
  terminalShortcut,
  trashShortcut,
  trashTargetName,
} from "./lib/platform";
import type {
  ActionLogDetails,
  AudioPlaybackMode,
  AudioPlaybackSettings,
  ConflictStrategy,
  DirectoryListing,
  FileEntry,
  FilePropertyKey,
  FormatFilter,
  FormatFilterOption,
  LayoutChangeDetails,
  LayoutNode,
  PanelId,
  PanelRef,
  PanelState,
  SessionData,
  TabState,
  TerminalAppearance,
} from "./lib/types";
import {
  DEFAULT_AUDIO_PLAYBACK_SETTINGS,
  DEFAULT_FILE_PROPERTY_VISIBILITY,
  DEFAULT_TERMINAL_APPEARANCE,
} from "./lib/types";
import { readWindowSession, restoreWindowSession } from "./lib/windowSession";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { ConfirmationDialog } from "./components/ConfirmationDialog";
import { AgentPanel } from "./components/AgentPanel";
import { FilePanel } from "./components/FilePanel";
import { IconButton } from "./components/IconButton";
import { Layout, type LayoutDragHandlers } from "./components/Layout";
import { PathPrompt } from "./components/PathPrompt";
import { TerminalPanel, type TerminalCloseScope } from "./components/TerminalPanel";

type ListingMap = Record<string, DirectoryListing | null>;
type LoadingMap = Record<string, boolean>;

interface ContextMenuState {
  panelId: PanelId;
  entry: FileEntry;
  x: number;
  y: number;
}

interface RenameState {
  panelId: PanelId;
  path: string;
  name: string;
}

interface ConfirmationState {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
}

interface ConflictStrategyRequest {
  mode: "copy" | "move";
}

interface AudioPreviewState {
  name: string;
  path: string;
  src: string;
}

interface DirectoryChangedPayload {
  path: string;
}

const DEFAULT_FORMAT_FILTER: FormatFilter = "all";

function App() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [listings, setListings] = useState<ListingMap>({});
  const [formatFilters, setFormatFilters] = useState<Record<string, FormatFilter>>({});
  const [loading, setLoading] = useState<LoadingMap>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [conflictRequest, setConflictRequest] = useState<ConflictStrategyRequest | null>(null);
  const [audioPreview, setAudioPreview] = useState<AudioPreviewState | null>(null);
  const [pathPrompt, setPathPrompt] = useState<{
    initialValue: string;
    panelId: PanelId;
  } | null>(null);
  const [terminalCwd, setTerminalCwd] = useState<string | null>(null);
  const [terminalLiveSessionCount, setTerminalLiveSessionCount] = useState(0);
  const saveTimer = useRef<number | null>(null);
  const refreshPanelRef = useRef<((panelId: PanelId) => Promise<void>) | null>(null);
  const refreshTimers = useRef<Record<PanelId, number | null>>({ left: null, right: null });
  const latestSession = useRef<SessionData | null>(null);
  const latestListings = useRef<ListingMap>({});
  const confirmationResolver = useRef<((confirmed: boolean) => void) | null>(null);
  const conflictResolver = useRef<((strategy: ConflictStrategy | null) => void) | null>(null);

  const platform = useMemo(() => currentPlatform(), []);
  const hiddenShortcut = useMemo(() => hiddenFilesShortcut(platform), [platform]);
  const copyPathKey = useMemo(() => copyPathShortcut(platform), [platform]);
  const folderShortcut = useMemo(() => newFolderShortcut(platform), [platform]);
  const syncShortcut = useMemo(() => syncPanelShortcut(platform), [platform]);
  const terminalKey = useMemo(() => terminalShortcut(platform), [platform]);
  const trashKey = useMemo(() => trashShortcut(platform), [platform]);
  const trashName = useMemo(() => trashTargetName(platform), [platform]);
  const permanentShortcut = useMemo(() => permanentDeleteShortcut(platform), [platform]);
  const revealLabel = useMemo(() => revealActionLabel(platform), [platform]);
  const activePanelId = session?.activePanel ?? "left";
  const rightPanelVisible = session?.visibility.right ?? true;
  const terminalVisible = session?.visibility.terminal ?? false;
  const agentVisible = session?.visibility.agent ?? false;
  const showHiddenFiles = session?.showHiddenFiles ?? false;
  const filePropertyVisibility =
    session?.filePropertyVisibility ?? DEFAULT_FILE_PROPERTY_VISIBILITY;
  const terminalAppearance =
    session?.terminalAppearance ?? DEFAULT_TERMINAL_APPEARANCE;
  const audioPlaybackSettings =
    session?.audioPlayback ?? DEFAULT_AUDIO_PLAYBACK_SETTINGS;

  const reportNotice = useCallback((message: string | null) => {
    setNotice(message);
  }, []);

  const recordAction = useCallback(
    (action: string, details: ActionLogDetails = {}) => {
      void logAction(action, details).catch(() => undefined);
    },
    [],
  );

  const getDisplayListing = useCallback(
    (tab: TabState): DirectoryListing | null =>
      filterListingByFormat(
        listings[tab.id] ?? null,
        formatFilters[tab.id] ?? DEFAULT_FORMAT_FILTER,
      ),
    [formatFilters, listings],
  );

  const requestConfirmation = useCallback((nextConfirmation: ConfirmationState) => {
    confirmationResolver.current?.(false);
    setConfirmation(nextConfirmation);

    return new Promise<boolean>((resolve) => {
      confirmationResolver.current = resolve;
    });
  }, []);

  const resolveConfirmation = useCallback((confirmed: boolean) => {
    const resolver = confirmationResolver.current;
    confirmationResolver.current = null;
    setConfirmation(null);
    resolver?.(confirmed);
  }, []);

  const requestConflictStrategy = useCallback((mode: "copy" | "move") => {
    conflictResolver.current?.(null);
    setConflictRequest({ mode });

    return new Promise<ConflictStrategy | null>((resolve) => {
      conflictResolver.current = resolve;
    });
  }, []);

  const resolveConflictStrategy = useCallback((strategy: ConflictStrategy | null) => {
    const resolver = conflictResolver.current;
    conflictResolver.current = null;
    setConflictRequest(null);
    resolver?.(strategy);
  }, []);

  useEffect(
    () => () => {
      confirmationResolver.current?.(false);
      confirmationResolver.current = null;
      conflictResolver.current?.(null);
      conflictResolver.current = null;
    },
    [],
  );

  const loadTab = useCallback(
    async (panelId: PanelId, tab: TabState, force = false) => {
      const cachedListing = listings[tab.id];
      if (
        !force &&
        cachedListing?.path === tab.path &&
        cachedListing.showHiddenFiles === showHiddenFiles
      ) {
        return;
      }

      setLoading((previous) => ({ ...previous, [tab.id]: true }));

      try {
        const listing = await listDirectory(tab.path, showHiddenFiles);
        setListings((previous) => ({ ...previous, [tab.id]: listing }));
        setSession((previous) =>
          previous
            ? updateTab(previous, panelId, tab.id, (current) =>
                current.path === listing.path
                  ? current
                  : { ...current, path: listing.path, history: replaceHistoryPath(current, listing.path) },
              )
            : previous,
        );
        reportNotice(null);
      } catch (error) {
        reportNotice(errorToMessage(error));
      } finally {
        setLoading((previous) => ({ ...previous, [tab.id]: false }));
      }
    },
    [listings, reportNotice, showHiddenFiles],
  );

  const refreshPanel = useCallback(
    async (panelId: PanelId) => {
      if (!session) {
        return;
      }
      const tab = activeTab(session[panelId]);
      await loadTab(panelId, tab, true);
    },
    [loadTab, session],
  );

  const refreshVisiblePanels = useCallback(async () => {
    if (!session) {
      return;
    }

    await Promise.all([refreshPanel("left"), refreshPanel("right")]);
  }, [refreshPanel, session]);

  latestSession.current = session;
  latestListings.current = listings;
  refreshPanelRef.current = refreshPanel;

  const watchedDirectoryKey = useMemo(
    () => (session ? visiblePanelDirectories(session).join("\n") : ""),
    [session],
  );

  useEffect(() => {
    const paths = watchedDirectoryKey ? watchedDirectoryKey.split("\n") : [];
    void watchDirectories(paths).catch((error) => {
      reportNotice(errorToMessage(error));
    });
  }, [reportNotice, watchedDirectoryKey]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    void listen<DirectoryChangedPayload>("directory-changed", (event) => {
      const changedPath = normalizeDirectoryPath(event.payload.path);
      const currentSession = latestSession.current;
      if (!currentSession) {
        return;
      }

      (["left", "right"] as PanelId[]).forEach((panelId) => {
        if (panelId === "right" && !currentSession.visibility.right) {
          return;
        }

        const tab = activeTab(currentSession[panelId]);
        const panelPath = normalizeDirectoryPath(
          latestListings.current[tab.id]?.path ?? tab.path,
        );
        if (panelPath !== changedPath) {
          return;
        }

        const existingTimer = refreshTimers.current[panelId];
        if (existingTimer !== null) {
          window.clearTimeout(existingTimer);
        }

        refreshTimers.current[panelId] = window.setTimeout(() => {
          refreshTimers.current[panelId] = null;
          void refreshPanelRef.current?.(panelId);
        }, 150);
      });
    }).then((dispose) => {
      if (cancelled) {
        dispose();
      } else {
        unlisten = dispose;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
      (["left", "right"] as PanelId[]).forEach((panelId) => {
        const timer = refreshTimers.current[panelId];
        if (timer !== null) {
          window.clearTimeout(timer);
          refreshTimers.current[panelId] = null;
        }
      });
      void watchDirectories([]).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const home = await getHomeDir();
        const saved = await loadSession();
        if (cancelled) {
          return;
        }

        const initialSession: SessionData = saved
          ? normalizeSession(saved, home)
          : {
              left: createPanel(home),
              right: createPanel(home),
              activePanel: "left",
              showHiddenFiles: false,
              layout: defaultLayout(),
              visibility: { left: true, right: true, terminal: false, agent: false },
              filePropertyVisibility: { ...DEFAULT_FILE_PROPERTY_VISIBILITY },
              terminalAppearance: { ...DEFAULT_TERMINAL_APPEARANCE },
              audioPlayback: { ...DEFAULT_AUDIO_PLAYBACK_SETTINGS },
              window: null,
            };

        setSession(initialSession);
        setStartupError(null);
        setTerminalCwd(activeTab(initialSession[initialSession.activePanel]).path);
        await restoreWindowSession(initialSession.window);
      } catch (error) {
        setStartupError(errorToMessage(error));
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [reportNotice]);

  const leftActiveTab = session ? activeTab(session.left) : null;
  const rightActiveTab = session ? activeTab(session.right) : null;
  const rightPanelVisibleForLoad = session?.visibility.right ?? false;
  const leftActiveTabId = leftActiveTab?.id ?? null;
  const leftActiveTabPath = leftActiveTab?.path ?? null;
  const rightActiveTabId = rightActiveTab?.id ?? null;
  const rightActiveTabPath = rightActiveTab?.path ?? null;

  useEffect(() => {
    if (leftActiveTab) {
      void loadTab("left", leftActiveTab);
    }
    if (rightPanelVisibleForLoad && rightActiveTab) {
      void loadTab("right", rightActiveTab);
    }
  }, [
    loadTab,
    rightPanelVisibleForLoad,
    leftActiveTabId,
    leftActiveTabPath,
    rightActiveTabId,
    rightActiveTabPath,
  ]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const validIds = new Set<string>([
      ...session.left.tabs.map((tab) => tab.id),
      ...session.right.tabs.map((tab) => tab.id),
    ]);

    setListings((current) => pruneByKey(current, validIds));
    setLoading((current) => pruneByKey(current, validIds));
    setFormatFilters((current) => pruneByKey(current, validIds));
  }, [session?.left.tabs, session?.right.tabs]);

  const persistSession = useCallback(
    async (current: SessionData) => {
      const windowSession = await readWindowSession();
      await saveSession({ ...current, window: windowSession });
    },
    [],
  );

  useEffect(() => {
    if (!session) {
      return;
    }

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }

    saveTimer.current = window.setTimeout(() => {
      void persistSession(session).catch(() => undefined);
    }, 400);

    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [persistSession, session]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (session) {
        void persistSession(session).catch(() => undefined);
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [persistSession, session]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeContextMenu = () => setContextMenu(null);
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("keydown", closeContextMenu);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("keydown", closeContextMenu);
    };
  }, [contextMenu]);

  const setActivePanel = useCallback((panelId: PanelId) => {
    recordAction("activate_panel", { panelId });
    setSession((previous) =>
      previous && (panelId === "left" || previous.visibility.right)
        ? { ...previous, activePanel: panelId }
        : previous,
    );
  }, [recordAction]);

  const switchPanel = useCallback(() => {
    recordAction("switch_panel");
    setSession((previous) =>
      previous
        ? {
            ...previous,
            activePanel: previous.visibility.right
              ? oppositePanel(previous.activePanel)
              : "left",
          }
        : previous,
    );
  }, [recordAction]);

  const switchTab = useCallback((panelId: PanelId, tabId: string) => {
    recordAction("switch_tab", { panelId, tabId });
    setSession((previous) =>
      previous
        ? {
            ...previous,
            activePanel: panelId,
            [panelId]: { ...previous[panelId], activeTabId: tabId },
          }
        : previous,
    );
  }, [recordAction]);

  const newTab = useCallback((panelId = activePanelId) => {
    recordAction("new_tab", { panelId });
    setSession((previous) => {
      if (!previous) {
        return previous;
      }

      const baseTab = activeTab(previous[panelId]);
      const tab = createTab(baseTab.path);
      return {
        ...previous,
        activePanel: panelId,
        [panelId]: {
          tabs: [...previous[panelId].tabs, tab],
          activeTabId: tab.id,
        },
      };
    });
  }, [activePanelId, recordAction]);

  const closeTab = useCallback((panelId = activePanelId, tabId?: string) => {
    recordAction("close_tab", { panelId, tabId: tabId ?? null });
    setSession((previous) => {
      if (!previous) {
        return previous;
      }

      const panel = previous[panelId];
      if (panel.tabs.length <= 1) {
        return previous;
      }

      const closingTabId = tabId ?? panel.activeTabId;
      const closingIndex = panel.tabs.findIndex((tab) => tab.id === closingTabId);
      const tabs = panel.tabs.filter((tab) => tab.id !== closingTabId);
      const nextActive =
        closingTabId === panel.activeTabId
          ? tabs[Math.max(0, closingIndex - 1)].id
          : panel.activeTabId;

      return {
        ...previous,
        activePanel: panelId,
        [panelId]: { tabs, activeTabId: nextActive },
      };
    });
  }, [activePanelId, recordAction]);

  const toggleRightPanel = useCallback(() => {
    recordAction("toggle_right_panel", { visible: !rightPanelVisible });
    setContextMenu(null);
    setRenameState(null);
    setSession((previous) => {
      if (!previous) {
        return previous;
      }

      const nextVisible = !previous.visibility.right;
      return {
        ...previous,
        activePanel: nextVisible ? previous.activePanel : "left",
        visibility: { ...previous.visibility, right: nextVisible },
      };
    });
  }, [recordAction, rightPanelVisible]);

  const confirmTerminalClose = useCallback(
    (scope: TerminalCloseScope, runningCount: number) => {
      const sessionLabel = runningCount === 1 ? "session" : "sessions";
      const target = scope === "panel" ? "the terminal" : "this terminal tab";

      return requestConfirmation({
        title: scope === "panel" ? "Close terminal" : "Close terminal tab",
        message: `Close ${target} and stop ${runningCount} live terminal ${sessionLabel}?`,
        confirmLabel: "Close",
        destructive: true,
      });
    },
    [requestConfirmation],
  );

  const toggleTerminal = useCallback(async () => {
    if (!session) {
      return;
    }

    const nextVisible = !session.visibility.terminal;
    if (!nextVisible && terminalLiveSessionCount > 0) {
      const confirmed = await confirmTerminalClose("panel", terminalLiveSessionCount);
      if (!confirmed) {
        recordAction("close_terminal_cancelled", {
          runningCount: terminalLiveSessionCount,
        });
        return;
      }
    }

    recordAction("toggle_terminal", { visible: nextVisible });
    setContextMenu(null);
    setRenameState(null);
    if (nextVisible) {
      setTerminalCwd(activeTab(session[session.activePanel]).path);
      setTerminalLiveSessionCount(1);
    } else {
      setTerminalLiveSessionCount(0);
    }
    setSession((previous) =>
      previous
        ? {
            ...previous,
            visibility: { ...previous.visibility, terminal: nextVisible },
          }
        : previous,
    );
  }, [confirmTerminalClose, recordAction, session, terminalLiveSessionCount]);

  const closeTerminal = useCallback(() => {
    recordAction("close_terminal");
    setTerminalLiveSessionCount(0);
    setSession((previous) =>
      previous
        ? {
            ...previous,
            visibility: { ...previous.visibility, terminal: false },
          }
        : previous,
    );
  }, [recordAction]);

  const toggleAgent = useCallback(() => {
    recordAction("toggle_agent_panel", { visible: !agentVisible });
    setContextMenu(null);
    setRenameState(null);
    setSession((previous) =>
      previous
        ? {
            ...previous,
            visibility: { ...previous.visibility, agent: !previous.visibility.agent },
          }
        : previous,
    );
  }, [agentVisible, recordAction]);

  const closeAgent = useCallback(() => {
    recordAction("close_agent_panel");
    setSession((previous) =>
      previous
        ? {
            ...previous,
            visibility: { ...previous.visibility, agent: false },
          }
        : previous,
    );
  }, [recordAction]);

  const setLayout = useCallback(
    (next: LayoutNode, details?: LayoutChangeDetails) => {
      const { log = true, ...logDetails } = details ?? { reason: "programmatic" };
      if (log) {
        recordAction("update_layout", logDetails);
      }
      setSession((previous) =>
        previous ? { ...previous, layout: next } : previous,
      );
    },
    [recordAction],
  );

  const navigateTo = useCallback((panelId: PanelId, path: string) => {
    recordAction("navigate", { panelId, path });
    setSession((previous) =>
      previous
        ? updateActiveTab(previous, panelId, (tab) => navigateTab(tab, path))
        : previous,
    );
  }, [recordAction]);

  const goBack = useCallback((panelId = activePanelId) => {
    recordAction("navigate_history", { panelId, direction: "back" });
    setSession((previous) =>
      previous
        ? updateActiveTab(previous, panelId, navigateTabBack)
        : previous,
    );
  }, [activePanelId, recordAction]);

  const goForward = useCallback((panelId = activePanelId) => {
    recordAction("navigate_history", { panelId, direction: "forward" });
    setSession((previous) =>
      previous
        ? updateActiveTab(previous, panelId, navigateTabForward)
        : previous,
    );
  }, [activePanelId, recordAction]);

  const openPathPrompt = useCallback(() => {
    if (!session) {
      return;
    }
    const panelId = session.activePanel;
    const tab = activeTab(session[panelId]);
    const separator = tab.path.includes("\\") && !tab.path.includes("/") ? "\\" : "/";
    const initialValue =
      tab.path.endsWith("/") || tab.path.endsWith("\\")
        ? tab.path
        : tab.path + separator;
    recordAction("open_path_prompt", { panelId });
    setPathPrompt({ initialValue, panelId });
  }, [recordAction, session]);

  const closePathPrompt = useCallback(() => {
    setPathPrompt(null);
  }, []);

  const navigateFromPathPrompt = useCallback(
    (path: string) => {
      if (!pathPrompt) {
        return;
      }
      const target = path.trim();
      setPathPrompt(null);
      if (!target) {
        return;
      }
      navigateTo(pathPrompt.panelId, target);
    },
    [navigateTo, pathPrompt],
  );

  const goParent = useCallback((panelId = activePanelId) => {
    recordAction("go_parent", { panelId });
    if (!session) {
      return;
    }

    const tab = activeTab(session[panelId]);
    const listing = listings[tab.id];
    if (listing?.parent) {
      navigateTo(panelId, listing.parent);
    }
  }, [activePanelId, listings, navigateTo, recordAction, session]);

  const syncActivePanelToOpposite = useCallback(() => {
    if (!session) {
      return;
    }

    if (!session.visibility.right) {
      reportNotice("Show the right panel to match folders between panels.");
      return;
    }

    const panelId = oppositePanel(session.activePanel);
    const sourcePanelId = session.activePanel;
    recordAction("sync_active_panel_to_opposite", { panelId, sourcePanelId });

    const currentTab = activeTab(session[panelId]);
    const sourceTab = activeTab(session[sourcePanelId]);

    if (currentTab.path !== sourceTab.path) {
      navigateTo(panelId, sourceTab.path);
    }
  }, [navigateTo, recordAction, reportNotice, session]);

  const selectPath = useCallback(
    (panelId: PanelId, path: string, additive: boolean) => {
      recordAction("select_item", { panelId, path, additive });
      setContextMenu(null);
      setSession((previous) =>
        previous
          ? updateActiveTab(previous, panelId, (tab) => {
              const hasPath = tab.selectedPaths.includes(path);
              const selectedPaths = additive
                ? hasPath
                  ? tab.selectedPaths.filter((selected) => selected !== path)
                  : [path, ...tab.selectedPaths]
                : [path];
              return { ...tab, selectedPaths };
            })
          : previous,
      );
    },
    [recordAction],
  );

  const selectEntryByIndex = useCallback(
    (index: number) => {
      if (!session) {
        return;
      }

      const panelId = session.activePanel;
      const tab = activeTab(session[panelId]);
      const entries = getDisplayListing(tab)?.entries ?? [];
      if (entries.length === 0) {
        return;
      }

      const nextIndex = clamp(index, 0, entries.length - 1);
      const nextPath = entries[nextIndex].path;
      recordAction("select_item_by_index", {
        panelId,
        index: nextIndex,
        path: nextPath,
      });
      setSession((previous) =>
        previous
          ? updateActiveTab(previous, panelId, (current) => ({
              ...current,
              selectedPaths: [nextPath],
            }))
          : previous,
      );
    },
    [getDisplayListing, recordAction, session],
  );

  const typeAheadSelect = useCallback(
    (prefix: string) => {
      if (!session || !prefix) {
        return;
      }
      const panelId = session.activePanel;
      const tab = activeTab(session[panelId]);
      const entries = getDisplayListing(tab)?.entries ?? [];
      if (entries.length === 0) {
        return;
      }
      const lowered = prefix.toLowerCase();
      const index = entries.findIndex((entry) =>
        entry.name.toLowerCase().startsWith(lowered),
      );
      if (index >= 0) {
        selectEntryByIndex(index);
      }
    },
    [getDisplayListing, selectEntryByIndex, session],
  );

  const moveSelection = useCallback(
    (delta: number) => {
      recordAction("move_selection", { delta });
      if (!session) {
        return;
      }

      const panelId = session.activePanel;
      const tab = activeTab(session[panelId]);
      const entries = getDisplayListing(tab)?.entries ?? [];
      if (entries.length === 0) {
        return;
      }

      const currentIndex = entries.findIndex((entry) => entry.path === tab.selectedPaths[0]);
      const fallbackIndex = delta > 0 ? -1 : entries.length;
      selectEntryByIndex((currentIndex >= 0 ? currentIndex : fallbackIndex) + delta);
    },
    [getDisplayListing, recordAction, selectEntryByIndex, session],
  );

  const moveSelectionPage = useCallback(
    (direction: 1 | -1) => {
      recordAction("move_selection_page", { direction });
      moveSelection(direction * getActivePanelPageSize());
    },
    [moveSelection, recordAction],
  );

  const selectFirstRow = useCallback(() => {
    recordAction("select_first_row");
    selectEntryByIndex(0);
  }, [recordAction, selectEntryByIndex]);

  const selectLastRow = useCallback(() => {
    recordAction("select_last_row");
    if (!session) {
      return;
    }

    const tab = activeTab(session[session.activePanel]);
    const entries = getDisplayListing(tab)?.entries ?? [];
    selectEntryByIndex(entries.length - 1);
  }, [getDisplayListing, recordAction, selectEntryByIndex, session]);

  const openEntry = useCallback(
    async (panelId: PanelId, entry: FileEntry) => {
      recordAction("open_entry", {
        panelId,
        path: entry.path,
        isDir: entry.isDir,
      });
      setActivePanel(panelId);

      if (entry.isDir) {
        navigateTo(panelId, entry.path);
        return;
      }

      try {
        await openPath(entry.path);
      } catch (error) {
        reportNotice(errorToMessage(error));
      }
    },
    [navigateTo, recordAction, reportNotice, setActivePanel],
  );

  const openSelected = useCallback(() => {
    recordAction("open_selected", { panelId: session?.activePanel ?? null });
    if (!session) {
      return;
    }
    const tab = activeTab(session[session.activePanel]);
    const listing = getDisplayListing(tab);
    const entry = findSelectedEntry(tab, listing);
    if (entry) {
      void openEntry(session.activePanel, entry);
    }
  }, [getDisplayListing, openEntry, recordAction, session]);

  const openFolderInNewTab = useCallback((panelId: PanelId, path: string) => {
    recordAction("open_folder_in_new_tab", { panelId, path });
    setSession((previous) => {
      if (!previous) {
        return previous;
      }

      const newPanelTab = createTab(path);
      return {
        ...previous,
        activePanel: panelId,
        [panelId]: {
          tabs: [...previous[panelId].tabs, newPanelTab],
          activeTabId: newPanelTab.id,
        },
      };
    });
  }, [recordAction]);

  const openSelectedInNewTab = useCallback(() => {
    recordAction("open_selected_in_new_tab", {
      panelId: session?.activePanel ?? null,
    });
    if (!session) {
      return;
    }

    const panelId = session.activePanel;
    const tab = activeTab(session[panelId]);
    const entry = findSelectedEntry(tab, getDisplayListing(tab));
    if (entry?.isDir) {
      openFolderInNewTab(panelId, entry.path);
    }
  }, [getDisplayListing, openFolderInNewTab, recordAction, session]);

  const openEntryContextMenu = useCallback(
    (panelId: PanelId, entry: FileEntry, position: { x: number; y: number }) => {
      recordAction("open_context_menu", {
        panelId,
        path: entry.path,
        x: position.x,
        y: position.y,
      });
      setActivePanel(panelId);
      setSession((previous) =>
        previous
          ? updateActiveTab(previous, panelId, (tab) => ({
              ...tab,
              selectedPaths: tab.selectedPaths.includes(entry.path)
                ? tab.selectedPaths
                : [entry.path],
            }))
          : previous,
      );
      setContextMenu({
        panelId,
        entry,
        x: position.x,
        y: position.y,
      });
    },
    [recordAction, setActivePanel],
  );

  const revealEntry = useCallback(
    async (entry: FileEntry) => {
      recordAction("reveal_entry", { path: entry.path });
      setContextMenu(null);
      try {
        await revealPath(entry.path);
      } catch (error) {
        reportNotice(errorToMessage(error));
      }
    },
    [recordAction, reportNotice],
  );

  const copyPathsToClipboard = useCallback(
    async (paths: string[], source: "selection" | "context_menu") => {
      recordAction("copy_path_requested", { source, items: paths });
      if (paths.length === 0) {
        reportNotice("Select one or more items first.");
        return;
      }

      try {
        await writeClipboardText(paths.join("\n"));
        recordAction("copy_path_completed", { source, items: paths });
        reportNotice(
          paths.length === 1
            ? "Copied path to clipboard."
            : `Copied ${paths.length} paths to clipboard.`,
        );
      } catch (error) {
        recordAction("copy_path_failed", {
          source,
          items: paths,
          error: errorToMessage(error),
        });
        reportNotice(errorToMessage(error));
      }
    },
    [recordAction, reportNotice],
  );

  const copySelectedPaths = useCallback(() => {
    if (!session) {
      return;
    }

    const tab = activeTab(session[session.activePanel]);
    const selectedPaths = visibleSelectedPaths(tab, getDisplayListing(tab));
    setContextMenu(null);
    void copyPathsToClipboard(selectedPaths, "selection");
  }, [copyPathsToClipboard, getDisplayListing, session]);

  const startPathDrag = useCallback(
    (panelId: PanelId, entry: FileEntry, event: DragEvent<HTMLDivElement>) => {
      if (!session) {
        event.preventDefault();
        return;
      }

      const tab = activeTab(session[panelId]);
      const selectedPaths = tab.selectedPaths.includes(entry.path)
        ? visibleSelectedPaths(tab, getDisplayListing(tab))
        : [];
      const dragPaths = selectedPaths.length > 0 ? selectedPaths : [entry.path];
      const terminalText = formatPathsForTerminal(dragPaths, platform);
      const dragUris = dragPaths.map(pathToFileUri);
      const uriList = dragUris.join("\r\n");

      event.stopPropagation();
      event.dataTransfer.clearData();
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.dropEffect = "copy";
      event.dataTransfer.setData("text/plain", terminalText);
      event.dataTransfer.setData("text/uri-list", uriList);
      event.dataTransfer.setData("text/x-moz-url", dragUris.map((uri) => `${uri}\n${uri}`).join("\n"));
      event.dataTransfer.setData("application/x-bobroot-paths", JSON.stringify(dragPaths));
      if (dragPaths.length === 1 && !entry.isDir) {
        event.dataTransfer.setData(
          "DownloadURL",
          `${fileDragMimeType(entry)}:${entry.name}:${dragUris[0]}`,
        );
      }

      recordAction("file_drag_started", { panelId, items: dragPaths });
      setContextMenu(null);
      setRenameState(null);
      setSession((previous) =>
        previous
          ? updateActiveTab({ ...previous, activePanel: panelId }, panelId, (current) =>
              current.selectedPaths.includes(entry.path)
                ? current
                : { ...current, selectedPaths: [entry.path] },
            )
          : previous,
      );
    },
    [getDisplayListing, platform, recordAction, session],
  );

  const runTransfer = useCallback(
    async (mode: "copy" | "move") => {
      recordAction("transfer_requested", { mode });
      if (!session) {
        return;
      }

      if (!session.visibility.right) {
        reportNotice("Show the right panel to copy or move between panels.");
        return;
      }

      const sourcePanel = session.activePanel;
      const destinationPanel = oppositePanel(sourcePanel);
      const sourceTab = activeTab(session[sourcePanel]);
      const destinationTab = activeTab(session[destinationPanel]);
      const items = visibleSelectedPaths(sourceTab, getDisplayListing(sourceTab));

      if (items.length === 0) {
        reportNotice("Select one or more items first.");
        return;
      }

      const strategy = await requestConflictStrategy(mode);
      if (!strategy) {
        recordAction("transfer_cancelled", { mode, reason: "no_conflict_strategy" });
        return;
      }

      try {
        const report =
          mode === "copy"
            ? await copyItems(items, destinationTab.path, strategy)
            : await moveItems(items, destinationTab.path, strategy);
        recordAction("transfer_completed", {
          mode,
          sourcePanel,
          destinationPanel,
          items,
          destinationDir: destinationTab.path,
          strategy,
          results: report.results,
        });
        reportNotice(describeReport(report.results));
        await refreshVisiblePanels();
      } catch (error) {
        recordAction("transfer_failed", {
          mode,
          sourcePanel,
          destinationPanel,
          items,
          destinationDir: destinationTab.path,
          strategy,
          error: errorToMessage(error),
        });
        reportNotice(errorToMessage(error));
      }
    },
    [getDisplayListing, recordAction, refreshVisiblePanels, reportNotice, requestConflictStrategy, session],
  );

  const trashSelected = useCallback(async () => {
    recordAction("trash_requested", { panelId: session?.activePanel ?? null });
    if (!session) {
      return;
    }
    const tab = activeTab(session[session.activePanel]);
    const selectedPaths = visibleSelectedPaths(tab, getDisplayListing(tab));
    if (selectedPaths.length === 0) {
      reportNotice("Select one or more items first.");
      return;
    }

    const confirmed = await requestConfirmation({
      title: `Move to ${trashName}`,
      message: `Move ${selectedPaths.length} selected item(s) to ${trashName}?`,
      confirmLabel: `Move to ${trashName}`,
      destructive: true,
    });
    if (!confirmed) {
      recordAction("trash_cancelled", { items: selectedPaths });
      return;
    }

    try {
      const report = await moveToTrash(selectedPaths);
      recordAction("trash_completed", { items: selectedPaths, results: report.results });
      reportNotice(describeReport(report.results));
      await refreshPanel(session.activePanel);
    } catch (error) {
      recordAction("trash_failed", {
        items: selectedPaths,
        error: errorToMessage(error),
      });
      reportNotice(errorToMessage(error));
    }
  }, [getDisplayListing, recordAction, refreshPanel, reportNotice, requestConfirmation, session, trashName]);

  const deleteSelectedPermanently = useCallback(async () => {
    recordAction("permanent_delete_requested", {
      panelId: session?.activePanel ?? null,
    });
    if (!session) {
      return;
    }
    const tab = activeTab(session[session.activePanel]);
    const selectedPaths = visibleSelectedPaths(tab, getDisplayListing(tab));
    if (selectedPaths.length === 0) {
      reportNotice("Select one or more items first.");
      return;
    }

    const confirmed = await requestConfirmation({
      title: "Permanently delete",
      message: `Permanently delete ${selectedPaths.length} selected item(s)? This cannot be undone.`,
      confirmLabel: "Delete Permanently",
      destructive: true,
    });
    if (!confirmed) {
      recordAction("permanent_delete_cancelled", { items: selectedPaths });
      return;
    }

    try {
      const report = await permanentlyDelete(selectedPaths);
      recordAction("permanent_delete_completed", {
        items: selectedPaths,
        results: report.results,
      });
      reportNotice(describeReport(report.results));
      await refreshPanel(session.activePanel);
    } catch (error) {
      recordAction("permanent_delete_failed", {
        items: selectedPaths,
        error: errorToMessage(error),
      });
      reportNotice(errorToMessage(error));
    }
  }, [getDisplayListing, recordAction, refreshPanel, reportNotice, requestConfirmation, session]);

  const renameSelected = useCallback(() => {
    recordAction("rename_requested", { panelId: session?.activePanel ?? null });
    if (!session) {
      return;
    }
    const panelId = session.activePanel;
    const tab = activeTab(session[panelId]);
    const listing = getDisplayListing(tab);
    const selectedPaths = visibleSelectedPaths(tab, listing);
    const entry = findSelectedEntry(tab, listing);
    if (selectedPaths.length !== 1 || !entry) {
      recordAction("rename_blocked", { reason: "selection_count", selectedPaths });
      reportNotice("Select exactly one item to rename.");
      return;
    }

    recordAction("rename_started", { panelId, path: entry.path });
    setRenameState({ panelId, path: entry.path, name: entry.name });
    reportNotice(null);
  }, [getDisplayListing, recordAction, reportNotice, session]);

  const commitRename = useCallback(async () => {
    if (!renameState) {
      return;
    }

    const current = renameState;
    const nextName = current.name.trim();
    setRenameState(null);

    if (!nextName || nextName === basename(current.path)) {
      recordAction("rename_cancelled", {
        path: current.path,
        reason: nextName ? "unchanged" : "empty_name",
      });
      return;
    }

    try {
      const nextPath = await renameItem(current.path, nextName);
      recordAction("rename_completed", {
        panelId: current.panelId,
        source: current.path,
        destination: nextPath,
        newName: nextName,
      });
      setSession((previous) =>
        previous
          ? updateActiveTab(previous, current.panelId, (tab) => ({
              ...tab,
              selectedPaths: [nextPath],
            }))
          : previous,
      );
      reportNotice(null);
      await refreshPanel(current.panelId);
    } catch (error) {
      recordAction("rename_failed", {
        panelId: current.panelId,
        source: current.path,
        newName: nextName,
        error: errorToMessage(error),
      });
      reportNotice(errorToMessage(error));
    }
  }, [recordAction, refreshPanel, renameState, reportNotice]);

  const cancelRename = useCallback(() => {
    if (renameState) {
      recordAction("rename_cancelled", {
        path: renameState.path,
        reason: "cancelled",
      });
    }
    setRenameState(null);
  }, [recordAction, renameState]);

  const createFolderInPanel = useCallback(async (panelId = activePanelId) => {
    recordAction("create_folder_requested", { panelId });
    if (!session) {
      return;
    }

    const tab = activeTab(session[panelId]);
    const name = nextNewFolderName(listings[tab.id]?.entries ?? []);

    try {
      const path = await createFolder(tab.path, name);
      recordAction("create_folder_completed", {
        panelId,
        parentDir: tab.path,
        name,
        path,
      });
      setSession((previous) =>
        previous
          ? updateActiveTab(previous, panelId, (current) => ({
              ...current,
              selectedPaths: [path],
            }))
          : previous,
      );
      await refreshPanel(panelId);
    } catch (error) {
      recordAction("create_folder_failed", {
        panelId,
        parentDir: tab.path,
        name,
        error: errorToMessage(error),
      });
      reportNotice(errorToMessage(error));
    }
  }, [activePanelId, listings, recordAction, refreshPanel, reportNotice, session]);

  const previewSelected = useCallback(async () => {
    recordAction("preview_requested", { panelId: session?.activePanel ?? null });
    if (!session) {
      return;
    }
    const tab = activeTab(session[session.activePanel]);
    const entry = findSelectedEntry(tab, getDisplayListing(tab));
    if (!entry) {
      recordAction("preview_blocked", { reason: "no_selection" });
      reportNotice("Select an item to preview.");
      return;
    }

    if (isAudioPreviewEntry(entry)) {
      setContextMenu(null);
      setRenameState(null);

      if (session.audioPlayback.mode === "bobroot") {
        flushSync(() => {
          setAudioPreview({
            name: entry.name,
            path: entry.path,
            src: convertFileSrc(entry.path),
          });
        });
        recordAction("audio_preview_opened", { path: entry.path });
        reportNotice(null);
        return;
      }

      const customPlayer = session.audioPlayback.customPlayer.trim();
      if (session.audioPlayback.mode === "custom" && customPlayer.length === 0) {
        recordAction("audio_player_blocked", {
          path: entry.path,
          reason: "missing_custom_player",
        });
        reportNotice("Choose an audio player in Audio settings.");
        return;
      }

      try {
        if (session.audioPlayback.mode === "system") {
          await openPath(entry.path);
        } else {
          await openPathWithPlayer(entry.path, customPlayer);
        }
        recordAction("audio_player_opened", {
          path: entry.path,
          mode: session.audioPlayback.mode,
          player: session.audioPlayback.mode === "custom" ? customPlayer : null,
        });
        reportNotice(null);
      } catch (error) {
        recordAction("audio_player_failed", {
          path: entry.path,
          mode: session.audioPlayback.mode,
          error: errorToMessage(error),
        });
        reportNotice(errorToMessage(error));
      }
      return;
    }

    try {
      await previewPath(entry.path);
      recordAction("preview_opened", { path: entry.path });
      reportNotice(null);
    } catch (error) {
      recordAction("preview_failed", {
        path: entry.path,
        error: errorToMessage(error),
      });
      reportNotice(errorToMessage(error));
    }
  }, [getDisplayListing, recordAction, reportNotice, session]);

  const toggleHiddenFiles = useCallback(() => {
    recordAction("toggle_hidden_files", { visible: !showHiddenFiles });
    setSession((previous) =>
      previous
        ? {
            ...previous,
            showHiddenFiles: !previous.showHiddenFiles,
          }
        : previous,
    );
  }, [recordAction, showHiddenFiles]);

  const changeFormatFilter = useCallback(
    (panelId: PanelId, filter: FormatFilter) => {
      if (!session) {
        return;
      }

      const tab = activeTab(session[panelId]);
      recordAction("change_format_filter", { panelId, filter });
      setContextMenu(null);
      setRenameState(null);
      setFormatFilters((current) => {
        const next = { ...current };
        if (filter === DEFAULT_FORMAT_FILTER) {
          delete next[tab.id];
        } else {
          next[tab.id] = filter;
        }
        return next;
      });
      setSession((previous) => {
        if (!previous) {
          return previous;
        }

        const currentTab = activeTab(previous[panelId]);
        const filteredListing = filterListingByFormat(
          listings[currentTab.id] ?? null,
          filter,
        );
        if (!filteredListing) {
          return { ...previous, activePanel: panelId };
        }

        const visiblePaths = new Set(
          filteredListing.entries.map((entry) => entry.path),
        );
        return updateActiveTab({ ...previous, activePanel: panelId }, panelId, (current) => ({
          ...current,
          selectedPaths: current.selectedPaths.filter((path) => visiblePaths.has(path)),
        }));
      });
    },
    [listings, recordAction, session],
  );

  const changeFilePropertyVisibility = useCallback(
    (property: FilePropertyKey, visible: boolean) => {
      recordAction("change_file_property_visibility", { property, visible });
      setContextMenu(null);
      setRenameState(null);
      setSession((previous) =>
        previous
          ? {
              ...previous,
              filePropertyVisibility: {
                ...previous.filePropertyVisibility,
                [property]: visible,
              },
            }
          : previous,
      );
    },
    [recordAction],
  );

  const changeTerminalAppearance = useCallback(
    (appearance: TerminalAppearance) => {
      recordAction("change_terminal_appearance", {
        theme: appearance.theme,
        fontSize: appearance.fontSize,
      });
      setSession((previous) =>
        previous
          ? {
              ...previous,
              terminalAppearance: appearance,
            }
          : previous,
      );
    },
    [recordAction],
  );

  const changeAudioPlaybackSettings = useCallback(
    (settings: AudioPlaybackSettings) => {
      recordAction("change_audio_playback_settings", {
        mode: settings.mode,
        hasCustomPlayer: settings.customPlayer.trim().length > 0,
      });
      setContextMenu(null);
      setRenameState(null);
      setSession((previous) =>
        previous
          ? {
              ...previous,
              audioPlayback: settings,
            }
          : previous,
      );
    },
    [recordAction],
  );

  const shortcutHandlers = useMemo(
    () => ({
      openSelected,
      renameSelected: () => void renameSelected(),
      goBack,
      goForward,
      goParent,
      switchPanel,
      newTab,
      closeTab,
      createFolder: () => void createFolderInPanel(),
      copySelectedPaths,
      copyToOpposite: () => void runTransfer("copy"),
      moveToOpposite: () => void runTransfer("move"),
      syncActivePanelToOpposite,
      trashSelected: () => void trashSelected(),
      deleteSelectedPermanently: () => void deleteSelectedPermanently(),
      previewSelected: () => void previewSelected(),
      toggleHiddenFiles,
      toggleTerminal,
      moveSelection,
      moveSelectionPage,
      selectFirstRow,
      selectLastRow,
      openSelectedInNewTab,
      openPathPrompt,
      typeAhead: typeAheadSelect,
    }),
    [
      closeTab,
      createFolderInPanel,
      copySelectedPaths,
      deleteSelectedPermanently,
      goBack,
      goForward,
      goParent,
      newTab,
      openPathPrompt,
      openSelected,
      openSelectedInNewTab,
      previewSelected,
      renameSelected,
      runTransfer,
      moveSelection,
      moveSelectionPage,
      selectFirstRow,
      selectLastRow,
      syncActivePanelToOpposite,
      switchPanel,
      toggleHiddenFiles,
      toggleTerminal,
      trashSelected,
      typeAheadSelect,
    ],
  );
  useKeyboardShortcuts(
    shortcutHandlers,
    confirmation === null &&
      conflictRequest === null &&
      audioPreview === null &&
      pathPrompt === null,
  );

  if (!session) {
    return (
      <main className="app-shell loading-shell">
        {startupError ? (
          <div className="startup-error" role="alert">
            <TriangleAlert size={22} />
            <div>
              <strong>Unable to open Bobroot</strong>
              <span>{startupError}</span>
            </div>
          </div>
        ) : (
          <div className="initializing">Opening Bobroot...</div>
        )}
      </main>
    );
  }

  const activeDirectory = activeTab(session[session.activePanel]).path;
  const currentTerminalCwd = terminalCwd ?? activeDirectory;

  const renderPanel = (ref: PanelRef, dragHandlers: LayoutDragHandlers) => {
    if (ref === "terminal") {
      return (
        <TerminalPanel
          activeDirectory={activeDirectory}
          appearance={terminalAppearance}
          cwd={currentTerminalCwd}
          dragHandlers={dragHandlers}
          onAppearanceChange={changeTerminalAppearance}
          onBeforeClose={confirmTerminalClose}
          onClose={closeTerminal}
          onCwdChange={setTerminalCwd}
          onLiveSessionCountChange={setTerminalLiveSessionCount}
        />
      );
    }

    if (ref === "agent") {
      return (
        <AgentPanel
          dragHandlers={dragHandlers}
          session={session}
          onClose={closeAgent}
          onLogAction={recordAction}
          onNotice={reportNotice}
        />
      );
    }

    const panelId: PanelId = ref;
    const panelState = session[panelId];
    const tab = activeTab(panelState);
    const rawListing = listings[tab.id] ?? null;
    const formatFilter = formatFilters[tab.id] ?? DEFAULT_FORMAT_FILTER;
    return (
      <FilePanel
        dragHandlers={dragHandlers}
        formatFilter={formatFilter}
        formatOptions={buildFormatFilterOptions(rawListing, formatFilter)}
        isActive={session.activePanel === panelId}
        listing={filterListingByFormat(rawListing, formatFilter)}
        loading={Boolean(loading[tab.id])}
        panel={panelState}
        panelId={panelId}
        platform={platform}
        visibleProperties={filePropertyVisibility}
        onActivate={setActivePanel}
        onCloseTab={closeTab}
        onCreateFolder={createFolderInPanel}
        onEntryContextMenu={openEntryContextMenu}
        onEntryDragStart={startPathDrag}
        onFilePropertyVisibilityChange={changeFilePropertyVisibility}
        onFormatFilterChange={changeFormatFilter}
        onGoBack={goBack}
        onGoForward={goForward}
        onGoParent={goParent}
        onNavigateToPath={navigateTo}
        onNewTab={newTab}
        onOpenEntry={openEntry}
        onRefresh={refreshPanel}
        onRenameCancel={cancelRename}
        onRenameChange={(name) =>
          setRenameState((current) => (current ? { ...current, name } : current))
        }
        onRenameCommit={() => void commitRename()}
        onSelect={selectPath}
        onSwitchTab={switchTab}
        renamingName={renameState?.panelId === panelId ? renameState.name : ""}
        renamingPath={renameState?.panelId === panelId ? renameState.path : null}
      />
    );
  };

  return (
    <main className="app-shell">
      <header className="app-bar">
        <div className="brand">Bobroot</div>
        <div className="global-actions">
          <IconButton
            disabled={!rightPanelVisible}
            label="Copy to opposite panel"
            showLabel
            onClick={() => void runTransfer("copy")}
          >
            <Copy size={16} />
          </IconButton>
          <IconButton
            disabled={!rightPanelVisible}
            label="Move to opposite panel"
            showLabel
            onClick={() => void runTransfer("move")}
          >
            <MoveRight size={16} />
          </IconButton>
          <IconButton
            disabled={!rightPanelVisible}
            label={`Sync opposite panel to active folder (${syncShortcut})`}
            onClick={syncActivePanelToOpposite}
          >
            <FolderSync size={16} />
          </IconButton>
          <IconButton
            data-testid="toggle-right-panel"
            label={rightPanelVisible ? "Hide right panel" : "Show right panel"}
            className={rightPanelVisible ? "" : "pressed"}
            onClick={toggleRightPanel}
          >
            {rightPanelVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </IconButton>
          <IconButton
            label={`${terminalVisible ? "Hide terminal" : "Show terminal"} (${terminalKey})`}
            className={terminalVisible ? "pressed" : ""}
            onClick={toggleTerminal}
          >
            <TerminalIcon size={16} />
          </IconButton>
          <IconButton
            label={agentVisible ? "Hide agent" : "Show agent"}
            className={agentVisible ? "pressed" : ""}
            onClick={toggleAgent}
          >
            <Bot size={16} />
          </IconButton>
          <IconButton label="Rename" onClick={() => void renameSelected()}>
            <Pencil size={16} />
          </IconButton>
          <IconButton label={`New folder (${folderShortcut})`} onClick={() => void createFolderInPanel()}>
            <FolderPlus size={16} />
          </IconButton>
          <IconButton
            label={`Move to ${trashName} (${trashKey}). Permanent delete: ${permanentShortcut}`}
            onClick={() => void trashSelected()}
          >
            <Trash2 size={16} />
          </IconButton>
          <IconButton
            label={`${showHiddenFiles ? "Hide hidden files" : "Show hidden files"} (${hiddenShortcut})`}
            className={showHiddenFiles ? "pressed" : ""}
            onClick={toggleHiddenFiles}
          >
            {showHiddenFiles ? <Eye size={16} /> : <EyeOff size={16} />}
          </IconButton>
          <AudioPlaybackControl
            platform={platform}
            settings={audioPlaybackSettings}
            onChange={changeAudioPlaybackSettings}
          />
          <IconButton label="Preview selected item (Space)" onClick={() => void previewSelected()}>
            <Eye size={16} />
          </IconButton>
        </div>
      </header>

      {notice ? (
        <div className="notice">
          <TriangleAlert size={16} />
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => {
              recordAction("dismiss_notice", { message: notice });
              setNotice(null);
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="workspace">
        <Layout
          layout={session.layout}
          onLayoutChange={setLayout}
          renderPanel={renderPanel}
          visibility={session.visibility}
        />
      </div>
      {contextMenu ? (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          role="menu"
        >
          {contextMenu.entry.isDir ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                openFolderInNewTab(contextMenu.panelId, contextMenu.entry.path);
                setContextMenu(null);
              }}
            >
              Open in New Tab
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={() => void revealEntry(contextMenu.entry)}>
            {revealLabel}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const path = contextMenu.entry.path;
              setContextMenu(null);
              void copyPathsToClipboard([path], "context_menu");
            }}
          >
            Copy Path ({copyPathKey})
          </button>
        </div>
      ) : null}
      {confirmation ? (
        <ConfirmationDialog
          actions={[
            {
              autoFocus: true,
              className: "secondary-action",
              label: "Cancel",
              onPress: () => resolveConfirmation(false),
            },
            {
              className: confirmation.destructive ? "destructive-action" : "primary-action",
              label: confirmation.confirmLabel,
              onPress: () => resolveConfirmation(true),
            },
          ]}
          message={confirmation.message}
          onCancel={() => resolveConfirmation(false)}
          title={confirmation.title}
        />
      ) : null}
      {pathPrompt ? (
        <PathPrompt
          initialValue={pathPrompt.initialValue}
          onCancel={closePathPrompt}
          onNavigate={navigateFromPathPrompt}
        />
      ) : null}
      {audioPreview ? (
        <AudioPreviewDialog preview={audioPreview} onClose={() => setAudioPreview(null)} />
      ) : null}
      {conflictRequest ? (
        <ConfirmationDialog
          actions={[
            {
              className: "secondary-action",
              label: "Cancel",
              onPress: () => resolveConflictStrategy(null),
            },
            {
              className: "secondary-action",
              label: "Skip",
              onPress: () => resolveConflictStrategy("skip"),
            },
            {
              className: "destructive-action",
              label: "Replace",
              onPress: () => resolveConflictStrategy("replace"),
            },
            {
              autoFocus: true,
              className: "primary-action",
              label: "Rename",
              onPress: () => resolveConflictStrategy("rename"),
            },
          ]}
          message="When an item already exists at the destination, what should Bobroot do?"
          onCancel={() => resolveConflictStrategy(null)}
          title={conflictRequest.mode === "copy" ? "Copy items" : "Move items"}
        />
      ) : null}
    </main>
  );
}

function AudioPlaybackControl({
  platform,
  settings,
  onChange,
}: {
  platform: ReturnType<typeof currentPlatform>;
  settings: AudioPlaybackSettings;
  onChange: (settings: AudioPlaybackSettings) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsidePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const updateSettings = (updates: Partial<AudioPlaybackSettings>) => {
    onChange({
      ...settings,
      ...updates,
    });
  };

  return (
    <div className="audio-playback-menu" ref={menuRef}>
      <IconButton
        aria-expanded={open}
        aria-haspopup="dialog"
        className={open ? "pressed" : ""}
        label={`Audio player: ${audioPlaybackModeLabel(settings.mode)}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <Music2 size={16} />
      </IconButton>
      {open ? (
        <div
          aria-label="Audio playback settings"
          className="audio-playback-popover"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
        >
          <label className="audio-playback-field">
            <span>Audio player</span>
            <select
              aria-label="Audio player for Space"
              onChange={(event) =>
                updateSettings({ mode: event.target.value as AudioPlaybackMode })
              }
              value={settings.mode}
            >
              <option value="bobroot">Bobroot player</option>
              <option value="system">System default</option>
              <option value="custom">Selected player</option>
            </select>
          </label>
          {settings.mode === "custom" ? (
            <label className="audio-playback-field">
              <span>Player app</span>
              <input
                aria-label="Selected audio player"
                autoFocus
                maxLength={512}
                onChange={(event) =>
                  updateSettings({ customPlayer: event.target.value })
                }
                placeholder={audioPlayerPlaceholder(platform)}
                value={settings.customPlayer}
              />
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function audioPlaybackModeLabel(mode: AudioPlaybackMode): string {
  if (mode === "system") {
    return "System default";
  }
  if (mode === "custom") {
    return "Selected player";
  }
  return "Bobroot player";
}

function audioPlayerPlaceholder(platform: ReturnType<typeof currentPlatform>): string {
  if (platform === "macos") {
    return "Music, QuickTime Player, /Applications/VLC.app";
  }
  if (platform === "windows") {
    return "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe";
  }
  return "vlc or /usr/bin/vlc";
}

function AudioPreviewDialog({
  preview,
  onClose,
}: {
  preview: AudioPreviewState;
  onClose: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }

    setPlaybackError(null);
    void audio.play().catch(() => {
      setPlaybackError("Press play to start the preview.");
    });

    return () => {
      audio.pause();
    };
  }, [preview.src]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="confirmation-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section
        aria-label={`Preview ${preview.name}`}
        aria-modal="true"
        className="audio-preview-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="audio-preview-header">
          <div className="audio-preview-title" title={preview.path}>
            {preview.name}
          </div>
          <IconButton label="Close audio preview" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <audio
          autoPlay
          className="audio-preview-player"
          controls
          onError={() => setPlaybackError("Bobroot could not load this audio file.")}
          preload="auto"
          ref={audioRef}
          src={preview.src}
        />
        {playbackError ? <p className="audio-preview-error">{playbackError}</p> : null}
      </section>
    </div>
  );
}

function updatePanel(
  session: SessionData,
  panelId: PanelId,
  updater: (panel: PanelState) => PanelState,
): SessionData {
  return {
    ...session,
    [panelId]: updater(session[panelId]),
  };
}

function updateActiveTab(
  session: SessionData,
  panelId: PanelId,
  updater: (tab: TabState) => TabState,
): SessionData {
  return updatePanel(session, panelId, (panel) =>
    updatePanelTab(panel, panel.activeTabId, updater),
  );
}

function updateTab(
  session: SessionData,
  panelId: PanelId,
  tabId: string,
  updater: (tab: TabState) => TabState,
): SessionData {
  return updatePanel(session, panelId, (panel) => updatePanelTab(panel, tabId, updater));
}

function updatePanelTab(
  panel: PanelState,
  tabId: string,
  updater: (tab: TabState) => TabState,
): PanelState {
  return {
    ...panel,
    tabs: panel.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
  };
}

function replaceHistoryPath(tab: TabState, path: string): string[] {
  const history = [...tab.history];
  history[tab.historyIndex] = path;
  return history;
}

function filterListingByFormat(
  listing: DirectoryListing | null,
  filter: FormatFilter,
): DirectoryListing | null {
  if (!listing || filter === "all") {
    return listing;
  }

  return {
    ...listing,
    entries: listing.entries.filter((entry) => entryMatchesFormatFilter(entry, filter)),
  };
}

function entryMatchesFormatFilter(entry: FileEntry, filter: FormatFilter): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "folders") {
    return entry.isDir;
  }

  if (filter === "noExtension") {
    return !entry.isDir && !entry.extension;
  }

  return !entry.isDir && entry.extension === filter.slice("extension:".length);
}

const AUDIO_PREVIEW_EXTENSIONS = new Set([
  "aac",
  "aif",
  "aiff",
  "flac",
  "m4a",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
  "wave",
]);

function isAudioPreviewEntry(entry: FileEntry): boolean {
  return (
    entry.isFile &&
    entry.extension !== null &&
    AUDIO_PREVIEW_EXTENSIONS.has(entry.extension.toLowerCase())
  );
}

function buildFormatFilterOptions(
  listing: DirectoryListing | null,
  currentFilter: FormatFilter,
): FormatFilterOption[] {
  const extensionCounts = new Map<string, number>();
  let folderCount = 0;
  let noExtensionCount = 0;

  for (const entry of listing?.entries ?? []) {
    if (entry.isDir) {
      folderCount += 1;
    } else if (entry.extension) {
      extensionCounts.set(entry.extension, (extensionCounts.get(entry.extension) ?? 0) + 1);
    } else {
      noExtensionCount += 1;
    }
  }

  const options: FormatFilterOption[] = [
    { value: "all", label: "All formats", count: listing?.entries.length ?? 0 },
  ];

  if (folderCount > 0) {
    options.push({ value: "folders", label: "Folders", count: folderCount });
  }

  if (noExtensionCount > 0) {
    options.push({
      value: "noExtension",
      label: "No extension",
      count: noExtensionCount,
    });
  }

  for (const [extension, count] of Array.from(extensionCounts).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    options.push({
      value: `extension:${extension}`,
      label: `.${extension}`,
      count,
    });
  }

  if (!options.some((option) => option.value === currentFilter)) {
    options.push({
      value: currentFilter,
      label: formatFilterLabel(currentFilter),
      count: 0,
    });
  }

  return options;
}

function formatFilterLabel(filter: FormatFilter): string {
  if (filter === "all") {
    return "All formats";
  }

  if (filter === "folders") {
    return "Folders";
  }

  if (filter === "noExtension") {
    return "No extension";
  }

  const extension = filter.slice("extension:".length);
  return extension ? `.${extension}` : "Unknown format";
}

function findSelectedEntry(tab: TabState, listing: DirectoryListing | null): FileEntry | null {
  if (!listing || tab.selectedPaths.length === 0) {
    return null;
  }

  return listing.entries.find((entry) => entry.path === tab.selectedPaths[0]) ?? null;
}

function visibleSelectedPaths(tab: TabState, listing: DirectoryListing | null): string[] {
  if (!listing) {
    return [];
  }

  const visiblePaths = new Set(listing.entries.map((entry) => entry.path));
  return tab.selectedPaths.filter((path) => visiblePaths.has(path));
}

function formatPathsForTerminal(paths: string[], platform: ReturnType<typeof currentPlatform>): string {
  const formatter = platform === "windows" ? quoteWindowsPath : quotePosixPath;
  return paths.map(formatter).join(" ");
}

function quotePosixPath(path: string): string {
  if (path === "") {
    return "''";
  }

  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(path)) {
    return path;
  }

  return "'" + path.replace(/'/g, "'\\''") + "'";
}

function quoteWindowsPath(path: string): string {
  if (path === "") {
    return '""';
  }

  if (/^[A-Za-z0-9_.:\\/-]+$/.test(path)) {
    return path;
  }

  return '"' + path.replace(/"/g, '""') + '"';
}

function fileDragMimeType(entry: FileEntry): string {
  const mimeTypes: Record<string, string> = {
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    pdf: "application/pdf",
    png: "image/png",
    svg: "image/svg+xml",
    txt: "text/plain",
    webp: "image/webp",
  };

  return mimeTypes[entry.extension?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

function pathToFileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const prefix = normalized.startsWith("/") ? "file://" : "file:///";
  const encodedPath = normalized
    .split("/")
    .map((segment, index) => {
      if (segment === "" || (index === 0 && /^[A-Za-z]:$/.test(segment))) {
        return segment;
      }

      return encodeURIComponent(segment);
    })
    .join("/");

  return `${prefix}${encodedPath}`;
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy copy path below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard is unavailable.");
    }
  } finally {
    textarea.remove();
  }
}

function getActivePanelPageSize(): number {
  const list = document.querySelector(".file-panel.active .file-list");
  if (!(list instanceof HTMLElement)) {
    return 10;
  }

  return Math.max(1, Math.floor(list.clientHeight / 32) - 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function pruneByKey<T>(
  current: Record<string, T>,
  validKeys: Set<string>,
): Record<string, T> {
  const next: Record<string, T> = {};
  let changed = false;
  for (const [key, value] of Object.entries(current)) {
    if (validKeys.has(key)) {
      next[key] = value;
    } else {
      changed = true;
    }
  }
  return changed ? next : current;
}

function visiblePanelDirectories(session: SessionData): string[] {
  const paths = [activeTab(session.left).path];
  if (session.visibility.right) {
    paths.push(activeTab(session.right).path);
  }

  return Array.from(new Set(paths.map(normalizeDirectoryPath)));
}

function normalizeDirectoryPath(path: string): string {
  if (path === "/" || /^[A-Za-z]:[\\/]?$/.test(path)) {
    return path;
  }

  const withoutTrailingSeparators = path.replace(/[\\/]+$/, "");
  return withoutTrailingSeparators || path;
}

function nextNewFolderName(entries: FileEntry[]): string {
  const names = new Set(entries.map((entry) => entry.name));
  const baseName = "New Folder";

  if (!names.has(baseName)) {
    return baseName;
  }

  for (let index = 2; ; index += 1) {
    const name = `${baseName} ${index}`;
    if (!names.has(name)) {
      return name;
    }
  }
}

function describeReport(results: Array<{ status: string; message: string | null }>): string {
  const errors = results.filter((result) => result.status === "error");
  const skipped = results.filter((result) => result.status === "skipped");
  const completed = results.length - errors.length - skipped.length;

  if (errors.length > 0) {
    return `${completed} completed, ${skipped.length} skipped, ${errors.length} failed. ${errors[0].message ?? ""}`;
  }

  if (skipped.length > 0) {
    return `${completed} completed, ${skipped.length} skipped.`;
  }

  return `${completed} item(s) completed.`;
}

function errorToMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return typeof error === "string" ? error : "Something went wrong.";
}

export default App;
