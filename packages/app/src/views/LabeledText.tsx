import type { ReactNode } from "react";

/**
 * A passage under its label: the label is the passage's subtitle, at the passage's own size and in
 * the foreground; a dimmed passage dims only its text, so every label reads the same. A caption
 * label names a section rather than one passage in it. A marker sits before the label, on its
 * line.
 */
export function LabeledText({
  label,
  dimmed = false,
  caption = false,
  marker,
  children,
}: {
  label: string;
  dimmed?: boolean;
  caption?: boolean;
  marker?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="text-body leading-snug">
      <span className="flex items-center gap-siblings">
        {marker}
        <span
          data-testid="text-label"
          className={`text-foreground ${caption ? "text-caption" : ""}`}
        >
          {label}
        </span>
      </span>
      {children !== undefined && (
        <p className={`mt-related ${dimmed ? "text-muted-foreground/70" : "text-foreground"}`}>
          {children}
        </p>
      )}
    </div>
  );
}
