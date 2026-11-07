import { asTier } from "@jint/contract";
import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { fetchPair, fetchRun } from "../api/client";
import { AnswerCard, type QA } from "./AnswerCard";
import { classificationRows, type Gates } from "./classificationRows";
import { useClassifications } from "./Classifications";
import { ClassificationSelect } from "./ClassificationSelect";
import { CodeBlock } from "./CodeBlock";
import { CopyButton } from "./CopyButton";
import { ParsedJson } from "./ParsedJson";
import { spanLabel } from "./RequestTable";
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
export function PairDetail(props: Props) {
  // one edit per pair: another pair starts from its own original, never from this one's edit
  return <PairDetailBody key={`${props.runId}|${props.rule}|${props.input}`} {...props} />;
}

function PairDetailBody({ runId, rule, input, requestFile, onClose }: Props) {
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => fetchRun(runId) });
  // the element projection rides the run payload's cells; the input keeps the uuid as its key,
  // the user reads the span label
  const element = run.data?.cells?.find((c) => c.rule === rule && c.input === input)?.element;
  const file = input.split("#")[0]!;
  // the server resolves the pair: its request, its row and its own question and answer
  const query = useQuery({
    queryKey: ["pair", runId, rule, input, requestFile],
    queryFn: () => fetchPair(runId, { rule, input, file: requestFile }),
  });
  const { result, request } = query.data ?? {};
  const recorded = query.data?.pair;
  const pair: QA | undefined =
    recorded === null || recorded === undefined
      ? undefined
      : {
          key: recorded.key,
          rule,
          question: recorded.question as QA["question"],
          answer: recorded.answer as QA["answer"],
        };
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
  // the edit of this pair; the cards below render it and the classify bar asks it
  const classifications = useClassifications({ runId, rule, input }, pair, code);
  const [editingCode, setEditingCode] = useState(false);
  // noul thresholds only: score and choice verdicts read from their own tiers
  const handleData = run.data?.handles?.[rule];
  const noulGates: Gates | undefined =
    handleData !== undefined && !("map" in handleData) && !("choices" in handleData)
      ? handleData
      : undefined;
  // one row per classification; the select is hidden while only the original exists
  const choiceCriteria = classifications.edited?.question.criteria;
  const rows = classificationRows(classifications.answers, classifications.filedBy, {
    gates: noulGates,
    scoreTiers:
      handleData !== undefined && "map" in handleData
        ? handleData.map.map((entry) => asTier(entry).level)
        : undefined,
    choices: handleData !== undefined && "choices" in handleData ? handleData : undefined,
    options:
      choiceCriteria === undefined || Array.isArray(choiceCriteria)
        ? []
        : Object.keys(choiceCriteria),
  });
  const select =
    classifications.total > 1 ? (
      <ClassificationSelect
        rows={rows}
        position={classifications.position}
        onPick={(at) => classifications.go(at)}
      />
    ) : undefined;

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
              qa={classifications.edited ?? pair}
              trailing={select}
              edit={code !== null ? classifications.edit : undefined}
              sev={severity}
              handle={noulGates}
              choices={(() => {
                const h = run.data?.handles?.[rule];
                return h !== undefined && "choices" in h ? h : undefined;
              })()}
            />
          </div>
          {code !== null && (
            <div
              role="group"
              aria-label="classify"
              className="flex flex-col gap-sections border-b border-border bg-card px-rail pb-meta pt-sections"
            >
              <div className="flex items-center gap-siblings">
                <span className="flex-1" />
                {classifications.ask.isPending && (
                  <span className="text-caption text-muted-foreground">classifying…</span>
                )}
                {classifications.asked?.stale === true && (
                  <span data-testid="classification-stale" className="text-caption text-sev-warn">
                    edited since classify
                  </span>
                )}
                {(classifications.position !== 0 || classifications.dirty) && (
                  <Button
                    variant="secondary"
                    size="xs"
                    data-testid="classification-reset"
                    onClick={() => {
                      classifications.reset();
                      setEditingCode(false);
                    }}
                  >
                    reset
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="classify"
                  disabled={classifications.ask.isPending}
                  onClick={() => classifications.ask.mutate()}
                >
                  classify
                </Button>
              </div>
              {classifications.ask.isError && (
                <span data-testid="classification-error" className="text-caption text-sev-error">
                  {String(classifications.ask.error)}
                </span>
              )}
            </div>
          )}
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
                <div className="absolute right-related top-related z-10 flex gap-related">
                  <Button
                    variant="secondary"
                    size="icon-xs"
                    data-testid="classification-edit-code"
                    aria-label="edit code"
                    aria-pressed={editingCode}
                    onClick={() => setEditingCode(!editingCode)}
                  >
                    ✎
                  </Button>
                  <CopyButton text={code} label="copy code" icon />
                </div>
                {editingCode ? (
                  <textarea
                    data-testid="edit-code"
                    aria-label="edit-code"
                    value={classifications.text}
                    onChange={(e) => classifications.setText(e.target.value)}
                    className="block min-h-48 w-full resize-y bg-transparent p-rail font-mono text-caption text-foreground [field-sizing:content] focus:outline-none"
                  />
                ) : (
                  <CodeBlock code={classifications.text} path={result?.path ?? file} />
                )}
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
