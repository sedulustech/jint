import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyButton({
  text,
  label = "copy",
  icon = false,
}: {
  text: string;
  label?: string;
  /** Icon-only rendering, for floating over a snippet */
  icon?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = () => {
    // Clipboard API may reject (permission denial, insecure context); fall back to execCommand
    // and surface a failed state rather than an unhandled rejection.
    const done = () => {
      setState("copied");
      setTimeout(() => setState("idle"), 1200);
    };
    const failed = () => setState("failed");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, failed);
    } else {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done();
      } catch {
        failed();
      }
    }
    setTimeout(() => setState("idle"), 2000);
  };
  const labelShown = state === "copied" ? "copied" : state === "failed" ? "failed" : label;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={copy}
      aria-label={icon ? label : undefined}
      title={icon ? label : undefined}
      className={`${icon ? "gap-siblings px-related" : ""} ${
        state === "failed"
          ? "border-destructive/60 bg-sev-error hover:bg-sev-error/90 dark:hover:bg-sev-error/80"
          : ""
      }`}
    >
      {icon && (state === "copied" ? <Check className="size-4" /> : <Copy className="size-4" />)}
      {!icon && labelShown}
    </Button>
  );
}
