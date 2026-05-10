import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  File,
  FileText,
  Folder,
  FolderPlus,
  GripVertical,
  HardDrive,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";
import { basename, formatBytes, formatDate } from "../lib/format";
import type { AppPlatform } from "../lib/platform";
import type { DirectoryListing, FileEntry, PanelId, PanelState } from "../lib/types";
import { activeTab } from "../lib/tabState";
import { IconButton } from "./IconButton";
import type { LayoutDragHandlers } from "./Layout";

interface FilePanelProps {
  panelId: PanelId;
  panel: PanelState;
  listing: DirectoryListing | null;
  loading: boolean;
  isActive: boolean;
  platform: AppPlatform;
  onActivate: (panelId: PanelId) => void;
  onSwitchTab: (panelId: PanelId, tabId: string) => void;
  onNewTab: (panelId: PanelId) => void;
  onCloseTab: (panelId: PanelId, tabId: string) => void;
  onGoBack: (panelId: PanelId) => void;
  onGoForward: (panelId: PanelId) => void;
  onGoParent: (panelId: PanelId) => void;
  onRefresh: (panelId: PanelId) => void;
  onSelect: (panelId: PanelId, path: string, additive: boolean) => void;
  onOpenEntry: (panelId: PanelId, entry: FileEntry) => void;
  onEntryDragStart: (
    panelId: PanelId,
    entry: FileEntry,
    event: DragEvent<HTMLDivElement>,
  ) => void;
  onEntryContextMenu: (
    panelId: PanelId,
    entry: FileEntry,
    position: { x: number; y: number },
  ) => void;
  onNavigateToPath: (panelId: PanelId, path: string) => void;
  onCreateFolder: (panelId: PanelId) => void;
  renamingPath: string | null;
  renamingName: string;
  onRenameChange: (name: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  dragHandlers: LayoutDragHandlers;
}

export function FilePanel({
  panelId,
  panel,
  listing,
  loading,
  isActive,
  platform,
  onActivate,
  onSwitchTab,
  onNewTab,
  onCloseTab,
  onGoBack,
  onGoForward,
  onGoParent,
  onRefresh,
  onSelect,
  onOpenEntry,
  onEntryDragStart,
  onEntryContextMenu,
  onNavigateToPath,
  onCreateFolder,
  renamingPath,
  renamingName,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  dragHandlers,
}: FilePanelProps) {
  const tab = activeTab(panel);
  const selected = new Set(tab.selectedPaths);
  const highlightedPath = tab.selectedPaths[0] ?? null;
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

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
        <button
          aria-label="Move panel"
          className="layout-drag-handle"
          onPointerDown={dragHandlers.onPointerDown}
          title="Drag to move this panel"
          type="button"
        >
          <GripVertical size={14} />
        </button>
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
        <IconButton
          disabled={tab.historyIndex <= 0}
          label="Back"
          onClick={() => onGoBack(panelId)}
        >
          <ArrowLeft size={16} />
        </IconButton>
        <IconButton
          disabled={tab.historyIndex >= tab.history.length - 1}
          label="Forward"
          onClick={() => onGoForward(panelId)}
        >
          <ArrowRight size={16} />
        </IconButton>
        <IconButton label="Parent folder" onClick={() => onGoParent(panelId)}>
          <ArrowUp size={16} />
        </IconButton>
        <IconButton label="Refresh" onClick={() => onRefresh(panelId)}>
          <RefreshCw size={16} />
        </IconButton>
        <IconButton label="New folder" onClick={() => onCreateFolder(panelId)}>
          <FolderPlus size={16} />
        </IconButton>
        <PathLabel
          path={listing?.path ?? tab.path}
          platform={platform}
          onNavigate={(path) => onNavigateToPath(panelId, path)}
        />
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
                  isRenaming={entry.path === renamingPath}
                  renamingName={renamingName}
                  onClick={(event) =>
                    onSelect(panelId, entry.path, event.metaKey || event.ctrlKey)
                  }
                  onDoubleClick={() => onOpenEntry(panelId, entry)}
                  onDragStart={(event) => onEntryDragStart(panelId, entry, event)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onEntryContextMenu(panelId, entry, {
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onRenameChange={onRenameChange}
                  onRenameCommit={onRenameCommit}
                  onRenameCancel={onRenameCancel}
                />
              ))
            : null}
        </div>
      </div>
    </section>
  );
}

interface PathLabelProps {
  path: string;
  platform: AppPlatform;
  onNavigate: (path: string) => void;
}

interface PathSegment {
  label: string;
  path: string;
  separatorBefore: string;
}

function PathLabel({ path, platform, onNavigate }: PathLabelProps) {
  const segments = pathSegments(path);
  const modifierLabel = platform === "macos" ? "Cmd-click" : "Ctrl-click";
  const [modifierPressed, setModifierPressed] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      setModifierPressed(platform === "macos" ? event.metaKey : event.ctrlKey);
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      setModifierPressed(platform === "macos" ? event.metaKey : event.ctrlKey);
    };
    const resetModifier = () => setModifierPressed(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", resetModifier);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", resetModifier);
    };
  }, [platform]);

  const onSegmentClick = (
    event: MouseEvent<HTMLSpanElement>,
    segmentPath: string,
  ) => {
    const modifierPressed = platform === "macos" ? event.metaKey : event.ctrlKey;
    if (!modifierPressed) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onNavigate(segmentPath);
  };

  return (
    <div
      className={`path-label ${modifierPressed ? "modifier-active" : ""}`}
      title={`${path}\n${modifierLabel} a folder to open it`}
    >
      {segments.map((segment, index) => (
        <span key={`${segment.path}-${index}`}>
          {segment.separatorBefore}
          <span
            className="path-segment"
            onClick={(event) => onSegmentClick(event, segment.path)}
            title={`${modifierLabel} to open ${segment.path}`}
          >
            {segment.label}
          </span>
        </span>
      ))}
    </div>
  );
}

function pathSegments(path: string): PathSegment[] {
  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";

  if (separator === "\\") {
    return windowsPathSegments(path);
  }

  return posixPathSegments(path);
}

function posixPathSegments(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const isAbsolute = path.startsWith("/");
  const parts = path.split("/").filter(Boolean);
  let currentPath = isAbsolute ? "/" : "";

  if (isAbsolute) {
    segments.push({ label: "/", path: "/", separatorBefore: "" });
  }

  for (const part of parts) {
    currentPath =
      currentPath === "" || currentPath === "/"
        ? `${currentPath}${part}`
        : `${currentPath}/${part}`;
    segments.push({
      label: part,
      path: currentPath,
      separatorBefore: segments.length === 0 || currentPath === `/${part}` ? "" : "/",
    });
  }

  return segments.length > 0 ? segments : [{ label: path, path, separatorBefore: "" }];
}

function windowsPathSegments(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const driveMatch = path.match(/^[A-Za-z]:/);
  const rawParts = path.split("\\").filter(Boolean);
  let parts = rawParts;
  let currentPath = "";

  if (driveMatch) {
    const drive = driveMatch[0];
    currentPath = `${drive}\\`;
    segments.push({ label: drive, path: currentPath, separatorBefore: "" });
    parts = rawParts.slice(rawParts[0] === drive ? 1 : 0);
  }

  for (const part of parts) {
    currentPath =
      currentPath === "" || currentPath.endsWith("\\")
        ? `${currentPath}${part}`
        : `${currentPath}\\${part}`;
    segments.push({
      label: part,
      path: currentPath,
      separatorBefore: segments.length === 0 ? "" : "\\",
    });
  }

  return segments.length > 0 ? segments : [{ label: path, path, separatorBefore: "" }];
}

interface FileRowProps {
  entry: FileEntry;
  rowRef: (element: HTMLDivElement | null) => void;
  selected: boolean;
  isRenaming: boolean;
  renamingName: string;
  onClick: (event: MouseEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onRenameChange: (name: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}

function FileRow({
  entry,
  rowRef,
  selected,
  isRenaming,
  renamingName,
  onClick,
  onDoubleClick,
  onDragStart,
  onContextMenu,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: FileRowProps) {
  const renameInputRef = useRef<HTMLInputElement>(null);
  const icon = entry.isDir ? (
    <Folder size={17} />
  ) : entry.extension === "pdf" ? (
    <FileText size={17} />
  ) : (
    <File size={17} />
  );

  useEffect(() => {
    if (!isRenaming) {
      return;
    }

    const input = renameInputRef.current;
    input?.focus();
    input?.select();
  }, [isRenaming]);

  const onRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      onRenameCommit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onRenameCancel();
    }
  };

  return (
    <div
      className={`file-row ${selected ? "selected" : ""}`}
      ref={rowRef}
      aria-selected={selected}
      data-file-name={entry.name}
      data-testid="file-row"
      draggable={!isRenaming}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      onDragStart={onDragStart}
      role="row"
    >
      <div className="file-name">
        <span className={`file-icon ${entry.isDir ? "folder" : ""}`}>{icon}</span>
        {isRenaming ? (
          <input
            aria-label="Rename item"
            className="rename-input"
            data-testid="rename-input"
            onBlur={onRenameCancel}
            onChange={(event) => onRenameChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={onRenameKeyDown}
            onMouseDown={(event) => event.stopPropagation()}
            ref={renameInputRef}
            value={renamingName}
          />
        ) : (
          <span className="name-text">{entry.name}</span>
        )}
      </div>
      <div className="file-size">{entry.isDir ? "--" : formatBytes(entry.size)}</div>
      <div className="file-modified">{formatDate(entry.modified)}</div>
    </div>
  );
}
