import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  showLabel?: boolean;
}

export function IconButton({
  label,
  children,
  showLabel = false,
  className = "",
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`icon-button ${showLabel ? "with-label" : ""} ${className}`}
      type="button"
      {...props}
    >
      {children}
      {showLabel ? <span>{label}</span> : null}
    </button>
  );
}
