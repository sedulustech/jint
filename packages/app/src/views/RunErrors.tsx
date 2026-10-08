import type { ClassifyErrorInfo } from "../types";

/**
 * The expanded run-errors section: setup failures that left part of the run unmeasured. Lives under
 * the run header, opens from the warning toggle. Same row anatomy as the report table: background
 * surface, rail-gutter rows, hairline separators.
 */
export function RunErrors({ errors }: { errors: readonly ClassifyErrorInfo[] }) {
  return (
    <div
      id="run-errors"
      className="shrink-0 border-b border-border bg-background py-inner text-body"
    >
      <ul className="flex flex-col">
        {errors.map((e, i) => (
          <li key={i} className="border-b border-border px-rail py-related last:border-b-0">
            <div className="flex items-center gap-siblings">
              <span className="truncate text-foreground">{e.input}</span>
              <span className="shrink-0 text-caption font-bold text-sev-error">{e.code}</span>
            </div>
            <p className="whitespace-normal text-body text-muted-foreground">{e.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
