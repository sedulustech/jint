import type { ReactNode } from "react";

/**
 * A passage under its label: the label is the passage's subtitle, at the passage's own size and in
 * the foreground; a dimmed passage dims only its text, so every label reads the same. A heading
 * label names a section rather than one passage in it. A marker sits before the label, on its
 * line.
 */
export function LabeledText({
  label,
  dimmed = false,
  heading = false,
  marker,
  children,
}: {
  label: string;
  dimmed?: boolean;
  heading?: boolean;
  marker?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="text-body">
      <span className="flex items-center gap-siblings">
        {marker}
        {heading ? (
          <SectionHeading>{label}</SectionHeading>
        ) : (
          <span data-testid="text-label" className="text-foreground">
            {label}
          </span>
        )}
      </span>
      {children !== undefined && (
        // a heading sits a step farther from its content than a label from its passage
        <p
          className={`${heading ? "mt-siblings" : "mt-related"} ${
            dimmed ? "text-muted-foreground/70" : "text-foreground"
          }`}
        >
          {children}
        </p>
      )}
    </div>
  );
}

/** A result section's name (criteria, instruction): bold, so it reads above the labels it holds. */
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <span data-testid="section-heading" className="font-bold text-foreground">
      {children}
    </span>
  );
}
