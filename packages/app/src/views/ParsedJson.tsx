import { useMemo } from "react";
import { highlightJson } from "./CodeBlock";

type Segment = { kind: "json" | "text"; text: string; key?: string };

/** A string that is itself a JSON object or array reads as the structure it encodes. */
function expand(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const t = value.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return value;
  try {
    const parsed: unknown = JSON.parse(t);
    return typeof parsed === "object" && parsed !== null ? parsed : value;
  } catch {
    return value;
  }
}

/**
 * The JSON skeleton as lines to highlight, with multi-line strings as indented text lines of their
 * own: the text a reader would see, not its escapes. Key order is the body's.
 */
function segments(value: unknown, indent: number, label: string, comma: string, out: Segment[]) {
  const pad = "  ".repeat(indent);
  const v = expand(value);
  const json = (text: string) => out.push({ kind: "json", text });
  if (typeof v === "string" && v.includes("\n")) {
    if (label !== "") json(`${pad}${label}`.trimEnd());
    out.push({
      kind: "text",
      key: label,
      text: v
        .split("\n")
        .map((l) => `${pad}  ${l}`)
        .join("\n"),
    });
    return;
  }
  if (typeof v !== "object" || v === null) {
    json(`${pad}${label}${JSON.stringify(v)}${comma}`);
    return;
  }
  const isArray = Array.isArray(v);
  const entries: [string, unknown][] = isArray
    ? v.map((x, i) => [String(i), x])
    : Object.entries(v as Record<string, unknown>);
  const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
  if (entries.length === 0) {
    json(`${pad}${label}${open}${close}${comma}`);
    return;
  }
  json(`${pad}${label}${open}`);
  entries.forEach(([k, x], i) => {
    const last = i === entries.length - 1 ? "" : ",";
    segments(x, indent + 1, isArray ? "" : `${JSON.stringify(k)}: `, last, out);
  });
  json(`${pad}${close}${comma}`);
}

/**
 * A reading view of a JSON body: JSON-encoded strings expanded, multi-line strings shown across
 * real lines. Display only - what is copied is the exact body, never this.
 */
export function ParsedJson({ value }: { value: unknown }) {
  const chunks = useMemo(() => {
    const raw: Segment[] = [];
    segments(value, 0, "", "", raw);
    // adjacent skeleton lines highlight together
    const merged: Segment[] = [];
    for (const s of raw) {
      const last = merged[merged.length - 1];
      if (s.kind === "json" && last?.kind === "json") last.text += "\n" + s.text;
      else merged.push({ ...s });
    }
    return merged.map((s) => ({ ...s, html: s.kind === "json" ? highlightJson(s.text) : "" }));
  }, [value]);
  return (
    <div
      data-testid="pair-request-parsed-panel"
      className="hljs overflow-auto bg-transparent! p-inner text-body"
    >
      {chunks.map((c, i) =>
        c.kind === "json" ? (
          <pre key={i} className="m-0">
            <code dangerouslySetInnerHTML={{ __html: c.html }} />
          </pre>
        ) : (
          <pre
            key={i}
            data-testid="pair-request-text"
            className="m-0 whitespace-pre-wrap text-foreground"
          >
            {c.text}
          </pre>
        ),
      )}
    </div>
  );
}
