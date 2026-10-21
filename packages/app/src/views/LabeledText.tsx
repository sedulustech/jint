import type { ReactNode } from "react";

/**
 * A passage under its label: the label is the passage's subtitle, at the passage's own size and in
 * the foreground; a dimmed passage dims only its text, so every label reads the same.
 */
export function LabeledText({
  label,
  dimmed = false,
  children,
}: {
  label: string;
  dimmed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="text-body leading-snug">
      <span data-testid="text-label" className="block text-foreground">
        {label}
      </span>
      <p className={dimmed ? "text-muted-foreground/70" : "text-foreground"}>{children}</p>
    </div>
  );
}
