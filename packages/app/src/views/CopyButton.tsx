import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
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
      className={`${
        state === "failed"
          ? "border-destructive/60 bg-sev-error hover:bg-sev-error/90 dark:hover:bg-sev-error/80"
          : ""
      }`}
    >
      {labelShown}
    </Button>
  );
}
