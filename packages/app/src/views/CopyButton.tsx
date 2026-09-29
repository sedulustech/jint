import { useState } from "react";

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
    <button
      onClick={copy}
      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] hover:text-white ${
        state === "failed"
          ? "border-red-500/60 text-red-400"
          : "border-neutral-700 text-neutral-400"
      }`}
    >
      {labelShown}
    </button>
  );
}
