import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { fetchRequestFile, fetchRun } from "../api/client";
import { AnswerCard, type QA } from "./AnswerCard";
import { CodeBlock } from "./CodeBlock";
import { CopyButton } from "./CopyButton";
import { ParsedJson } from "./ParsedJson";
import { spanLabel } from "./RequestTable";
import type { RequestFile } from "../types";
import { Button } from "@/components/ui/button";

interface Props {
  runId: string;
  /** The pair address: ONE rule at ONE input. No request identity in the address. */
  rule: string;
  input: string;
  /** The request file the pair was clicked from, when known - skips the request lookup. */
  requestFile?: string;
  onClose: () => void;
}

/**
 * Detail view for a single rule-target pair. The ADDRESS is (rule, input); the request is fetched
 * only to render the answer's context (code, sampling meta) - severity comes from the run payload's
 * span-aware join for exactly this pair, never from a sibling.
 */
export function PairDetail({ runId, rule, input, requestFile, onClose }: Props) {
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => fetchRun(runId) });
  // the element projection rides the run payload's cells; the input keeps the uuid as its key,
  // the user reads the span label
  const element = run.data?.cells?.find((c) => c.rule === rule && c.input === input)?.element;
  const [file, span] = [input.split("#")[0]!, input.includes("#") ? input.split("#")[1]! : null];
  const result =
    run.data?.results.find((r) => r.file === requestFile) ??
    // span lookup: element identity is exact; a bare-path pair prefers the file-tier request
    run.data?.results.find(
      (r) => r.path === file && (span !== null ? r.elementId === span : !r.element),
    ) ??
    run.data?.results.find((r) => r.path === file);
  const query = useQuery({
    queryKey: ["request", runId, result?.file],
    queryFn: () => fetchRequestFile(runId, result!.file),
    enabled: result !== undefined,
  });
  const request: RequestFile | undefined = query.data;

  const questions = (request?.request?.questions ?? {}) as Record<string, QA["question"]>;
  const answers = request?.response?.answers ?? {};
  const qas: QA[] = Object.entries(questions).map(([key, question]) => {
    const m = key.match(/^(.*) in (.+)$/);
    return { key, rule: m ? m[1] : key, question, answer: answers[key] };
  });
  // the addressed pair is the protagonist; sibling questions of the same request stay accessible
  const pair = qas.find((qa) => qa.rule === rule);
  // per-pair severity from the API's span-aware join; never re-derived client-side
  const severity = result?.severities[rule] ?? null;

  const state = (request?.request?.state ?? {}) as {
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
  const meta = request?.response ?? {};

  // The request view shows what the model was sent: the recorded wire body. A recording from
  // before wire capture holds only jint's own request shape, shown with a note saying so.
  const [view, setView] = useState<"code" | "request">("code");
  // the request reads parsed by default; raw is the wire body as sent
  const [form, setForm] = useState<"parsed" | "raw">("parsed");
  const panelId = useId();
  const hasWire = request?.wire?.body !== undefined;
  const requestText = useMemo(
    () => JSON.stringify(hasWire ? request?.wire?.body : request?.request, null, 2) ?? "",
    [hasWire, request],
  );
  const requestBody = hasWire ? request?.wire?.body : request?.request;
  const toggleButton = <T extends string>(
    current: T,
    mode: T,
    set: (m: T) => void,
    testid: string,
  ) => (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => set(mode)}
      aria-pressed={current === mode}
      aria-controls={panelId}
      data-testid={testid}
      className={current === mode ? "text-body" : "border border-input text-body"}
    >
      {mode}
    </Button>
  );
  const viewButton = (mode: "code" | "request") =>
    toggleButton(view, mode, setView, `pair-view-${mode}`);
  const formButton = (mode: "parsed" | "raw") =>
    toggleButton(form, mode, setForm, `pair-request-${mode}`);

  return (
    <section className="detail-pane flex h-full w-full min-h-0 min-w-0 flex-col border-t border-border bg-background overflow-auto lg:border-l lg:border-t-0">
      <header className="flex shrink-0 items-center gap-siblings border-b border-border px-rail py-bar-y">
        <h2 className="min-w-0 flex-1 truncate text-body text-foreground">
          {rule}{" "}
          <span className="text-muted-foreground">
            @ {file}
            {element !== undefined ? " · " + spanLabel(element.span) : ""}
          </span>
        </h2>
        <Button
          variant="secondary"
          size="icon-xs"
          data-testid="close-pair"
          aria-label="close"
          onClick={onClose}
        >
          ✕
        </Button>
      </header>
      {(query.isLoading || run.isLoading) && (
        <p className="p-rail text-muted-foreground">loading…</p>
      )}
      {query.isError && <p className="p-rail text-sev-error">{String(query.error)}</p>}
      {pair === undefined && !query.isLoading && (
        <p className="p-rail text-muted-foreground">
          no answer for {rule} at {input} in the request
        </p>
      )}
      {request !== undefined && pair !== undefined && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-wrap gap-x-meta gap-y-related border-b border-border px-rail py-siblings text-caption text-muted-foreground">
            <span>
              model:{" "}
              <span className="text-foreground">{meta.model ?? request.request?.model ?? "?"}</span>
            </span>
            <span>
              status: <span className="text-foreground">{request.status ?? "?"}</span>
            </span>
            {meta.usage &&
              Object.entries(meta.usage).map(([k, v]) => (
                <span key={k}>
                  {k}: <span className="text-foreground">{v}</span>
                </span>
              ))}
          </div>
          <div className="flex flex-col">
            <AnswerCard
              qa={pair}
              sev={severity}
              handle={(() => {
                const h = run.data?.handles?.[rule];
                // noul thresholds only: score and choice verdicts read from their own tiers
                return h !== undefined && !("map" in h) && !("choices" in h) ? h : undefined;
              })()}
              choices={(() => {
                const h = run.data?.handles?.[rule];
                return h !== undefined && "choices" in h ? h : undefined;
              })()}
            />
          </div>
          <div
            role="group"
            aria-label="view"
            className="flex items-center gap-related px-rail py-siblings"
          >
            {viewButton("code")}
            {viewButton("request")}
          </div>
          {view === "request" && (
            <div
              role="group"
              aria-label="request form"
              className="flex items-center gap-related px-rail pb-siblings"
            >
              {formButton("parsed")}
              {formButton("raw")}
            </div>
          )}
          <div id={panelId} data-testid="pair-view" className="relative bg-muted">
            {view === "code" && code !== null && (
              <>
                <div className="absolute right-related top-related z-10">
                  <CopyButton text={code} label="copy code" icon />
                </div>
                <CodeBlock code={code} path={result?.path ?? file} />
              </>
            )}
            {view === "request" && (
              <div data-testid="pair-request" data-wire={hasWire}>
                <div className="absolute right-related top-related z-10">
                  <CopyButton text={requestText} label="copy request" icon />
                </div>
                {!hasWire && (
                  <p
                    data-testid="pair-request-note"
                    className="px-rail pt-siblings text-caption text-muted-foreground"
                  >
                    recorded before wire capture: this is jint's request shape, not the bytes sent
                  </p>
                )}
                {form === "parsed" ? (
                  <>
                    <p
                      data-testid="pair-request-parsed-note"
                      className="px-rail pt-siblings text-caption text-muted-foreground"
                    >
                      input is expanded for reading; the copy button gives the exact body
                    </p>
                    <ParsedJson value={requestBody} />
                  </>
                ) : (
                  <CodeBlock code={requestText} path="request.json" />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
