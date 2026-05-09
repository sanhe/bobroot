import { useId, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

export interface ConfirmationDialogAction {
  label: string;
  className?: string;
  autoFocus?: boolean;
  onPress: () => void;
}

interface ConfirmationDialogProps {
  title: string;
  message: string;
  actions: ConfirmationDialogAction[];
  onCancel: () => void;
}

export function ConfirmationDialog({
  title,
  message,
  actions,
  onCancel,
}: ConfirmationDialogProps) {
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const messageId = `${dialogId}-message`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const initialActionIndexRef = useRef(
    Math.max(
      actions.findIndex((action) => action.autoFocus),
      0,
    ),
  );

  useLayoutEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const initialAction =
      actionRefs.current[initialActionIndexRef.current] ??
      actionRefs.current.find((action) => action !== null);

    initialAction?.focus({ preventScroll: true });

    return () => {
      const previousFocus = previousFocusRef.current;
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  const focusAction = (direction: 1 | -1) => {
    const buttons = actionRefs.current.filter(
      (button): button is HTMLButtonElement => button !== null && !button.disabled,
    );
    if (buttons.length === 0) {
      return;
    }

    const currentIndex = buttons.findIndex((button) => button === document.activeElement);
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : buttons.length - 1
        : (currentIndex + direction + buttons.length) % buttons.length;

    buttons[nextIndex].focus();
  };

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusIsInsideDialog = activeElement ? dialog.contains(activeElement) : false;

    if (activeElement === dialog) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }

    if (event.shiftKey) {
      if (!focusIsInsideDialog || activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (!focusIsInsideDialog || activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }

    if (event.key === "Tab") {
      trapFocus(event);
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      focusAction(1);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      focusAction(-1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      actionRefs.current.find((button) => button !== null && !button.disabled)?.focus();
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const buttons = actionRefs.current.filter(
        (button): button is HTMLButtonElement => button !== null && !button.disabled,
      );
      buttons[buttons.length - 1]?.focus();
    }
  };

  return (
    <div className="confirmation-overlay" role="presentation">
      <div
        aria-describedby={messageId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="confirmation-dialog"
        onKeyDown={onKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={messageId}>{message}</p>
        <div aria-label="Dialog actions" className="confirmation-actions" role="group">
          {actions.map((action, index) => (
            <button
              className={action.className}
              key={`${action.label}-${index}`}
              onClick={action.onPress}
              ref={(element) => {
                actionRefs.current[index] = element;
              }}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      [
        "button:not([disabled])",
        "[href]",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        '[tabindex]:not([tabindex="-1"])',
      ].join(","),
    ),
  ).filter((element) => element.offsetParent !== null || element === document.activeElement);
}
