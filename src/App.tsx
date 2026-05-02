import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  FolderPlus,
  FolderSync,
  MoveRight,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Trash2,
  TriangleAlert,
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
  permanentlyDelete,
  previewPath,
  revealPath,
  renameItem,
  saveSession,
} from "./lib/api";
import { basename } from "./lib/format";
import {
  activeTab,
  createPanel,
  createTab,
  navigateTab,
  normalizeSession,
  oppositePanel,
} from "./lib/tabState";
import {
  currentPlatform,
  copyPathShortcut,
  hiddenFilesShortcut,
  newFolderShortcut,
  permanentDeleteShortcut,
  revealActionLabel,
  syncPanelShortcut,
  trashShortcut,
  trashTargetName,
} from "./lib/platform";
import type {
  ActionLogDetails,
  ConflictStrategy,
  DirectoryListing,
  FileEntry,
  PanelId,
  PanelState,
  SessionData,
  TabState,
} from "./lib/types";
import { readWindowSession, restoreWindowSession } from "./lib/windowSession";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { FilePanel } from "./components/FilePanel";
import { IconButton } from "./components/IconButton";

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

function App() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [listings, setListings] = useState<ListingMap>({});
  const [loading, setLoading] = useState<LoadingMap>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const saveTimer = useRef<number | null>(null);

  const platform = useMemo(() => currentPlatform(), []);
  const hiddenShortcut = useMemo(() => hiddenFilesShortcut(platform), [platform]);
  const copyPathKey = useMemo(() => copyPathShortcut(platform), [platform]);
  const folderShortcut = useMemo(() => newFolderShortcut(platform), [platform]);
  const syncShortcut = useMemo(() => syncPanelShortcut(platform), [platform]);
  const trashKey = useMemo(() => trashShortcut(platform), [platform]);
  const trashName = useMemo(() => trashTargetName(platform), [platform]);
  const permanentShortcut = useMemo(() => permanentDeleteShortcut(platform), [platform]);
  const revealLabel = useMemo(() => revealActionLabel(platform), [platform]);
  const activePanelId = session?.activePanel ?? "left";
  const rightPanelVisible = session?.rightPanelVisible ?? true;
  const showHiddenFiles = session?.showHiddenFiles ?? false;

  const reportNotice = useCallback((message: string | null) => {
    setNotice(message);
  }, []);

  const recordAction = useCallback(
    (action: string, details: ActionLogDetails = {}) => {
      void logAction(action, details).catch(() => undefined);
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

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const home = await getHomeDir();
        const saved = await loadSession();
        if (cancelled) {
          return;
        }

        const initialSession = saved
            ? normalizeSession(saved, home)
            : {
                left: createPanel(home),
                right: createPanel(home),
                activePanel: "left" as const,
                rightPanelVisible: true,
                showHiddenFiles: false,
                window: null,
              };

        setSession(initialSession);
        await restoreWindowSession(initialSession.window);
      } catch (error) {
        reportNotice(errorToMessage(error));
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [reportNotice]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const visibleTabs: Array<[PanelId, TabState]> = [
      ["left", activeTab(session.left)],
    ];
    if (session.rightPanelVisible) {
      visibleTabs.push(["right", activeTab(session.right)]);
    }

    for (const [panelId, tab] of visibleTabs) {
      void loadTab(panelId, tab);
    }
  }, [
    loadTab,
    session?.left.activeTabId,
    session?.right.activeTabId,
    session?.rightPanelVisible,
    session?.showHiddenFiles,
    session?.left.tabs,
    session?.right.tabs,
  ]);

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
      previous && (panelId === "left" || previous.rightPanelVisible)
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
            activePanel: previous.rightPanelVisible
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

      const nextVisible = !previous.rightPanelVisible;
      return {
        ...previous,
        activePanel: nextVisible ? previous.activePanel : "left",
        rightPanelVisible: nextVisible,
      };
    });
  }, [recordAction, rightPanelVisible]);

  const navigateTo = useCallback((panelId: PanelId, path: string) => {
    recordAction("navigate", { panelId, path });
    setSession((previous) =>
      previous
        ? updateActiveTab(previous, panelId, (tab) => navigateTab(tab, path))
        : previous,
    );
  }, [recordAction]);

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
    recordAction("match_opposite_panel_folder");
    if (!session) {
      return;
    }

    if (!session.rightPanelVisible) {
      reportNotice("Show the right panel to match folders between panels.");
      return;
    }

    const panelId = session.activePanel;
    const sourcePanelId = oppositePanel(panelId);
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
      const entries = listings[tab.id]?.entries ?? [];
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
    [listings, recordAction, session],
  );

  const moveSelection = useCallback(
    (delta: number) => {
      recordAction("move_selection", { delta });
      if (!session) {
        return;
      }

      const panelId = session.activePanel;
      const tab = activeTab(session[panelId]);
      const entries = listings[tab.id]?.entries ?? [];
      if (entries.length === 0) {
        return;
      }

      const currentIndex = entries.findIndex((entry) => entry.path === tab.selectedPaths[0]);
      const fallbackIndex = delta > 0 ? -1 : entries.length;
      selectEntryByIndex((currentIndex >= 0 ? currentIndex : fallbackIndex) + delta);
    },
    [listings, recordAction, selectEntryByIndex, session],
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
    const entries = listings[tab.id]?.entries ?? [];
    selectEntryByIndex(entries.length - 1);
  }, [listings, recordAction, selectEntryByIndex, session]);

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
    const listing = listings[tab.id];
    const entry = findSelectedEntry(tab, listing);
    if (entry) {
      void openEntry(session.activePanel, entry);
    }
  }, [listings, openEntry, recordAction, session]);

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
    const entry = findSelectedEntry(tab, listings[tab.id] ?? null);
    if (entry?.isDir) {
      openFolderInNewTab(panelId, entry.path);
    }
  }, [listings, openFolderInNewTab, recordAction, session]);

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
    const selectedPaths = visibleSelectedPaths(tab, listings[tab.id] ?? null);
    setContextMenu(null);
    void copyPathsToClipboard(selectedPaths, "selection");
  }, [copyPathsToClipboard, listings, session]);

  const runTransfer = useCallback(
    async (mode: "copy" | "move") => {
      recordAction("transfer_requested", { mode });
      if (!session) {
        return;
      }

      if (!session.rightPanelVisible) {
        reportNotice("Show the right panel to copy or move between panels.");
        return;
      }

      const sourcePanel = session.activePanel;
      const destinationPanel = oppositePanel(sourcePanel);
      const sourceTab = activeTab(session[sourcePanel]);
      const destinationTab = activeTab(session[destinationPanel]);
      const items = visibleSelectedPaths(sourceTab, listings[sourceTab.id] ?? null);

      if (items.length === 0) {
        reportNotice("Select one or more items first.");
        return;
      }

      const strategy = askConflictStrategy(mode);
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
    [listings, recordAction, refreshVisiblePanels, reportNotice, session],
  );

  const trashSelected = useCallback(async () => {
    recordAction("trash_requested", { panelId: session?.activePanel ?? null });
    if (!session) {
      return;
    }
    const tab = activeTab(session[session.activePanel]);
    const selectedPaths = visibleSelectedPaths(tab, listings[tab.id] ?? null);
    if (selectedPaths.length === 0) {
      reportNotice("Select one or more items first.");
      return;
    }

    const confirmed = window.confirm(
      `Move ${selectedPaths.length} selected item(s) to ${trashName}?`,
    );
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
  }, [listings, recordAction, refreshPanel, reportNotice, session, trashName]);

  const deleteSelectedPermanently = useCallback(async () => {
    recordAction("permanent_delete_requested", {
      panelId: session?.activePanel ?? null,
    });
    if (!session) {
      return;
    }
    const tab = activeTab(session[session.activePanel]);
    const selectedPaths = visibleSelectedPaths(tab, listings[tab.id] ?? null);
    if (selectedPaths.length === 0) {
      reportNotice("Select one or more items first.");
      return;
    }

    const confirmed = window.confirm(
      `Permanently delete ${selectedPaths.length} selected item(s)? This cannot be undone.`,
    );
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
  }, [listings, recordAction, refreshPanel, reportNotice, session]);

  const renameSelected = useCallback(() => {
    recordAction("rename_requested", { panelId: session?.activePanel ?? null });
    if (!session) {
      return;
    }
    const panelId = session.activePanel;
    const tab = activeTab(session[panelId]);
    const listing = listings[tab.id] ?? null;
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
  }, [listings, recordAction, reportNotice, session]);

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
    const entry = findSelectedEntry(tab, listings[tab.id] ?? null);
    if (!entry) {
      recordAction("preview_blocked", { reason: "no_selection" });
      reportNotice("Select an item to preview.");
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
  }, [listings, recordAction, reportNotice, session]);

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

  const shortcutHandlers = useMemo(
    () => ({
      openSelected,
      renameSelected: () => void renameSelected(),
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
      moveSelection,
      moveSelectionPage,
      selectFirstRow,
      selectLastRow,
      openSelectedInNewTab,
    }),
    [
      closeTab,
      createFolderInPanel,
      copySelectedPaths,
      deleteSelectedPermanently,
      goParent,
      newTab,
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
      trashSelected,
    ],
  );
  useKeyboardShortcuts(shortcutHandlers);

  if (!session) {
    return (
      <main className="app-shell loading-shell">
        <div className="initializing">Opening Bobroot...</div>
      </main>
    );
  }

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
            label={`Match opposite panel folder (${syncShortcut})`}
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
          <IconButton label="Quick Look (Space)" onClick={() => void previewSelected()}>
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
        <div className={`panels ${rightPanelVisible ? "" : "single-panel"}`}>
          <FilePanel
            panelId="left"
            panel={session.left}
            listing={listings[activeTab(session.left).id] ?? null}
            loading={Boolean(loading[activeTab(session.left).id])}
            isActive={session.activePanel === "left"}
            onActivate={setActivePanel}
            onSwitchTab={switchTab}
            onNewTab={newTab}
            onCloseTab={closeTab}
            onGoParent={goParent}
            onRefresh={refreshPanel}
            onSelect={selectPath}
            onOpenEntry={openEntry}
            onEntryContextMenu={openEntryContextMenu}
            onCreateFolder={createFolderInPanel}
            renamingPath={renameState?.panelId === "left" ? renameState.path : null}
            renamingName={renameState?.panelId === "left" ? renameState.name : ""}
            onRenameChange={(name) =>
              setRenameState((current) => (current ? { ...current, name } : current))
            }
            onRenameCommit={() => void commitRename()}
            onRenameCancel={cancelRename}
          />
          {rightPanelVisible ? (
            <FilePanel
              panelId="right"
              panel={session.right}
              listing={listings[activeTab(session.right).id] ?? null}
              loading={Boolean(loading[activeTab(session.right).id])}
              isActive={session.activePanel === "right"}
              onActivate={setActivePanel}
              onSwitchTab={switchTab}
              onNewTab={newTab}
              onCloseTab={closeTab}
              onGoParent={goParent}
              onRefresh={refreshPanel}
              onSelect={selectPath}
              onOpenEntry={openEntry}
              onEntryContextMenu={openEntryContextMenu}
              onCreateFolder={createFolderInPanel}
              renamingPath={renameState?.panelId === "right" ? renameState.path : null}
              renamingName={renameState?.panelId === "right" ? renameState.name : ""}
              onRenameChange={(name) =>
                setRenameState((current) => (current ? { ...current, name } : current))
              }
              onRenameCommit={() => void commitRename()}
              onRenameCancel={cancelRename}
            />
          ) : null}
        </div>
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
    </main>
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

function askConflictStrategy(mode: "copy" | "move"): ConflictStrategy | null {
  const answer = window
    .prompt(
      `${mode === "copy" ? "Copy" : "Move"} conflict handling: replace, skip, or rename with suffix`,
      "rename",
    )
    ?.trim()
    .toLowerCase();

  if (!answer) {
    return null;
  }

  if (answer === "replace" || answer === "skip" || answer === "rename") {
    return answer;
  }

  window.alert("Use replace, skip, or rename.");
  return null;
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
