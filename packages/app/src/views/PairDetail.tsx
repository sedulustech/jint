import { useQuery } from "@tanstack/react-query";
import { fetchRequestFile, fetchRun } from "../api/client";
import { AnswerCard, type QA } from "./AnswerCard";
import { CodeBlock } from "./CodeBlock";
import { CopyButton } from "./CopyButton";
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

  return (
    <section className="detail-pane flex h-1/2 w-full shrink-0 flex-col border-t border-border bg-background lg:h-full lg:w-full lg:min-h-0 lg:min-w-[320px] lg:border-l lg:border-t-0">
      <header className="flex shrink-0 items-center gap-siblings border-b border-border px-rail py-bar-y">
        <h2 className="min-w-0 flex-1 truncate text-body text-foreground">
          {rule} <span className="text-muted-foreground">@ {input}</span>
        </h2>
        {request !== undefined && (
          <CopyButton text={JSON.stringify(request, null, 2)} label="copy result" />
        )}
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
          <div className="flex flex-wrap gap-x-meta gap-y-related border-b border-border px-rail py-related text-caption text-muted-foreground">
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
          {code !== null && (
            <div className="border-b border-border">
              <div className="flex items-center justify-between px-rail py-bar-y">
                <span className="text-caption text-muted-foreground">
                  {result?.path ?? file} {span ? "· " + span : ""}
                </span>
                <CopyButton text={code} label="copy code" />
              </div>
              <CodeBlock code={code} path={result?.path ?? file} />
            </div>
          )}
          <div className="flex flex-col gap-siblings px-rail py-inner">
            <AnswerCard qa={pair} sev={severity} />
          </div>
        </div>
      )}
    </section>
  );
}
