export type PanelId = "left" | "right";

export type ConflictStrategy = "replace" | "skip" | "rename";

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
  window: WindowSession | null;
}

export interface CommandError {
  kind?: string;
  message?: string;
}
