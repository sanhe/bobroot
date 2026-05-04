import { invoke } from "@tauri-apps/api/core";
import type {
  ActionLogDetails,
  ConflictStrategy,
  DirectoryListing,
  OperationReport,
  SessionData,
  TerminalCommandResult,
} from "./types";

export async function getHomeDir(): Promise<string> {
  return invoke("home_dir");
}

export async function listDirectory(
  path: string,
  showHiddenFiles: boolean,
): Promise<DirectoryListing> {
  return invoke("list_directory", { path, showHiddenFiles });
}

export async function copyItems(
  items: string[],
  destinationDir: string,
  conflictStrategy: ConflictStrategy,
): Promise<OperationReport> {
  return invoke("copy_items", { items, destinationDir, conflictStrategy });
}

export async function moveItems(
  items: string[],
  destinationDir: string,
  conflictStrategy: ConflictStrategy,
): Promise<OperationReport> {
  return invoke("move_items", { items, destinationDir, conflictStrategy });
}

export async function moveToTrash(items: string[]): Promise<OperationReport> {
  return invoke("move_to_trash", { items });
}

export async function permanentlyDelete(items: string[]): Promise<OperationReport> {
  return invoke("permanently_delete", { items });
}

export async function openPath(path: string): Promise<void> {
  return invoke("open_path", { path });
}

export async function previewPath(path: string): Promise<void> {
  return invoke("preview_path", { path });
}

export async function revealPath(path: string): Promise<void> {
  return invoke("reveal_path", { path });
}

export async function renameItem(path: string, newName: string): Promise<string> {
  return invoke("rename_item", { path, newName });
}

export async function createFolder(parentDir: string, name: string): Promise<string> {
  return invoke("create_folder", { parentDir, name });
}

export async function runTerminalCommand(
  command: string,
  cwd: string,
): Promise<TerminalCommandResult> {
  return invoke("run_terminal_command", { command, cwd });
}

export async function resolveTerminalDirectory(
  cwd: string,
  target: string,
): Promise<string> {
  return invoke("resolve_terminal_directory", { cwd, target });
}

export async function loadSession(): Promise<SessionData | null> {
  return invoke("load_session");
}

export async function saveSession(session: SessionData): Promise<void> {
  return invoke("save_session", { session });
}

export async function logAction(
  action: string,
  details: ActionLogDetails = {},
): Promise<void> {
  return invoke("append_action_log", { action, details });
}
