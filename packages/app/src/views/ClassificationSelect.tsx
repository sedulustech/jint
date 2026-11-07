import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ROW_CURSOR } from "../lib/row";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** One classification of an address in the list: the original, then #1, #2, ... in filing order. */
export interface ClassificationRow {
  position: number;
  /** "original" or "#N". */
  label: string;
  /** A small picture of the reading, by question kind. */
  indicator: ReactNode;
  /** The reading as text, in its tier color. */
  value: ReactNode;
  by?: "rule" | "agent" | "user";
}

/**
 * Steps through an address's classifications (the arrows wrap around at either end) and jumps to
 * one: arrows around a select that reads "4 of 5". Rows keep their #N. The caller hides it while
 * only the original exists.
 */
export function ClassificationSelect({
  rows,
  position,
  onPick,
}: {
  rows: ClassificationRow[];
  position: number;
  onPick: (position: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const index = rows.findIndex((r) => r.position === position);
  return (
    <span
      role="group"
      aria-label="classifications"
      data-testid="classification-position"
      data-position={position}
      className="flex items-center gap-related"
    >
      <Button
        variant="secondary"
        size="icon-xs"
        data-testid="classification-prev"
        aria-label="previous classification"
        onClick={() => onPick(rows[(index - 1 + rows.length) % rows.length]!.position)}
      >
        <ChevronLeft className="size-3" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          data-testid="classification-select"
          aria-label="choose classification"
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          {index + 1} of {rows.length}
          <ChevronDown className="size-3" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96">
          <div
            role="listbox"
            aria-label="classifications"
            className="flex max-h-64 flex-col overflow-y-auto"
          >
            {rows.map((r) => {
              const current = r.position === position;
              return (
                <button
                  key={r.position}
                  ref={(el) => {
                    if (current) el?.scrollIntoView({ block: "nearest" });
                  }}
                  type="button"
                  role="option"
                  aria-selected={current}
                  data-testid="classification-option"
                  data-position={r.position}
                  onClick={() => {
                    onPick(r.position);
                    setOpen(false);
                  }}
                  className={`${ROW_CURSOR} flex items-center gap-siblings rounded-sm px-siblings py-related text-left text-body hover:bg-muted ${current ? "bg-accent text-accent-foreground" : ""}`}
                >
                  <span className="w-20 shrink-0">{r.label}</span>
                  <span className="flex w-14 shrink-0 items-center">{r.indicator}</span>
                  <span className="w-16 shrink-0">{r.value}</span>
                  <span className="flex-1 text-right text-caption text-muted-foreground">
                    {r.by}
                  </span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      <Button
        variant="secondary"
        size="icon-xs"
        data-testid="classification-next"
        aria-label="next classification"
        onClick={() => onPick(rows[(index + 1) % rows.length]!.position)}
      >
        <ChevronRight className="size-3" />
      </Button>
    </span>
  );
}
