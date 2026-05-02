import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  FolderPlus,
  FolderSync,
  MoveRight,
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
  hiddenFilesShortcut,
  newFolderShortcut,
  permanentDeleteShortcut,
  revealActionLabel,
  syncPanelShortcut,
  trashShortcut,
  trashTargetName,
} from "./lib/platform";
import type {
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
  const folderShortcut = useMemo(() => newFolderShortcut(platform), [platform]);
  const syncShortcut = useMemo(() => syncPanelShortcut(platform), [platform]);
  const trashKey = useMemo(() => trashShortcut(platform), [platform]);
  const trashName = useMemo(() => trashTargetName(platform), [platform]);
  const permanentShortcut = useMemo(() => permanentDeleteShortcut(platform), [platform]);
  const revealLabel = useMemo(() => revealActionLabel(platform), [platform]);
  const activePanelId = session?.activePanel ?? "left";
  const showHiddenFiles = session?.showHiddenFiles ?? false;

  const reportNotice = useCallback((message: string | null) => {
    setNotice(message);
  }, []);

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
      ["right", activeTab(session.right)],
    ];

    for (const [panelId, tab] of visibleTabs) {
      void loadTab(panelId, tab);
    }
  }, [
    loadTab,
    session?.left.activeTabId,
    session?.right.activeTabId,
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
    setSession((previous) =>
      previous ? { ...previous, activePanel: panelId } : previous,
    );
  }, []);

  const switchPanel = useCallback(() => {
    setSession((previous) =>
      previous
        ? {
            ...previous,
            activePanel: oppositePanel(previous.activePanel),
          }
        : previous,
    );
  }, []);

  const switchTab = useCallback((panelId: PanelId, tabId: string) => {
    setSession((previous) =>
      previous
        ? {
            ...previous,
            activePanel: panelId,
            [panelId]: { ...previous[panelId], activeTabId: tabId },
          }
        : previous,
    );
  }, []);

  const newTab = useCallback((panelId = activePanelId) => {
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
  }, [activePanelId]);

  const closeTab = useCallback((panelId = activePanelId, tabId?: string) => {
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
  }, [activePanelId]);

  const navigateTo = useCallback((panelId: PanelId, path: string) => {
    setSession((previous) =>
      previous
        ? updateActiveTab(previous, panelId, (tab) => navigateTab(tab, path))
        : previous,
    );
  }, []);

  const goParent = useCallback((panelId = activePanelId) => {
    if (!session) {
      return;
    }

    const tab = activeTab(session[panelId]);
    const listing = listings[tab.id];
    if (listing?.parent) {
      navigateTo(panelId, listing.parent);
    }
  }, [activePanelId, listings, navigateTo, session]);

  const syncActivePanelToOpposite = useCallback(() => {
    if (!session) {
      return;
    }

    const panelId = session.activePanel;
    const sourcePanelId = oppositePanel(panelId);
    const currentTab = activeTab(session[panelId]);
    const sourceTab = activeTab(session[sourcePanelId]);

    if (currentTab.path !== sourceTab.path) {
      navigateTo(panelId, sourceTab.path);
    }
  }, [navigateTo, session]);

  const selectPath = useCallback(
    (panelId: PanelId, path: string, additive: boolean) => {
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
    [],
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
      setSession((previous) =>
        previous
          ? updateActiveTab(previous, panelId, (current) => ({
              ...current,
              selectedPaths: [nextPath],
            }))
          : previous,
      );
    },
    [listings, session],
  );

  const moveSelection = useCallback(
    (delta: number) => {
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
    [listings, selectEntryByIndex, session],
  );

  const moveSelectionPage = useCallback(
    (direction: 1 | -1) => {
      moveSelection(direction * getActivePanelPageSize());
    },
    [moveSelection],
  );

  const selectFirstRow = useCallback(() => {
    selectEntryByIndex(0);
  }, [selectEntryByIndex]);

  const selectLastRow = useCallback(() => {
    if (!session) {
      return;
    }

    const tab = activeTab(session[session.activePanel]);
    const entries = listings[tab.id]?.entries ?? [];
    selectEntryByIndex(entries.length - 1);
  }, [listings, selectEntryByIndex, session]);

  const openEntry = useCallback(
    async (panelId: PanelId, entry: FileEntry) => {
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
    [navigateTo, reportNotice, setActivePanel],
  );

  const openSelected = useCallback(() => {
    if (!session) {
      return;
    }
    const tab = activeTab(session[session.activePanel]);
    const listing = listings[tab.id];
    const entry = findSelectedEntry(tab, listing);
    if (entry) {
      void openEntry(session.activePanel, entry);
    }
  }, [listings, openEntry, session]);

  const openFolderInNewTab = useCallback((panelId: PanelId, path: string) => {
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
  }, []);

  const openSelectedInNewTab = useCallback(() => {
    if (!session) {
      return;
    }

    const panelId = session.activePanel;
    const tab = activeTab(session[panelId]);
    const entry = findSelectedEntry(tab, listings[tab.id] ?? null);
    if (entry?.isDir) {
      openFolderInNewTab(panelId, entry.path);
    }
  }, [listings, openFolderInNewTab, session]);

  const openEntryContextMenu = useCallback(
    (panelId: PanelId, entry: FileEntry, position: { x: number; y: number }) => {
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
    [setActivePanel],
  );

  const revealEntry = useCallback(
    async (entry: FileEntry) => {
      setContextMenu(null);
      try {
        await revealPath(entry.path);
      } catch (error) {
        reportNotice(errorToMessage(error));
      }
    },
    [reportNotice],
  );

  const runTransfer = useCallback(
    async (mode: "copy" | "move") => {
      if (!session) {
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
        return;
      }

      try {
        const report =
          mode === "copy"
            ? await copyItems(items, destinationTab.path, strategy)
            : await moveItems(items, destinationTab.path, strategy);
        reportNotice(describeReport(report.results));
        await refreshVisiblePanels();
      } catch (error) {
        reportNotice(errorToMessage(error));
      }
    },
    [listings, refreshVisiblePanels, reportNotice, session],
  );

  const trashSelected = useCallback(async () => {
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
      return;
    }

    try {
      const report = await moveToTrash(selectedPaths);
      reportNotice(describeReport(report.results));
      await refreshPanel(session.activePanel);
    } catch (error) {
      reportNotice(errorToMessage(error));
    }
  }, [listings, refreshPanel, reportNotice, session, trashName]);

  const deleteSelectedPermanently = useCallback(async () => {
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
      return;
    }

    try {
      const report = await permanentlyDelete(selectedPaths);
      reportNotice(describeReport(report.results));
      await refreshPanel(session.activePanel);
    } catch (error) {
      reportNotice(errorToMessage(error));
    }
  }, [listings, refreshPanel, reportNotice, session]);

  const renameSelected = useCallback(() => {
    if (!session) {
      return;
    }
    const panelId = session.activePanel;
    const tab = activeTab(session[panelId]);
    const listing = listings[tab.id] ?? null;
    const selectedPaths = visibleSelectedPaths(tab, listing);
    const entry = findSelectedEntry(tab, listing);
    if (selectedPaths.length !== 1 || !entry) {
      reportNotice("Select exactly one item to rename.");
      return;
    }

    setRenameState({ panelId, path: entry.path, name: entry.name });
    reportNotice(null);
  }, [listings, reportNotice, session]);

  const commitRename = useCallback(async () => {
    if (!renameState) {
      return;
    }

    const current = renameState;
    const nextName = current.name.trim();
    setRenameState(null);

    if (!nextName || nextName === basename(current.path)) {
      return;
    }

    try {
      const nextPath = await renameItem(current.path, nextName);
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
      reportNotice(errorToMessage(error));
    }
  }, [refreshPanel, renameState, reportNotice]);

  const createFolderInPanel = useCallback(async (panelId = activePanelId) => {
    if (!session) {
      return;
    }

    const tab = activeTab(session[panelId]);
    const name = nextNewFolderName(listings[tab.id]?.entries ?? []);

    try {
      const path = await createFolder(tab.path, name);
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
      reportNotice(errorToMessage(error));
    }
  }, [activePanelId, listings, refreshPanel, reportNotice, session]);

  const previewSelected = useCallback(async () => {
    if (!session) {
      return;
    }
    const tab = activeTab(session[session.activePanel]);
    const entry = findSelectedEntry(tab, listings[tab.id] ?? null);
    if (!entry) {
      reportNotice("Select an item to preview.");
      return;
    }

    try {
      await previewPath(entry.path);
      reportNotice(null);
    } catch (error) {
      reportNotice(errorToMessage(error));
    }
  }, [listings, reportNotice, session]);

  const toggleHiddenFiles = useCallback(() => {
    setSession((previous) =>
      previous
        ? {
            ...previous,
            showHiddenFiles: !previous.showHiddenFiles,
          }
        : previous,
    );
  }, []);

  const shortcutHandlers = useMemo(
    () => ({
      openSelected,
      renameSelected: () => void renameSelected(),
      goParent,
      switchPanel,
      newTab,
      closeTab,
      createFolder: () => void createFolderInPanel(),
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
        <div className="initializing">Opening LittleCommander...</div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-bar">
        <div className="brand">LittleCommander</div>
        <div className="global-actions">
          <IconButton label="Copy to opposite panel" showLabel onClick={() => void runTransfer("copy")}>
            <Copy size={16} />
          </IconButton>
          <IconButton label="Move to opposite panel" showLabel onClick={() => void runTransfer("move")}>
            <MoveRight size={16} />
          </IconButton>
          <IconButton
            label={`Match opposite panel folder (${syncShortcut})`}
            onClick={syncActivePanelToOpposite}
          >
            <FolderSync size={16} />
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
          <button type="button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="workspace">
        <div className="panels">
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
            onRenameCancel={() => setRenameState(null)}
          />
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
            onRenameCancel={() => setRenameState(null)}
          />
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
