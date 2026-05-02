import {
  ArrowUp,
  File,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { basename, displayPath, formatBytes, formatDate } from "../lib/format";
import type { DirectoryListing, FileEntry, PanelId, PanelState } from "../lib/types";
import { activeTab } from "../lib/tabState";
import { IconButton } from "./IconButton";

interface FilePanelProps {
  panelId: PanelId;
  panel: PanelState;
  listing: DirectoryListing | null;
  loading: boolean;
  isActive: boolean;
  onActivate: (panelId: PanelId) => void;
  onSwitchTab: (panelId: PanelId, tabId: string) => void;
  onNewTab: (panelId: PanelId) => void;
  onCloseTab: (panelId: PanelId, tabId: string) => void;
  onGoParent: (panelId: PanelId) => void;
  onRefresh: (panelId: PanelId) => void;
  onSelect: (panelId: PanelId, path: string, additive: boolean) => void;
  onOpenEntry: (panelId: PanelId, entry: FileEntry) => void;
  onEntryContextMenu: (
    panelId: PanelId,
    entry: FileEntry,
    position: { x: number; y: number },
  ) => void;
  onCreateFolder: (panelId: PanelId) => void;
}

export function FilePanel({
  panelId,
  panel,
  listing,
  loading,
  isActive,
  onActivate,
  onSwitchTab,
  onNewTab,
  onCloseTab,
  onGoParent,
  onRefresh,
  onSelect,
  onOpenEntry,
  onEntryContextMenu,
  onCreateFolder,
}: FilePanelProps) {
  const tab = activeTab(panel);
  const selected = new Set(tab.selectedPaths);
  const highlightedPath = tab.selectedPaths[0] ?? null;
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!isActive || !highlightedPath) {
      return;
    }

    rowRefs.current.get(highlightedPath)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [highlightedPath, isActive, listing?.entries]);

  return (
    <section
      className={`file-panel ${isActive ? "active" : ""}`}
      onMouseDown={() => onActivate(panelId)}
    >
      <div className="tab-strip" role="tablist" aria-label={`${panelId} panel tabs`}>
        {panel.tabs.map((panelTab) => (
          <button
            className={`tab-button ${panelTab.id === panel.activeTabId ? "selected" : ""}`}
            key={panelTab.id}
            onClick={() => onSwitchTab(panelId, panelTab.id)}
            role="tab"
            type="button"
          >
            <HardDrive size={14} />
            <span>{basename(panelTab.path)}</span>
            {panel.tabs.length > 1 ? (
              <span
                className="tab-close"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(panelId, panelTab.id);
                }}
              >
                <X size={12} />
              </span>
            ) : null}
          </button>
        ))}
        <IconButton label="New tab" onClick={() => onNewTab(panelId)}>
          <Plus size={16} />
        </IconButton>
      </div>

      <div className="panel-toolbar">
        <IconButton label="Parent folder" onClick={() => onGoParent(panelId)}>
          <ArrowUp size={16} />
        </IconButton>
        <IconButton label="Refresh" onClick={() => onRefresh(panelId)}>
          <RefreshCw size={16} />
        </IconButton>
        <IconButton label="New folder" onClick={() => onCreateFolder(panelId)}>
          <FolderPlus size={16} />
        </IconButton>
        <div className="path-label" title={tab.path}>
          {displayPath(listing?.path ?? tab.path)}
        </div>
      </div>

      <div className="file-table" role="table" aria-label={`${panelId} files`}>
        <div className="file-row table-header" role="row">
          <div>Name</div>
          <div>Size</div>
          <div>Modified</div>
        </div>
        <div className="file-list">
          {loading ? <div className="empty-state">Loading...</div> : null}
          {!loading && listing?.entries.length === 0 ? (
            <div className="empty-state">Empty folder</div>
          ) : null}
          {!loading
            ? listing?.entries.map((entry) => (
                <FileRow
                  entry={entry}
                  key={entry.path}
                  rowRef={(element) => {
                    if (element) {
                      rowRefs.current.set(entry.path, element);
                    } else {
                      rowRefs.current.delete(entry.path);
                    }
                  }}
                  selected={selected.has(entry.path)}
                  onClick={(event) =>
                    onSelect(panelId, entry.path, event.metaKey || event.ctrlKey)
                  }
                  onDoubleClick={() => onOpenEntry(panelId, entry)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onEntryContextMenu(panelId, entry, {
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                />
              ))
            : null}
        </div>
      </div>
    </section>
  );
}

interface FileRowProps {
  entry: FileEntry;
  rowRef: (element: HTMLButtonElement | null) => void;
  selected: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick: () => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}

function FileRow({
  entry,
  rowRef,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
}: FileRowProps) {
  const icon = entry.isDir ? (
    <Folder size={17} />
  ) : entry.extension === "pdf" ? (
    <FileText size={17} />
  ) : (
    <File size={17} />
  );

  return (
    <button
      className={`file-row ${selected ? "selected" : ""}`}
      ref={rowRef}
      aria-selected={selected}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      role="row"
      type="button"
    >
      <div className="file-name">
        <span className={`file-icon ${entry.isDir ? "folder" : ""}`}>{icon}</span>
        <span className="name-text">{entry.name}</span>
      </div>
      <div className="file-size">{entry.isDir ? "--" : formatBytes(entry.size)}</div>
      <div className="file-modified">{formatDate(entry.modified)}</div>
    </button>
  );
}
