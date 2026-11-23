import {
  asTier,
  type ChoiceHandlerData,
  type HandlerData,
  type HandlerLevel,
} from "@jint/contract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";
import { fetchOriginal, fetchRun } from "../api/client";
import { AnswerCard, type QA } from "./AnswerCard";
import { classificationRows, type Gates } from "./classificationRows";
import { useClassifications } from "./Classifications";
import { ClassificationSelect } from "./ClassificationSelect";
import { CodeBlock } from "./CodeBlock";
import { CopyButton } from "./CopyButton";
import { ParsedJson } from "./ParsedJson";
import { spanLabel } from "./RequestTable";
import { Button } from "@/components/ui/button";
import type { OriginalRead } from "@jint/sdk/ui/api";

interface Props {
  runId: string;
  /** The address: ONE rule at ONE input. No request identity in the address. */
  rule: string;
  input: string;
  /** The request file the classification was clicked from, when known - skips the request lookup. */
  requestFile?: string;
  onClose: () => void;
}

type RecordedRequest = NonNullable<OriginalRead["request"]>;
type Classifications = ReturnType<typeof useClassifications>;

/**
 * Detail view for the classifications of one address. The ADDRESS is (rule, input); the request is
 * fetched only to render the answer's context (code, sampling meta) - severity comes from the run
 * payload's span-aware join for exactly this address, never from a sibling.
 */
export function ClassificationDetail(props: Props) {
  // one edit per address: another address starts from its own original, never from this one's edit
  return (
    <ClassificationDetailBody key={`${props.runId}|${props.rule}|${props.input}`} {...props} />
  );
}

/** The run's cell for this address: the element's span and whether its answer came from the cache. */
function useRunCell(runId: string, rule: string, input: string) {
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => fetchRun(runId) });
  const cell = run.data?.cells?.find((c) => c.rule === rule && c.input === input);
  return { run, element: cell?.element, cached: cell?.cached, handle: run.data?.handles?.[rule] };
}

/** The server's original for this address: its request, its row, its own question and answer. */
function useOriginal(runId: string, rule: string, input: string, requestFile?: string) {
  const query = useQuery({
    queryKey: ["original", runId, rule, input, requestFile],
    queryFn: () => fetchOriginal(runId, { rule, input, file: requestFile }),
  });
  const { result, request } = query.data ?? {};
  const recorded = query.data?.classification;
  const original: QA | undefined =
    recorded === null || recorded === undefined
      ? undefined
      : {
          key: recorded.key,
          rule,
          question: recorded.question as QA["question"],
          answer: recorded.answer as QA["answer"],
        };
  return { query, result, request, original, code: codeOf(request) };
}

function codeOf(request: RecordedRequest | undefined): string | null {
  const state = (request?.request?.state ?? {}) as { content?: unknown; source?: unknown };
  if (typeof state.content === "string") return state.content;
  if (typeof state.source === "string") return state.source;
  return null;
}

/** The rule's handle under the name its kind reads it by: noul gates, score tiers, or choices. */
interface HandleByKind {
  gates?: Gates;
  scoreTiers?: HandlerLevel[];
  choices?: ChoiceHandlerData;
}

function handleByKindOf(handle: HandlerData | undefined): HandleByKind {
  if (handle === undefined) return {};
  if ("map" in handle) return { scoreTiers: handle.map.map((entry) => asTier(entry).level) };
  if ("choices" in handle) return { choices: handle as ChoiceHandlerData };
  return { gates: handle as Gates };
}

function useClassifyShortcut(enabled: boolean, classifications: Classifications) {
  const { mutate: askClassify, isPending: classifying } = classifications.ask;
  useEffect(
    function classifyOnCtrlEnter() {
      if (!enabled) return;
      const onKey = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !classifying) {
          e.preventDefault();
          askClassify();
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    },
    [enabled, classifying, askClassify],
  );
}

function ClassificationDetailBody({ runId, rule, input, requestFile, onClose }: Props) {
  const { run, element, cached, handle } = useRunCell(runId, rule, input);
  const { query, result, request, original, code } = useOriginal(runId, rule, input, requestFile);
  const file = input.split("#")[0]!;
  const severity = result?.severities[rule] ?? null;
  const classifications = useClassifications({ runId, rule, input }, original, code);
  const [editingCode, setEditingCode] = useState(false);
  const canClassify = request !== undefined && original !== undefined && code !== null;
  useClassifyShortcut(canClassify, classifications);
  const handleByKind = handleByKindOf(handle);

  return (
    <section className="detail-pane flex h-full w-full min-h-0 min-w-0 flex-col border-t border-border bg-background overflow-auto lg:border-l lg:border-t-0">
      <DetailHeader rule={rule} file={file} span={element?.span} onClose={onClose} />
      {(query.isLoading || run.isLoading) && (
        <p className="p-rail text-muted-foreground">loading…</p>
      )}
      {query.isError && <p className="p-rail text-sev-error">{String(query.error)}</p>}
      {original === undefined && !query.isLoading && (
        <p className="p-rail text-muted-foreground">
          no answer for {rule} at {input} in the request
        </p>
      )}
      {request !== undefined && original !== undefined && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {canClassify && (
            <ClassifyControls
              classifications={classifications}
              onReset={() => setEditingCode(false)}
            />
          )}
          <SamplingMeta request={request} cached={cached === true} />
          <div className="flex flex-col">
            <AnswerCard
              qa={classifications.edited ?? original}
              trailing={
                classifications.total > 1 ? (
                  <IterationSelect classifications={classifications} handleByKind={handleByKind} />
                ) : undefined
              }
              edit={code !== null ? classifications.edit : undefined}
              sev={severity}
              handle={handleByKind.gates}
              choices={handleByKind.choices}
            />
          </div>
          {classifications.ask.isError && (
            <span
              data-testid="classification-error"
              className="block border-b border-border bg-card px-rail py-siblings text-caption text-sev-error"
            >
              {String(classifications.ask.error)}
            </span>
          )}
          <ContextViews
            request={request}
            code={code}
            path={result?.path ?? file}
            classifications={classifications}
            editingCode={editingCode}
            onEditingCode={setEditingCode}
          />
        </div>
      )}
    </section>
  );
}

function DetailHeader(props: {
  rule: string;
  file: string;
  span: Parameters<typeof spanLabel>[0] | undefined;
  onClose: () => void;
}) {
  return (
    <header className="flex shrink-0 items-center gap-siblings border-b border-border px-rail py-bar-y">
      <h2 className="min-w-0 flex-1 truncate text-body text-foreground">
        {props.rule}{" "}
        <span className="text-muted-foreground">
          @ {props.file}
          {props.span !== undefined ? " · " + spanLabel(props.span) : ""}
        </span>
      </h2>
      <Button
        variant="secondary"
        size="icon-xs"
        data-testid="close-classification"
        aria-label="close"
        onClick={props.onClose}
      >
        ✕
      </Button>
    </header>
  );
}

function IterationSelect(props: { classifications: Classifications; handleByKind: HandleByKind }) {
  const { classifications, handleByKind } = props;
  const choiceCriteria = classifications.edited?.question.criteria;
  const rows = classificationRows(classifications.answers, classifications.filedBy, {
    ...handleByKind,
    options:
      choiceCriteria === undefined || Array.isArray(choiceCriteria)
        ? []
        : Object.keys(choiceCriteria),
  });
  return (
    <ClassificationSelect
      rows={rows}
      position={classifications.position}
      onPick={(at) => classifications.go(at)}
    />
  );
}

/**
 * Every part keeps its place as the state changes: the status has a reserved slot, and reset is
 * disabled instead of absent.
 */
function ClassifyControls(props: { classifications: Classifications; onReset: () => void }) {
  const { classifications } = props;
  return (
    <div
      role="group"
      aria-label="classify"
      className="flex items-center gap-siblings border-b border-border px-rail py-siblings"
    >
      <span className="min-w-0 flex-1 truncate text-caption">
        {classifications.ask.isPending && (
          <span className="text-muted-foreground">classifying…</span>
        )}
        {!classifications.ask.isPending && classifications.asked?.stale === true && (
          <span data-testid="classification-stale" className="text-sev-warn">
            edited since classify
          </span>
        )}
      </span>
      <Button
        variant="secondary"
        size="xs"
        data-testid="classification-reset"
        disabled={classifications.position === 0 && !classifications.dirty}
        onClick={() => {
          classifications.reset();
          props.onReset();
        }}
      >
        reset
      </Button>
      <Button
        variant="secondary"
        size="sm"
        data-testid="classify"
        aria-keyshortcuts="Control+Enter Meta+Enter"
        title="classify (ctrl+enter)"
        disabled={classifications.ask.isPending}
        onClick={() => classifications.ask.mutate()}
      >
        classify
      </Button>
    </div>
  );
}

function SamplingMeta({ request, cached }: { request: RecordedRequest; cached: boolean }) {
  const meta = request.response ?? {};
  return (
    <div className="flex flex-wrap gap-x-meta gap-y-related border-b border-border px-rail py-siblings text-caption text-muted-foreground">
      <span>
        model:{" "}
        <span className="text-foreground">{meta.model ?? request.request?.model ?? "?"}</span>
      </span>
      <span>
        status: <span className="text-foreground">{request.status ?? "?"}</span>
      </span>
      {cached && (
        <span data-testid="classification-cached">
          answer: <span className="text-foreground">cached</span>
        </span>
      )}
      {meta.usage &&
        Object.entries(meta.usage).map(([k, v]) => (
          <span key={k}>
            {k}: <span className="text-foreground">{v}</span>
          </span>
        ))}
    </div>
  );
}

function ToggleButton<T extends string>(props: {
  current: T;
  mode: T;
  onPick: (mode: T) => void;
  controls: string;
  testid: string;
}) {
  const pressed = props.current === props.mode;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => props.onPick(props.mode)}
      aria-pressed={pressed}
      aria-controls={props.controls}
      data-testid={props.testid}
      className={pressed ? "text-body" : "border border-input text-body"}
    >
      {props.mode}
    </Button>
  );
}

function ContextViews(props: {
  request: RecordedRequest;
  code: string | null;
  path: string;
  classifications: Classifications;
  editingCode: boolean;
  onEditingCode: (editing: boolean) => void;
}) {
  const [view, setView] = useState<"code" | "request">(props.code === null ? "request" : "code");
  const [form, setForm] = useState<"parsed" | "raw">("parsed");
  const panelId = useId();
  return (
    <>
      <div
        role="group"
        aria-label="view"
        className="flex items-center gap-related px-rail py-siblings"
      >
        {(["code", "request"] as const).map((mode) => (
          <ToggleButton
            key={mode}
            current={view}
            mode={mode}
            onPick={setView}
            controls={panelId}
            testid={`classification-view-${mode}`}
          />
        ))}
      </div>
      {view === "request" && (
        <div
          role="group"
          aria-label="request form"
          className="flex items-center gap-related px-rail pb-siblings"
        >
          {(["parsed", "raw"] as const).map((mode) => (
            <ToggleButton
              key={mode}
              current={form}
              mode={mode}
              onPick={setForm}
              controls={panelId}
              testid={`classification-request-${mode}`}
            />
          ))}
        </div>
      )}
      <div id={panelId} data-testid="classification-view" className="relative bg-muted">
        {view === "code" && props.code !== null && (
          <CodeView
            code={props.code}
            path={props.path}
            classifications={props.classifications}
            editing={props.editingCode}
            onEditing={props.onEditingCode}
          />
        )}
        {view === "request" && <RequestView request={props.request} form={form} />}
      </div>
    </>
  );
}

function CodeView(props: {
  code: string;
  path: string;
  classifications: Classifications;
  editing: boolean;
  onEditing: (editing: boolean) => void;
}) {
  const { classifications } = props;
  return (
    <>
      <div className="absolute right-related top-related z-10 flex gap-related">
        <Button
          variant="secondary"
          size="icon-xs"
          data-testid="classification-edit-code"
          aria-label="edit code"
          aria-pressed={props.editing}
          onClick={() => props.onEditing(!props.editing)}
        >
          ✎
        </Button>
        <CopyButton text={props.code} label="copy code" icon />
      </div>
      {props.editing ? (
        <textarea
          data-testid="edit-code"
          aria-label="edit-code"
          value={classifications.text}
          onChange={(e) => classifications.setText(e.target.value)}
          className="block min-h-48 w-full resize-y bg-transparent p-rail font-mono text-caption text-foreground [field-sizing:content] focus:outline-none"
        />
      ) : (
        <CodeBlock code={classifications.text} path={props.path} />
      )}
    </>
  );
}

/**
 * What the model was sent: the recorded request body. A recording without one holds only jint's own
 * request shape, shown with a note that says so.
 */
function RequestView({ request, form }: { request: RecordedRequest; form: "parsed" | "raw" }) {
  const hasSent = request.sent?.body !== undefined;
  const requestBody = hasSent ? request.sent?.body : request.request;
  const requestText = useMemo(() => JSON.stringify(requestBody, null, 2) ?? "", [requestBody]);
  return (
    <div data-testid="classification-request" data-sent={hasSent}>
      <div className="absolute right-related top-related z-10">
        <CopyButton text={requestText} label="copy request" icon />
      </div>
      {!hasSent && (
        <p
          data-testid="classification-request-note"
          className="px-rail pt-siblings text-caption text-muted-foreground"
        >
          recorded before request bodies were captured: this is jint's request shape, not the bytes
          sent
        </p>
      )}
      {form === "parsed" ? (
        <>
          <p
            data-testid="classification-request-parsed-note"
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
  );
}
