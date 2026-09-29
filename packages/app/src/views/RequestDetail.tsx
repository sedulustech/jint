import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchCapture } from "../api/client";
import { CodeBlock } from "./CodeBlock";
import { SEVERITY } from "./color";
import { CopyButton } from "./CopyButton";
import type { Capture, RequestSummary } from "../types";

interface Props {
  runId: string;
  summary: RequestSummary;
  onClose: () => void;
}

interface QA {
  key: string;
  rule: string;
  question: { type?: string; instructions?: string; criteria?: { true?: string; false?: string } };
  answer?: {
    type?: string;
    noul?: number;
    score?: number;
    confidence?: number;
    legend?: Record<string, string>;
    probabilities?: Record<string, number>;
  };
}

function EffectCloser({
  onEscape,
  focusTarget,
}: {
  onEscape: () => void;
  focusTarget: React.RefObject<HTMLButtonElement | null>;
}) {
  useEffect(() => {
    focusTarget.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape, focusTarget]);
  return null;
}

/**
 * One question = its criteria side by side + its LARGE answer. Score answers render the rounded
 * index as the protagonist plus the legend and the probability distribution (neutral bars - shape,
 * not verdict); verdict color comes only from the card's own span-aware severity, never from a
 * sibling element's.
 */
function AnswerCard({ qa, sev }: { qa: QA; sev: "error" | "warn" | null }) {
  const noul = qa.answer?.noul;
  const score = qa.answer?.score;
  const isScore = qa.answer?.type === "score" || (noul === undefined && score !== undefined);
  const index = isScore && score !== undefined ? Math.round(score) : null;
  const legend = isScore ? (qa.answer?.legend ?? {}) : {};
  const probabilities = isScore ? (qa.answer?.probabilities ?? {}) : {};
  // verdict color ONLY from severity; an unprovable answer stays neutral
  const color = sev !== null ? SEVERITY[sev].text : "text-foreground";
  return (
    <div className="border border-border bg-background">
      <div className="flex items-center gap-3 border-b border-border px-2 py-1">
        <span className="font-mono text-xs text-foreground">{qa.rule}</span>
        {noul !== undefined && (
          <span
            data-answer={noul.toFixed(2)}
            className={`ml-auto font-mono text-3xl font-bold leading-none ${color}`}
            title={sev !== null ? `severity: ${sev}` : undefined}
          >
            {noul.toFixed(2)}
          </span>
        )}
        {isScore && index !== null && (
          <span className="ml-auto flex items-baseline gap-2">
            <span
              data-answer={String(index)}
              className={`font-mono text-3xl font-bold leading-none ${color}`}
              title={sev !== null ? `severity: ${sev}` : undefined}
            >
              {index}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              score {qa.answer?.score?.toFixed(2)}
              {qa.answer?.confidence !== undefined &&
                ` · confidence ${qa.answer.confidence.toFixed(2)}`}
            </span>
          </span>
        )}
        {sev !== null && (
          <span className={`${SEVERITY[sev].text} font-mono text-[10px] uppercase`}>{sev}</span>
        )}
      </div>
      {isScore && index !== null && (
        <div className="border-b border-border px-2 py-1">
          {/* the probability strip is omitted for score answers: the legend is the information */}
          <ul className="mt-1 space-y-0.5">
            {Object.keys(legend)
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => (
                <li
                  key={k}
                  className={`font-mono text-[10px] leading-snug ${
                    Number(k) === index ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {k}: {legend[k]}
                  {probabilities[k] !== undefined && ` (${probabilities[k]})`}
                </li>
              ))}
          </ul>
        </div>
      )}
      {qa.question.instructions && (
        <p className="border-b border-border px-2 py-1 text-[11px] leading-snug text-muted-foreground">
          {qa.question.instructions}
        </p>
      )}
      {!isScore && (
        <div className="grid grid-cols-2 gap-px bg-border text-[11px] leading-snug">
          <div className="bg-background p-2">
            <span className="font-mono text-[10px] text-sev-clean">true</span>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-foreground">
              {qa.question.criteria?.true ?? "—"}
            </p>
          </div>
          <div className="bg-background p-2">
            <span className="font-mono text-[10px] text-sev-error">false</span>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-foreground">
              {qa.question.criteria?.false ?? "—"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function RequestDetail({ runId, summary, onClose }: Props) {
  const [rawOpen, setRawOpen] = useState(false);
  const rawCloseRef = useRef<HTMLButtonElement | null>(null);
  const query = useQuery({
    queryKey: ["capture", runId, summary.file],
    queryFn: () => fetchCapture(runId, summary.file),
  });
  const capture: Capture | undefined = query.data;
  // per-question severity comes from the API's span-aware join; never re-derived client-side
  const severityFor = (rule: string): "error" | "warn" | null => summary.severities[rule] ?? null;

  const questions = (capture?.request?.questions ?? {}) as Record<string, QA["question"]>;
  const answers = capture?.response?.answers ?? {};
  const qas: QA[] = Object.entries(questions).map(([key, question]) => {
    const m = key.match(/^(.*) in (.+)$/);
    return { key, rule: m ? m[1] : key, question, answer: answers[key] };
  });
  // protagonist order: most undecided first (noul: distance from 0.5; score: distance of the
  // fractional part from a level boundary)
  const undecided = (qa: QA): number => {
    const a = qa.answer;
    if (a === undefined) return 1;
    if (a.type === "score" || (a.noul === undefined && a.score !== undefined)) {
      const frac = (a.score ?? 0) - Math.floor(a.score ?? 0);
      return Math.min(frac, 1 - frac);
    }
    return Math.abs((a.noul ?? 0.5) - 0.5);
  };
  qas.sort((a, b) => undecided(a) - undecided(b));

  const raw = capture === undefined ? "" : JSON.stringify(capture, null, 2);
  const state = (capture?.request?.state ?? {}) as {
    content?: string;
    source?: string;
    path?: string;
  };
  const code =
    typeof state.content === "string"
      ? state.content
      : typeof state.source === "string"
        ? state.source
        : null;
  const codePath = summary.path ?? "unknown";
  const loc = summary.elementId;
  const meta = capture?.response ?? {};

  return (
    <section className="detail-pane flex w-3/5 min-w-[600px] shrink-0 flex-col border-l border-border bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <h2 className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          #{summary.seq} {summary.path ?? summary.file}{" "}
          <span className="text-muted-foreground">{summary.elementId ?? ""}</span>
        </h2>
        {raw !== "" && (
          <button
            onClick={() => setRawOpen((v) => !v)}
            className="shrink-0 cursor-pointer list-none rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            aria-expanded={rawOpen}
          >
            raw {rawOpen ? "▾" : "▸"}
          </button>
        )}
        {rawOpen && raw !== "" && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="raw capture JSON"
            className="fixed inset-0 z-50 flex flex-col bg-background/95"
            onClick={(e) => {
              // backdrop-click close: only when the click lands on the modal frame itself
              if (e.target === e.currentTarget) setRawOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setRawOpen(false);
                return;
              }
              if (e.key === "Tab") {
                // minimal focus trap: keep Tab cycling inside the dialog
                const focusables = [
                  ...document.querySelectorAll('[role="dialog"] button, [role="dialog"] pre'),
                ] as HTMLElement[];
                if (focusables.length === 0) return;
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                const active = document.activeElement as HTMLElement | null;
                if (e.shiftKey && (active === null || active === first)) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && active === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted px-3 py-1.5">
              <span className="font-mono text-xs text-foreground">raw capture JSON</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {summary.path ?? summary.file} · {summary.seq}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <CopyButton text={raw} label="copy full" />
                <button
                  ref={rawCloseRef}
                  onClick={() => setRawOpen(false)}
                  className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                >
                  close (Esc)
                </button>
              </span>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-tight text-foreground">
              {raw}
            </pre>
          </div>
        )}
        {rawOpen && <EffectCloser onEscape={() => setRawOpen(false)} focusTarget={rawCloseRef} />}
        {raw !== "" && <CopyButton text={raw} label="copy full" />}
        <button
          onClick={onClose}
          className="px-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </header>
      {query.isLoading && <p className="p-3 text-muted-foreground">loading…</p>}
      {query.isError && <p className="p-3 text-sev-error">{String(query.error)}</p>}
      {capture !== undefined && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* sampling meta above the fold */}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 border-b border-border px-3 py-1 font-mono text-[11px] text-muted-foreground">
            <span>
              model:{" "}
              <span className="text-foreground">{meta.model ?? capture.request?.model ?? "?"}</span>
            </span>
            <span>
              status: <span className="text-foreground">{capture.status ?? "?"}</span>
            </span>
            <span
              title={
                summary.durationMs !== null
                  ? "file-mtime minus capture ts - a heuristic that breaks on copied/moved run dirs"
                  : "mtime heuristic - not measurable for this capture"
              }
            >
              duration:{" "}
              <span className="text-foreground">
                {summary.durationMs !== null ? `${summary.durationMs} ms` : "—"}
              </span>
            </span>
            {meta.usage &&
              Object.entries(meta.usage).map(([k, v]) => (
                <span key={k}>
                  {k}: <span className="text-foreground">{v}</span>
                </span>
              ))}
          </div>
          {code !== null && (
            <div className="border-b border-border">
              <div className="flex items-center justify-between px-3 pt-2 pb-1">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {codePath} {loc ? `· ${loc}` : ""}
                </span>
                <CopyButton text={code} label="copy code" />
              </div>
              <CodeBlock code={code} path={codePath} />
            </div>
          )}
          <div className="flex flex-col gap-2 p-2">
            {qas.map((qa) => (
              <AnswerCard key={qa.key} qa={qa} sev={severityFor(qa.rule)} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
