import { invoke } from "@tauri-apps/api/core";
import type {
  ActionLogDetails,
  ConflictStrategy,
  DirectoryListing,
  OperationReport,
  SessionData,
  TerminalCommandResult,
} from "./types";

const BROWSER_BACKEND_MESSAGE =
  "Desktop filesystem commands are unavailable in browser preview. Run the app with pnpm tauri:dev to use local files.";

function hasTauriBackend(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriBackend()) {
    throw new Error(BROWSER_BACKEND_MESSAGE);
  }

  return invoke<T>(command, args);
}

export async function getHomeDir(): Promise<string> {
  if (!hasTauriBackend()) {
    return "/";
  }

  return invokeDesktop("home_dir");
}

export async function listDirectory(
  path: string,
  showHiddenFiles: boolean,
): Promise<DirectoryListing> {
  return invokeDesktop("list_directory", { path, showHiddenFiles });
}

export async function watchDirectories(paths: string[]): Promise<string[]> {
  if (!hasTauriBackend()) {
    return paths;
  }

  return invokeDesktop("watch_directories", { paths });
}

export async function copyItems(
  items: string[],
  destinationDir: string,
  conflictStrategy: ConflictStrategy,
): Promise<OperationReport> {
  return invokeDesktop("copy_items", { items, destinationDir, conflictStrategy });
}

export async function moveItems(
  items: string[],
  destinationDir: string,
  conflictStrategy: ConflictStrategy,
): Promise<OperationReport> {
  return invokeDesktop("move_items", { items, destinationDir, conflictStrategy });
}

export async function moveToTrash(items: string[]): Promise<OperationReport> {
  return invokeDesktop("move_to_trash", { items });
}

export async function permanentlyDelete(items: string[]): Promise<OperationReport> {
  return invokeDesktop("permanently_delete", { items });
}

export async function openPath(path: string): Promise<void> {
  return invokeDesktop("open_path", { path });
}

export async function previewPath(path: string): Promise<void> {
  return invokeDesktop("preview_path", { path });
}

export async function revealPath(path: string): Promise<void> {
  return invokeDesktop("reveal_path", { path });
}

export async function renameItem(path: string, newName: string): Promise<string> {
  return invokeDesktop("rename_item", { path, newName });
}

export async function createFolder(parentDir: string, name: string): Promise<string> {
  return invokeDesktop("create_folder", { parentDir, name });
}

export async function runTerminalCommand(
  command: string,
  cwd: string,
): Promise<TerminalCommandResult> {
  return invokeDesktop("run_terminal_command", { command, cwd });
}

export async function startTerminalSession(
  cwd: string,
  cols: number,
  rows: number,
): Promise<string> {
  return invokeDesktop("start_terminal_session", { cwd, cols, rows });
}

export async function writeTerminalData(
  sessionId: string,
  data: string,
): Promise<void> {
  return invokeDesktop("write_terminal_data", { sessionId, data });
}

export async function resizeTerminalSession(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invokeDesktop("resize_terminal_session", { sessionId, cols, rows });
}

export async function stopTerminalSession(sessionId: string): Promise<void> {
  return invokeDesktop("stop_terminal_session", { sessionId });
}

export async function resolveTerminalDirectory(
  cwd: string,
  target: string,
): Promise<string> {
  return invokeDesktop("resolve_terminal_directory", { cwd, target });
}

export async function loadSession(): Promise<SessionData | null> {
  if (!hasTauriBackend()) {
    return null;
  }

  return invokeDesktop("load_session");
}

export async function saveSession(session: SessionData): Promise<void> {
  if (!hasTauriBackend()) {
    return;
  }

  return invokeDesktop("save_session", { session });
}

export async function logAction(
  action: string,
  details: ActionLogDetails = {},
): Promise<void> {
  if (!hasTauriBackend()) {
    return;
  }

  return invokeDesktop("append_action_log", { action, details });
}
