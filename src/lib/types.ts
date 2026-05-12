export type PanelId = "left" | "right";

export type PanelRef = PanelId | "terminal" | "agent";

export type SplitDirection = "row" | "column";

export type LayoutNode =
  | { kind: "leaf"; ref: PanelRef }
  | {
      kind: "split";
      direction: SplitDirection;
      children: LayoutNode[];
      sizes: number[];
    };

export type ConflictStrategy = "replace" | "skip" | "rename";

export type ActionLogDetails = Record<string, unknown>;

export interface LayoutChangeDetails extends ActionLogDetails {
  reason: "drag" | "resize" | "programmatic";
  log?: boolean;
}

export type FormatFilter = "all" | "folders" | "noExtension" | `extension:${string}`;

export interface FormatFilterOption {
  value: FormatFilter;
  label: string;
  count: number;
}

export type FilePropertyKey = "size" | "modified" | "kind";

export type FilePropertyVisibility = Record<FilePropertyKey, boolean>;

export const DEFAULT_FILE_PROPERTY_VISIBILITY: FilePropertyVisibility = {
  size: true,
  modified: true,
  kind: false,
};

export type TerminalTheme = "dark" | "light";

export interface TerminalAppearance {
  theme: TerminalTheme;
  fontSize: number;
}

export const DEFAULT_TERMINAL_APPEARANCE: TerminalAppearance = {
  theme: "dark",
  fontSize: 12,
};

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isFile: boolean;
  isSymlink: boolean;
  isHidden: boolean;
  size: number | null;
  modified: number | null;
  extension: string | null;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  showHiddenFiles: boolean;
  entries: FileEntry[];
}

export interface OperationItemResult {
  source: string;
  destination: string | null;
  status: "copied" | "moved" | "trashed" | "deleted" | "skipped" | "error";
  message: string | null;
}

export interface OperationReport {
  results: OperationItemResult[];
}

export interface TerminalCommandResult {
  cwd: string;
  command: string;
  stdout: string;
  stderr: string;
  status: number | null;
  durationMs: number;
}

export interface TabState {
  id: string;
  path: string;
  selectedPaths: string[];
  history: string[];
  historyIndex: number;
}

export interface PanelState {
  tabs: TabState[];
  activeTabId: string;
}

export interface WindowSession {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
}

export interface SessionData {
  left: PanelState;
  right: PanelState;
  activePanel: PanelId;
  showHiddenFiles: boolean;
  layout: LayoutNode;
  visibility: Record<PanelRef, boolean>;
  filePropertyVisibility: FilePropertyVisibility;
  terminalAppearance: TerminalAppearance;
  window: WindowSession | null;
}

export interface CommandError {
  kind?: string;
  message?: string;
}
