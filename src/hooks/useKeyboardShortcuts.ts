import { useEffect } from "react";
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
  moveSelection: (delta: number) => void;
  moveSelectionPage: (direction: 1 | -1) => void;
  selectFirstRow: () => void;
  selectLastRow: () => void;
  openSelectedInNewTab: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
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
      const isPeriod = key === "." || key === ">" || event.code === "Period";
      const isKeyC = lowerKey === "c" || event.code === "KeyC";
      const isKeyN = lowerKey === "n" || event.code === "KeyN";
      const isKeyS = lowerKey === "s" || event.code === "KeyS";

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
          (key === "Backspace" || key === "Delete")) ||
        (platform === "linux" && event.ctrlKey && key === "Delete") ||
        (platform === "windows" && event.shiftKey && key === "Delete");

      if (isPermanentDelete) {
        event.preventDefault();
        handlers.deleteSelectedPermanently();
        return;
      }

      if (
        platform === "macos" &&
        event.metaKey &&
        !event.altKey &&
        (key === "Backspace" || key === "Delete")
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
        key === "Backspace" &&
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

      if (platform !== "macos" && key === "Delete") {
        event.preventDefault();
        handlers.trashSelected();
        return;
      }

      if (key === " " || key === "Spacebar") {
        event.preventDefault();
        handlers.previewSelected();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handlers]);
}
