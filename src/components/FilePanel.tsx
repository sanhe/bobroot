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
  ListFilter,
  Plus,
  RefreshCw,
  TableProperties,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  Dispatch,
  DragEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  RefObject,
  SetStateAction,
} from "react";
import { basename, formatBytes, formatDate } from "../lib/format";
import type { AppPlatform } from "../lib/platform";
import type {
  DirectoryListing,
  FileEntry,
  FilePropertyKey,
  FilePropertyVisibility,
  FormatFilter,
  FormatFilterOption,
  PanelId,
  PanelState,
} from "../lib/types";
import { activeTab } from "../lib/tabState";
import { IconButton } from "./IconButton";
import type { LayoutDragHandlers } from "./Layout";

interface FilePanelProps {
  panelId: PanelId;
  panel: PanelState;
  listing: DirectoryListing | null;
  formatFilter: FormatFilter;
  formatOptions: FormatFilterOption[];
  visibleProperties: FilePropertyVisibility;
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
  onFormatFilterChange: (panelId: PanelId, filter: FormatFilter) => void;
  onFilePropertyVisibilityChange: (property: FilePropertyKey, visible: boolean) => void;
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
  formatFilter,
  formatOptions,
  visibleProperties,
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
  onFormatFilterChange,
  onFilePropertyVisibilityChange,
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
  const tableRef = useRef<HTMLDivElement>(null);
  const propertyMenuRef = useRef<HTMLDivElement>(null);
  const [propertyMenuOpen, setPropertyMenuOpen] = useState(false);
  const [columnFractions, setColumnFractions] = useState<FileColumnFractions>({
    name: 4,
    size: 1.1,
    modified: 1.8,
    kind: 0.9,
  });
  const visibleColumns = useMemo<FileColumnKey[]>(
    () => [
      "name",
      ...FILE_PROPERTY_OPTIONS.filter((option) => visibleProperties[option.key]).map(
        (option) => option.key,
      ),
    ],
    [visibleProperties],
  );
  const gridTemplateColumns = useMemo(
    () =>
      visibleColumns
        .map(
          (column) =>
            `minmax(${GRID_COLUMN_MIN_WIDTHS[column]}px, ${columnFractions[column]}fr)`,
        )
        .join(" "),
    [columnFractions, visibleColumns],
  );

  useEffect(() => {
    if (!propertyMenuOpen) {
      return;
    }

    const closeOnOutsidePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && propertyMenuRef.current?.contains(target)) {
        return;
      }
      setPropertyMenuOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setPropertyMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [propertyMenuOpen]);

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
            title={panelTab.path}
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
        <div className="property-menu" ref={propertyMenuRef}>
          <IconButton
            aria-expanded={propertyMenuOpen}
            aria-haspopup="menu"
            className={propertyMenuOpen ? "pressed" : ""}
            label="File properties"
            onClick={(event) => {
              event.stopPropagation();
              setPropertyMenuOpen((open) => !open);
            }}
          >
            <TableProperties size={16} />
          </IconButton>
          {propertyMenuOpen ? (
            <div
              className="property-menu-popover"
              onClick={(event) => event.stopPropagation()}
              role="menu"
            >
              {FILE_PROPERTY_OPTIONS.map((option) => (
                <label
                  aria-checked={visibleProperties[option.key]}
                  className="property-menu-option"
                  key={option.key}
                  role="menuitemcheckbox"
                >
                  <input
                    checked={visibleProperties[option.key]}
                    onChange={(event) =>
                      onFilePropertyVisibilityChange(option.key, event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <label className="format-filter" title="Filter visible file format">
          <ListFilter size={14} />
          <select
            aria-label="File format filter"
            onChange={(event) =>
              onFormatFilterChange(panelId, event.target.value as FormatFilter)
            }
            value={formatFilter}
          >
            {formatOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {formatOptionLabel(option)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        className="file-table"
        ref={tableRef}
        role="table"
        aria-label={`${panelId} files`}
        style={{ "--file-grid-columns": gridTemplateColumns } as FileTableStyle}
      >
        <div className="file-row table-header" role="row">
          {visibleColumns.map((column, index) => (
            <div className="table-header-cell" key={column}>
              {columnLabel(column)}
              {index < visibleColumns.length - 1 ? (
                <ColumnResizeHandle
                  label={`Resize ${columnLabel(column).toLowerCase()} column`}
                  onPointerDown={(event) =>
                    startColumnResize(
                      event,
                      tableRef,
                      columnFractions,
                      setColumnFractions,
                      visibleColumns,
                      column,
                      visibleColumns[index + 1],
                    )
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
        <div className="file-list">
          {loading ? <div className="empty-state">Loading...</div> : null}
          {!loading && listing?.entries.length === 0 ? (
            <div className="empty-state">
              {formatFilter === "all" ? "Empty folder" : "No items match this format"}
            </div>
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
                  visibleProperties={visibleProperties}
                />
              ))
            : null}
        </div>
      </div>
    </section>
  );
}

function formatOptionLabel(option: FormatFilterOption): string {
  return `${option.label} (${option.count})`;
}

type FileColumnKey = "name" | FilePropertyKey;

type FileColumnFractions = Record<FileColumnKey, number>;

type FileTableStyle = CSSProperties & {
  "--file-grid-columns": string;
};

const MIN_COLUMN_WIDTHS: Record<FileColumnKey, number> = {
  name: 140,
  size: 64,
  modified: 104,
  kind: 86,
};

const GRID_COLUMN_MIN_WIDTHS: Record<FileColumnKey, number> = {
  name: 0,
  size: 64,
  modified: 104,
  kind: 86,
};

const FILE_PROPERTY_OPTIONS: Array<{ key: FilePropertyKey; label: string }> = [
  { key: "size", label: "Size" },
  { key: "modified", label: "Modified" },
  { key: "kind", label: "Kind" },
];

function columnLabel(column: FileColumnKey): string {
  if (column === "name") {
    return "Name";
  }

  return FILE_PROPERTY_OPTIONS.find((option) => option.key === column)?.label ?? column;
}

function ColumnResizeHandle({
  label,
  onPointerDown,
}: {
  label: string;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-label={label}
      className="column-resize-handle"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={onPointerDown}
      role="separator"
      type="button"
    />
  );
}

function startColumnResize(
  event: PointerEvent<HTMLButtonElement>,
  tableRef: RefObject<HTMLDivElement | null>,
  fractions: FileColumnFractions,
  setFractions: Dispatch<SetStateAction<FileColumnFractions>>,
  activeColumns: FileColumnKey[],
  before: FileColumnKey,
  after: FileColumnKey,
) {
  event.preventDefault();
  event.stopPropagation();

  const tableWidth = tableRef.current?.getBoundingClientRect().width ?? 0;
  if (tableWidth <= 0) {
    return;
  }

  const startX = event.clientX;
  const startFractions = { ...fractions };
  const fractionTotal = activeColumns.reduce(
    (total, column) => total + startFractions[column],
    0,
  );
  const combined = startFractions[before] + startFractions[after];
  const minBefore = (MIN_COLUMN_WIDTHS[before] / tableWidth) * fractionTotal;
  const minAfter = (MIN_COLUMN_WIDTHS[after] / tableWidth) * fractionTotal;

  const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
    const deltaFraction = ((moveEvent.clientX - startX) / tableWidth) * fractionTotal;
    const nextBefore = Math.min(
      Math.max(startFractions[before] + deltaFraction, minBefore),
      combined - minAfter,
    );
    const nextAfter = combined - nextBefore;
    setFractions({
      ...startFractions,
      [before]: nextBefore,
      [after]: nextAfter,
    });
  };

  const onPointerUp = () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
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
  visibleProperties: FilePropertyVisibility;
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
  visibleProperties,
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
          <span className="name-text" title={entry.name}>
            {entry.name}
          </span>
        )}
      </div>
      {visibleProperties.size ? (
        <div className="file-size">{entry.isDir ? "--" : formatBytes(entry.size)}</div>
      ) : null}
      {visibleProperties.modified ? (
        <div className="file-modified">{formatDate(entry.modified)}</div>
      ) : null}
      {visibleProperties.kind ? <div className="file-kind">{formatKind(entry)}</div> : null}
    </div>
  );
}

function formatKind(entry: FileEntry): string {
  if (entry.isSymlink) {
    return "Symlink";
  }
  if (entry.isDir) {
    return "Folder";
  }
  if (entry.extension) {
    return entry.extension.toUpperCase();
  }
  if (entry.isFile) {
    return "File";
  }
  return "Item";
}
