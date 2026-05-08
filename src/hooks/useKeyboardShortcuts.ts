import { useEffect, useRef } from "react";
import { currentPlatform } from "../lib/platform";

interface ShortcutHandlers {
  openSelected: () => void;
  renameSelected: () => void;
  goParent: () => void;
  switchPanel: () => void;
  newTab: () => void;
  closeTab: () => void;
  createFolder: () => void;
  copySelectedPaths: () => void;
  copyToOpposite: () => void;
  moveToOpposite: () => void;
  syncActivePanelToOpposite: () => void;
  trashSelected: () => void;
  deleteSelectedPermanently: () => void;
  previewSelected: () => void;
  toggleHiddenFiles: () => void;
  toggleTerminal: () => void;
  moveSelection: (delta: number) => void;
  moveSelectionPage: (direction: 1 | -1) => void;
  selectFirstRow: () => void;
  selectLastRow: () => void;
  openSelectedInNewTab: () => void;
  openPathPrompt: () => void;
  typeAhead: (prefix: string) => void;
}

const TYPE_AHEAD_RESET_MS = 700;

export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  const typeAheadBufferRef = useRef("");
  const typeAheadTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      typeAheadBufferRef.current = "";
      if (typeAheadTimerRef.current !== null) {
        window.clearTimeout(typeAheadTimerRef.current);
        typeAheadTimerRef.current = null;
      }
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (isTextInput) {
        return;
      }

      const platform = currentPlatform();
      const key = event.key;
      const lowerKey = key.toLowerCase();
      const isEnter = key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter";
      const isBackspace = isBackspaceKey(event);
      const isForwardDelete = isForwardDeleteKey(event);
      const isAnyDelete = isBackspace || isForwardDelete;
      const isPeriod = key === "." || key === ">" || event.code === "Period";
      const isKeyC = lowerKey === "c" || event.code === "KeyC";
      const isKeyL = lowerKey === "l" || event.code === "KeyL";
      const isKeyN = lowerKey === "n" || event.code === "KeyN";
      const isKeyS = lowerKey === "s" || event.code === "KeyS";
      const isBackquote = key === "`" || event.code === "Backquote";

      if (platform === "macos" && event.metaKey && event.shiftKey && isPeriod) {
        event.preventDefault();
        handlers.toggleHiddenFiles();
        return;
      }

      if (platform !== "macos" && event.ctrlKey && lowerKey === "h") {
        event.preventDefault();
        handlers.toggleHiddenFiles();
        return;
      }

      const isPermanentDelete =
        (platform === "macos" &&
          event.metaKey &&
          event.altKey &&
          isAnyDelete) ||
        (platform === "linux" && event.ctrlKey && isForwardDelete) ||
        (platform === "windows" && event.shiftKey && isForwardDelete);

      if (isPermanentDelete) {
        event.preventDefault();
        handlers.deleteSelectedPermanently();
        return;
      }

      if (
        platform === "macos" &&
        event.metaKey &&
        !event.altKey &&
        isAnyDelete
      ) {
        event.preventDefault();
        handlers.trashSelected();
        return;
      }

      if (
        platform === "macos" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        isAnyDelete
      ) {
        event.preventDefault();
        handlers.trashSelected();
        return;
      }

      const commandOrControl =
        platform === "macos" ? event.metaKey : event.ctrlKey;

      const isCopyPathShortcut =
        (platform === "macos" &&
          event.metaKey &&
          event.altKey &&
          !event.shiftKey &&
          isKeyC) ||
        (platform !== "macos" &&
          event.ctrlKey &&
          event.shiftKey &&
          !event.altKey &&
          isKeyC);

      if (isCopyPathShortcut) {
        event.preventDefault();
        event.stopPropagation();
        handlers.copySelectedPaths();
        return;
      }

      if (
        commandOrControl &&
        event.altKey &&
        !event.shiftKey &&
        isKeyS
      ) {
        event.preventDefault();
        handlers.syncActivePanelToOpposite();
        return;
      }

      if (commandOrControl && isEnter) {
        event.preventDefault();
        event.stopPropagation();
        handlers.openSelectedInNewTab();
        return;
      }

      if (commandOrControl && !event.shiftKey && !event.altKey && isBackquote) {
        event.preventDefault();
        event.stopPropagation();
        handlers.toggleTerminal();
        return;
      }

      if (commandOrControl && !event.shiftKey && !event.altKey && isKeyL) {
        event.preventDefault();
        event.stopPropagation();
        handlers.openPathPrompt();
        return;
      }

      if (platform === "macos" && event.metaKey && key === "ArrowDown") {
        event.preventDefault();
        handlers.openSelected();
        return;
      }

      if (platform === "macos" && event.metaKey && key === "ArrowUp") {
        event.preventDefault();
        handlers.goParent();
        return;
      }

      if (platform !== "macos" && event.altKey && key === "ArrowUp") {
        event.preventDefault();
        handlers.goParent();
        return;
      }

      if (isEnter) {
        event.preventDefault();
        event.stopPropagation();
        if (platform === "macos") {
          handlers.renameSelected();
        } else {
          handlers.openSelected();
        }
        return;
      }

      if (platform !== "macos" && key === "F2") {
        event.preventDefault();
        handlers.renameSelected();
        return;
      }

      if (key === "ArrowUp") {
        event.preventDefault();
        handlers.moveSelection(-1);
        return;
      }

      if (key === "ArrowDown") {
        event.preventDefault();
        handlers.moveSelection(1);
        return;
      }

      if (key === "PageUp") {
        event.preventDefault();
        handlers.moveSelectionPage(-1);
        return;
      }

      if (key === "PageDown") {
        event.preventDefault();
        handlers.moveSelectionPage(1);
        return;
      }

      if (key === "Home") {
        event.preventDefault();
        handlers.selectFirstRow();
        return;
      }

      if (key === "End") {
        event.preventDefault();
        handlers.selectLastRow();
        return;
      }

      if (
        platform !== "macos" &&
        isBackspace &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        handlers.goParent();
        return;
      }

      if (key === "Tab") {
        event.preventDefault();
        handlers.switchPanel();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && lowerKey === "t") {
        event.preventDefault();
        handlers.newTab();
        return;
      }

      if (commandOrControl && event.shiftKey && isKeyN) {
        event.preventDefault();
        handlers.createFolder();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && lowerKey === "w") {
        event.preventDefault();
        handlers.closeTab();
        return;
      }

      if (key === "F5") {
        event.preventDefault();
        handlers.copyToOpposite();
        return;
      }

      if (key === "F6") {
        event.preventDefault();
        handlers.moveToOpposite();
        return;
      }

      if (platform !== "macos" && isForwardDelete) {
        event.preventDefault();
        handlers.trashSelected();
        return;
      }

      if (key === " " || key === "Spacebar") {
        event.preventDefault();
        handlers.previewSelected();
        return;
      }

      if (
        key.length === 1 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        /^[\p{L}\p{N}._-]$/u.test(key)
      ) {
        event.preventDefault();
        if (typeAheadTimerRef.current !== null) {
          window.clearTimeout(typeAheadTimerRef.current);
        }
        typeAheadBufferRef.current += key.toLowerCase();
        handlers.typeAhead(typeAheadBufferRef.current);
        typeAheadTimerRef.current = window.setTimeout(() => {
          typeAheadBufferRef.current = "";
          typeAheadTimerRef.current = null;
        }, TYPE_AHEAD_RESET_MS);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (typeAheadTimerRef.current !== null) {
        window.clearTimeout(typeAheadTimerRef.current);
        typeAheadTimerRef.current = null;
      }
      typeAheadBufferRef.current = "";
    };
  }, [enabled, handlers]);
}

function isBackspaceKey(event: KeyboardEvent): boolean {
  return event.key === "Backspace" || event.code === "Backspace";
}

function isForwardDeleteKey(event: KeyboardEvent): boolean {
  return (
    event.key === "Delete" ||
    event.key === "Del" ||
    event.key === "ForwardDelete" ||
    event.code === "Delete" ||
    event.code === "NumpadDelete"
  );
}
