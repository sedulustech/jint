import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchCapture, fetchReport } from "../api/client";
import { CodeBlock } from "./CodeBlock";
import { SEVERITY } from "./color";
import { CopyButton } from "./CopyButton";
import type { Capture, RequestSummary } from "../types";
import type { Report } from "../types";

interface Props {
  runId: string;
  summary: RequestSummary;
  onClose: () => void;
}

interface QA {
  key: string;
  rule: string;
  question: { type?: string; instructions?: string; criteria?: { true?: string; false?: string } };
  answer?: { type?: string; noul?: number };
}

/** One question = its criteria side by side + its LARGE answer. The raw JSON stays reachable below. */
function AnswerCard({ qa, sev }: { qa: QA; sev: "error" | "warn" | null }) {
  const noul = qa.answer?.noul;
  // verdict color ONLY from severity; an unprovable answer stays neutral
  const color = sev !== null ? SEVERITY[sev].text : "text-neutral-300";
  return (
    <div className="border border-neutral-800 bg-neutral-950">
      <div className="flex items-center gap-3 border-b border-neutral-800 px-2 py-1">
        <span className="font-mono text-xs text-neutral-200">{qa.rule}</span>
        {noul !== undefined && (
          <span
            data-answer={noul.toFixed(2)}
            className={`ml-auto font-mono text-3xl font-bold leading-none ${color}`}
            title={sev !== null ? `severity: ${sev}` : undefined}
          >
            {noul.toFixed(2)}
          </span>
        )}
        {sev !== null && (
          <span className={`${SEVERITY[sev].text} font-mono text-[10px] uppercase`}>{sev}</span>
        )}
      </div>
      {qa.question.instructions && (
        <p className="border-b border-neutral-800 px-2 py-1 text-[11px] leading-snug text-neutral-400">
          {qa.question.instructions}
        </p>
      )}
      <div className="grid grid-cols-2 gap-px bg-neutral-800 text-[11px] leading-snug">
        <div className="bg-neutral-950 p-2">
          <span className="font-mono text-[10px] text-emerald-400">true</span>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-neutral-300">
            {qa.question.criteria?.true ?? "—"}
          </p>
        </div>
        <div className="bg-neutral-950 p-2">
          <span className="font-mono text-[10px] text-red-400">false</span>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-neutral-300">
            {qa.question.criteria?.false ?? "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

export function RequestDetail({ runId, summary, onClose }: Props) {
  const query = useQuery({
    queryKey: ["capture", runId, summary.file],
    queryFn: () => fetchCapture(runId, summary.file),
  });
  const capture: Capture | undefined = query.data;
  const report = useQuery({ queryKey: ["report", runId], queryFn: () => fetchReport(runId) });
  const severity = useMemo<"error" | "warn" | null>(() => {
    const data = report.data;
    if (!data || "absent" in data || summary.path === null) return null;
    const r = data as Report;
    for (const rule of summary.rules) {
      const f = r.findings.find((x) => x.input === summary.path && x.rule === rule);
      if (f) return f.severity;
    }
    return null;
  }, [report.data, summary]);

  const questions = (capture?.request?.questions ?? {}) as Record<string, QA["question"]>;
  const answers = capture?.response?.answers ?? {};
  const qas: QA[] = Object.entries(questions).map(([key, question]) => {
    const m = key.match(/^(.*) in (.+)$/);
    return { key, rule: m ? m[1] : key, question, answer: answers[key] };
  });
  // protagonist order: most undecided first
  qas.sort(
    (a, b) => Math.abs((a.answer?.noul ?? 0.5) - 0.5) - Math.abs((b.answer?.noul ?? 0.5) - 0.5),
  );

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
    <section className="flex w-3/5 min-w-[600px] shrink-0 flex-col border-l border-neutral-800 bg-neutral-950">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-1.5">
        <h2 className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-200">
          #{summary.seq} {summary.path ?? summary.file}{" "}
          <span className="text-neutral-500">{summary.elementId ?? ""}</span>
        </h2>
        {raw !== "" && (
          <details className="min-w-0">
            <summary className="cursor-pointer list-none rounded border border-neutral-700 px-1.5 py-0.5 font-mono text-[11px] text-neutral-400 hover:text-white">
              raw
            </summary>
            <pre className="mt-1 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded border border-neutral-800 bg-neutral-950 p-2 font-mono text-[11px] leading-tight text-neutral-300">
              {raw}
            </pre>
          </details>
        )}
        {raw !== "" && <CopyButton text={raw} label="copy full" />}
        <button
          onClick={onClose}
          className="px-1 font-mono text-xs text-neutral-400 hover:text-white"
        >
          ✕
        </button>
      </header>
      {query.isLoading && <p className="p-3 text-neutral-400">loading…</p>}
      {query.isError && <p className="p-3 text-red-400">{String(query.error)}</p>}
      {capture !== undefined && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* sampling meta above the fold */}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 border-b border-neutral-800 px-3 py-1 font-mono text-[11px] text-neutral-400">
            <span>
              model:{" "}
              <span className="text-neutral-200">
                {meta.model ?? capture.request?.model ?? "?"}
              </span>
            </span>
            <span>
              status: <span className="text-neutral-200">{capture.status ?? "?"}</span>
            </span>
            <span>
              duration:{" "}
              <span className="text-neutral-200">
                {summary.durationMs !== null ? `${summary.durationMs} ms` : "—"}
              </span>
            </span>
            {meta.usage &&
              Object.entries(meta.usage).map(([k, v]) => (
                <span key={k}>
                  {k}: <span className="text-neutral-200">{v}</span>
                </span>
              ))}
          </div>
          {code !== null && (
            <div className="border-b border-neutral-800">
              <div className="flex items-center justify-between px-3 pt-2 pb-1">
                <span className="font-mono text-[11px] text-neutral-500">
                  {codePath} {loc ? `· ${loc}` : ""}
                </span>
                <CopyButton text={code} label="copy code" />
              </div>
              <CodeBlock code={code} path={codePath} />
            </div>
          )}
          <div className="flex flex-col gap-2 p-2">
            {qas.map((qa) => (
              <AnswerCard key={qa.key} qa={qa} sev={severity} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
