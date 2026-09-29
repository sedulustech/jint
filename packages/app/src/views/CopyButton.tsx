import { useState } from "react";

export function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 font-mono text-[11px] text-neutral-400 hover:text-white"
    >
      {copied ? "copied" : label}
    </button>
  );
}
