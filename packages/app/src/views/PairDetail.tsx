import { useQuery } from "@tanstack/react-query";
import { fetchCapture, fetchRun } from "../api/client";
import { AnswerCard, type QA } from "./AnswerCard";
import { CodeBlock } from "./CodeBlock";
import { CopyButton } from "./CopyButton";
import type { Capture } from "../types";

interface Props {
  runId: string;
  /** The pair address: ONE rule at ONE input. No request identity in the address. */
  rule: string;
  input: string;
  /** The capture file the pair was clicked from, when known - skips the request lookup. */
  requestFile?: string;
  onClose: () => void;
}

/**
 * Detail view for a single rule-target pair. The ADDRESS is (rule, input); the capture is fetched
 * only to render the answer's context (code, sampling meta) - severity comes from the run payload's
 * span-aware join for exactly this pair, never from a sibling.
 */
export function PairDetail({ runId, rule, input, requestFile, onClose }: Props) {
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => fetchRun(runId) });
  const [file, span] = [input.split("#")[0]!, input.includes("#") ? input.split("#")[1]! : null];
  const request =
    run.data?.requests.find((r) => r.file === requestFile) ??
    // span lookup: element identity is exact; a bare-path pair prefers the file-tier capture
    run.data?.requests.find(
      (r) => r.path === file && (span !== null ? r.elementId === span : r.kind !== "elements"),
    ) ??
    run.data?.requests.find((r) => r.path === file);
  const query = useQuery({
    queryKey: ["capture", runId, request?.file],
    queryFn: () => fetchCapture(runId, request!.file),
    enabled: request !== undefined,
  });
  const capture: Capture | undefined = query.data;

  const questions = (capture?.request?.questions ?? {}) as Record<string, QA["question"]>;
  const answers = capture?.response?.answers ?? {};
  const qas: QA[] = Object.entries(questions).map(([key, question]) => {
    const m = key.match(/^(.*) in (.+)$/);
    return { key, rule: m ? m[1] : key, question, answer: answers[key] };
  });
  // the addressed pair is the protagonist; sibling questions of the same capture stay accessible
  const pair = qas.find((qa) => qa.rule === rule);
  // per-pair severity from the API's span-aware join; never re-derived client-side
  const severity = request?.severities[rule] ?? null;

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
  const meta = capture?.response ?? {};

  return (
    <section className="detail-pane flex w-3/5 min-w-[600px] shrink-0 flex-col border-l border-border bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <h2 className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          {rule} <span className="text-muted-foreground">@ {input}</span>
        </h2>
        {capture !== undefined && (
          <CopyButton text={JSON.stringify(capture, null, 2)} label="copy capture" />
        )}
        <button
          onClick={onClose}
          className="px-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </header>
      {(query.isLoading || run.isLoading) && <p className="p-3 text-muted-foreground">loading…</p>}
      {query.isError && <p className="p-3 text-sev-error">{String(query.error)}</p>}
      {pair === undefined && !query.isLoading && (
        <p className="p-3 text-muted-foreground">
          no answer for {rule} at {input} in the capture
        </p>
      )}
      {capture !== undefined && pair !== undefined && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 border-b border-border px-3 py-1 font-mono text-[11px] text-muted-foreground">
            <span>
              model:{" "}
              <span className="text-foreground">{meta.model ?? capture.request?.model ?? "?"}</span>
            </span>
            <span>
              status: <span className="text-foreground">{capture.status ?? "?"}</span>
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
                  {request?.path ?? file} {span ? "· " + span : ""}
                </span>
                <CopyButton text={code} label="copy code" />
              </div>
              <CodeBlock code={code} path={request?.path ?? file} />
            </div>
          )}
          <div className="flex flex-col gap-2 p-2">
            <AnswerCard qa={pair} sev={severity} />
          </div>
        </div>
      )}
    </section>
  );
}
