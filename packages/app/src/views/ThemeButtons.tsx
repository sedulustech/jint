import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeButtons({
  theme,
  choose,
}: {
  theme: string;
  choose: (m: "system" | "light" | "dark") => void;
}) {
  return (
    <div className="ml-auto flex items-center gap-related" role="group" aria-label="theme">
      {(
        [
          ["system", Monitor],
          ["light", Sun],
          ["dark", Moon],
        ] as const
      ).map(([m, Icon]) => (
        <Button
          key={m}
          variant="secondary"
          size="icon-xs"
          data-testid={`theme-${m}`}
          aria-label={`${m} theme`}
          aria-pressed={theme === m}
          title={`${m} theme`}
          onClick={() => choose(m)}
          className={theme === m ? undefined : "border border-input"}
        >
          <Icon />
        </Button>
      ))}
    </div>
  );
}
