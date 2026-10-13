/**
 * Lint — the one function most consumers need. State-in/findings-out: resolves the input, derives
 * each file's element inventory, classifies every element x every inventory-scoped rule in one
 * chunked pass, unit-scoped rules over the whole unit — runs each rule's handle, streams
 * Measurements, Findings and per-unit ClassifyErrors (signalled, but never run-failing).
 *
 * Files fan out in waves of at most FILE_CONCURRENCY in-flight classifier pipelines (design §7.4
 * cost control); events stream per file as its wave completes, measurements before findings.
 *
 * The pipeline never resolves paths it wasn't given, never knows about the terminal, and never
 * throws for per-unit failures (design §1, §7).
 */

import { resolveInput } from "./input/infer.ts";
import { parsePathsList } from "./input/paths.ts";
import { grammarExtensions, MAX_ELEMENT_TOKENS, type WalkElement } from "./input/walk.ts";
import { createClassifier } from "./jev/client.ts";
import { recordSummary } from "./jev/debug.ts";
import {
  checkRunKnobs,
  DEFAULT_CONCURRENCY,
  DEFAULT_TIMEOUT,
  withLimit,
  withTimeout,
} from "./jev/pacer.ts";
import {
  classifyFile,
  elementWireId,
  rulesForElement,
  selectElement,
  selectElements,
  walkUnit,
  type ClassifyEvent,
  type OversizedElement,
  type WalkedUnit,
} from "./rules/classify.ts";
import {
  resolveAllCustomTargets,
  runCustomRules,
  type ResolvedCustomTargets,
} from "./rules/custom/execute.ts";
import { judgesWholeUnit, ruleInScope } from "./scope.ts";
import {
  ClassifyError,
  SetupError,
  type InputKind,
  type Classifier,
  type LintEvent,
  type Measurement,
  type Finding,
  type Rule,
  type Unit,
} from "./types.ts";
import type { ResolvedConfig } from "../config/load.ts";
import type { CustomRule } from "./rules/custom/schema.ts";

/** Max files with an in-flight classifier pipeline at once (fan-out bound, design §7.4). */
const FILE_CONCURRENCY = 4;

export interface LintOptions {
  config: ResolvedConfig;
  /** Input override (CLI flags); a string[] means explicit file paths. */
  input?: string | string[];
  inputType?: InputKind;
  /** Extra input exclusions, unioned with config.exclude. */
  exclude?: readonly string[];
  /** Sensors removed by name (CLI --disable). */
  disable?: readonly string[];
  /** If set, ONLY these rules run (CLI --rule, repeatable). Applied after disable. */
  only?: readonly string[];
  /** Swappable classifier; defaults to the TypeSafe System One adapter. */
  classifier?: Classifier;
  /**
   * The transport log sink (vendor backoff/warn/error visibility), called with one UNPREFIXED line
   * per event: the tool prefix is the client's voice, never the SDK's. Only reaches the default
   * classifier (an explicit classifier carries its own logging).
   */
  log?: (line: string) => void;
  /**
   * One in-memory str unit (the CLI's piped-stdin form): judged whole under `path` (default
   * "str:stdin"); bypasses input resolution entirely. Its own inventory — every rule judges the
   * whole input, no grammar is ever inferred, and it never WALK_FAILEDs.
   */
  str?: { readonly content: string; readonly path?: string };
  /** Explicit grammar for the str unit (CLI --language); no effect on resolved inputs. */
  language?: string;
  /**
   * In-flight classifier-call ceiling, run-wide (CLI --concurrency; config key of the same name;
   * default 16, max 64). Overrides the config when set.
   */
  concurrency?: number;
  /**
   * Per-call timeout in seconds (CLI --timeout; config key of the same name; default 30). A hung
   * call becomes a per-element JEV_TIMEOUT failure instead of pinning a run-wide slot.
   */
  timeout?: number;
  /**
   * Config-scope basis for dir inputs: the walk root's path relative to the config's directory.
   * Walked paths and scope patterns (config exclude + per-rule include/exclude) share this basis,
   * so a config pattern naming the tests subtree excludes the walk even when the walk root is the
   * tests dir itself. Empty or undefined = walk-root basis. The CLI derives it from the config
   * location; SDK callers walking arbitrary trees leave it unset.
   */
  scopeBase?: string;
  /**
   * A path LIST (the CLI's `paths` noun): the ALREADY-READ text, one path per line, relative to the
   * input dir or absolute — the caller's own VCS pipeline, jint never shells out. Same boundary as
   * `str`'s content: the SDK takes values, the caller does I/O (no spec, no magic "-" — a consumer
   * with a list file reads it and passes the text). No identity field: a list is not a judged unit
   * — its ENTRIES are the identities, and nothing in a report represents the list itself. The list
   * IS the input selection when no input is otherwise given (the changeset form); when an input is
   * also given, the list never selects.
   */
  paths?: { readonly content: string };
  /**
   * Element-scoped run (CLI `<file>@L<line>`): judge ONE walker element of ONE file. The input is
   * exactly that file; the walked inventory narrows to the selected element, so element jobs fan
   * out to a single classifier call (all of the element's rules batched — fewer with --rule).
   * Whole-unit (files-target) rules never run element-scoped: their claim is about the file, not
   * the element — an explicit --rule naming one is a caller contradiction and fails setup. Dir
   * nouns and str units are incompatible by construction.
   */
  element?: {
    readonly path: string;
    readonly anchor?: number;
    readonly ranges?: readonly { readonly start: number; readonly end: number }[];
  };
}

/**
 * Why one target does not apply to one element. The reason is per (target, element) pair, so the
 * skip note can say precisely why no requested rule matched - never a generic parenthetical.
 */
function scopeSkipReason(target: string, element: WalkElement): string {
  if (element.oversized === true) return "exceeds the size backstop";
  if (target === "comments") return "carries none";
  return `is a ${element.role}`;
}

/** The honest skip line: element identity, per-requested-rule mismatch, zero calls spent. */
function scopeSkipNote(path: string, element: WalkElement, rules: readonly Rule[]): string {
  const span = `L${element.span.start.line}-L${element.span.end.line}`;
  const mismatches = rules
    .map(
      (rule) =>
        `${rule.name} measures ${rule.target} (${element.label} ${scopeSkipReason(rule.target, element)})`,
    )
    .join(", ");
  return `${path}: ${element.label} (${span}) not measured - no requested rule applies: ${mismatches}; zero classifier calls were made for this selection`;
}

export async function* lint(options: LintOptions): AsyncGenerator<LintEvent> {
  // The path list (changeset selection): read and parsed ONCE, before the input guard — the
  // list IS the input when nothing else selected one.
  const pathsList = options.paths !== undefined ? parsePathsList(options.paths.content) : undefined;
  if (pathsList !== undefined && pathsList.length === 0) {
    // Fail before the auth gate: an empty list is a caller mistake, not a billing problem.
    throw new SetupError("LIST_EMPTY", "the path list selected no files (empty list)");
  }
  const input: string | string[] | undefined = options.input ?? options.config.input;
  // Backstop for optional config.input: no input at all is a setup failure (the CLI resolves
  // flags > stdin > config before getting here).
  if (
    options.str === undefined &&
    // the changeset form: the LIST is the input (checked below)
    pathsList === undefined &&
    (input === undefined || input === "" || (Array.isArray(input) && input.length === 0))
  ) {
    throw new SetupError(
      "CONFIG_INVALID",
      "no input: pass a path (jint src/), declare piped stdin (jint str - / jint paths - for a path list), or set input in jint.config.json",
    );
  }
  const exclude = [...options.config.exclude, ...(options.exclude ?? [])];
  const include = options.config.include.length > 0 ? [...options.config.include] : undefined;
  // Load-time scope warnings (a rule whose exclude cancels its include): in-band, never silent.
  for (const warning of options.config.warnings ?? []) yield { type: "note", note: warning };
  // Inline callback rules come from the config boundary, already validated (load-time duplicates
  // and scopes are fatal there); lint only selects across both rule forms.
  const { json: rules, custom: customRules } = partitionRules(
    [...options.config.rules],
    options.config.customRules ?? [],
    options.disable,
    options.only,
  );
  // A str unit has no element inventory: every callback target would resolve to zero elements and
  // the run would complete silently empty. That combination is rejected at setup, not silently
  // no-op'd ("no targets found" for the ENTIRE run is user-visible emptiness, not success).
  if (customRules.length > 0 && options.str !== undefined) {
    throw new SetupError(
      "CONFIG_INVALID",
      "callback rules run on file inputs only - a str unit has no element inventory, so every callback rule would resolve zero targets (drop them or use a file input)",
    );
  }
  // Element scope: files-target rules are claims about the FILE, never one element — they cannot
  // run scoped. An explicitly-named one is a caller contradiction (say so); otherwise they are
  // silently out of the scoped set, like any rule whose target misses the subject.
  let scopedRules = rules;
  if (options.element !== undefined) {
    const whole = rules.filter((rule) => judgesWholeUnit(rule, "file"));
    if (whole.length > 0) {
      const demanded = new Set(whole.map((rule) => rule.name));
      const named = (options.only ?? []).find((name) => demanded.has(name));
      if (named !== undefined)
        throw new SetupError(
          "ELEMENT_NOT_FOUND",
          `rule ${named} judges whole files, not elements - element-scoped runs take inventory-scoped rules`,
        );
      scopedRules = rules.filter((rule) => !judgesWholeUnit(rule, "file"));
    }
  }
  // Auth is global, not per-unit: with rules to classify and no key anywhere, every unit would
  // stream the same JEV_AUTH failure. Fail fast as a setup error, before any input is walked.
  if (
    rules.length + customRules.length > 0 &&
    options.classifier === undefined &&
    !apiKeyAvailable(options.config.apiKey)
  ) {
    throw new SetupError(
      "CONFIG_INVALID",
      "no TYPESAFE_API_KEY set - measurements need a valid key (override per run: --config with apiKey)",
    );
  }
  // The run knobs: CLI flag > config key > default. Validated here (the SDK boundary) even when
  // the config already validated them - lint() takes options that never passed the loader.
  const concurrency = options.concurrency ?? options.config.concurrency ?? DEFAULT_CONCURRENCY;
  const timeout = options.timeout ?? options.config.timeout ?? DEFAULT_TIMEOUT;
  const knobProblem = checkRunKnobs({ concurrency, timeout });
  if (knobProblem !== null) throw new SetupError("CONFIG_INVALID", knobProblem);
  // The classifier seam carries all three knobs - composition order is load-bearing (pacer.ts):
  // the limit caps in-flight calls RUN-WIDE, the pacer spaces ARRIVALS (outside the limit, so a
  // paced caller never holds a slot), the timeout frees a slot when a call hangs. The pacer is
  // the ONLY rate layer - the typesafe SDK already retries with backoff and honors Retry-After.
  const classifier = withLimit(
    withTimeout(
      options.classifier ??
        createClassifier({
          apiKey: options.config.apiKey,
          ...(options.log !== undefined && { log: options.log }),
        }),
      timeout,
    ),
    concurrency,
  );
  // The changeset selection: every listed path is the file's identity verbatim. Entries that
  // resolve to no walked unit (missing, unreadable, non-source) are SIGNAL — a note names them
  // below, never silence.
  const units =
    options.str !== undefined
      ? [strUnit(options.str.content, options.str.path)]
      : pathsList !== undefined && (input === undefined || input === "")
        ? await (async () => {
            // The changeset form: the list IS the judged subject, one entry at a time so a
            // missing or non-source entry degrades to the not-in-the-walk note, never fatal.
            // (An empty list never reaches here: the guard above the auth gate threw LIST_EMPTY.)
            const resolved: Unit[] = [];
            for (const entry of pathsList) {
              try {
                for await (const unit of resolveInput({ input: [entry], inputType: "file" })) {
                  resolved.push(unit);
                }
              } catch (thrown) {
                // missing / unreadable / non-source entries take the note path below, never fatal
                if (
                  thrown instanceof SetupError &&
                  ["ENTRYPOINT_NOT_FOUND", "ENTRYPOINT_UNREADABLE", "MISSING_GRAMMAR"].includes(
                    thrown.code,
                  )
                ) {
                  continue;
                }
                throw thrown;
              }
            }
            return resolved;
          })()
        : await collectUnits(
            resolveInput({
              // the empty-input guard above established non-empty; element scope pins the
              // input to exactly the selector file (dir/config input is ignored)
              input: (options.element !== undefined ? options.element.path : input) as
                | string
                | string[],
              inputType: options.inputType ?? options.config.inputType,
              exclude,
              include,
              scopeBase: options.scopeBase,
              // explicit file selection measures raw when only files-target rules are in scope
              requireGrammarFor: (p) =>
                customRules.some((rule) => ruleInScope(rule, p)) ||
                rules.some((rule) => ruleInScope(rule, p) && !judgesWholeUnit(rule, "file")),
            }),
          );
  // Path-list entries that produced no walked unit (missing, unreadable, non-source) are
  // SIGNAL, never silence: one note names each, the run continues around them.
  const unitPaths = new Set(
    units.map((u) => ("path" in u.state ? u.state.path : "")).filter(Boolean),
  );
  if (pathsList !== undefined) {
    for (const missing of pathsList.filter((p) => !unitPaths.has(p))) {
      yield { type: "note", note: `path list entry not found in the walk: ${missing}` };
    }
  }
  const byName = new Map(scopedRules.map((s) => [s.name, s]));
  let aborted = false;

  // WALK-FIRST (design rules-context/03): one walk over every file unit BEFORE any classification,
  // inventories (metadata + parent links) retained, trees freed inside walkUnit. Peak memory =
  // metadata-so-far + contents-so-far + one tree, the same profile as the old streaming walk.
  //
  // The walk is a DEPENDENCY of inventory-scoped rules, so it is taken only where a consumer
  // exists: a unit no in-scope rule targets at element level (files-target only) measures from
  // its raw source and is never parsed. Unwalked units read as inventory-less downstream; a
  // WALK_FAILED there is impossible by construction - the failure requires a walked-for file.
  const skippedExtensions = new Set<string>();
  const walked = new Map<number, WalkedUnit>();
  for (let i = 0; i < units.length; i += FILE_CONCURRENCY) {
    await Promise.all(
      units.slice(i, i + FILE_CONCURRENCY).map(async (unit, j) => {
        if (unit.kind !== "file") return;
        // custom rules resolve their targets from the inventory (element roles only), so any
        // in-scope custom rule needs the walk just like a json-tier element rule
        const needsWalk =
          rules.some(
            (rule) => ruleInScope(rule, unit.state.path) && !judgesWholeUnit(rule, unit.kind),
          ) || customRules.some((rule) => ruleInScope(rule, unit.state.path));
        if (!needsWalk) return;
        const w = await walkUnit(
          unit,
          options.language !== undefined ? { language: options.language } : {},
        );
        // a needed-but-grammar-less file is sweep coverage, not an error: name the extension in
        // the coverage note; the unit still classifies whole (files-target rules read raw source)
        if (w.failed !== null && w.failed.startsWith("no grammar mapping")) {
          const p = unit.state.path;
          const dot = p.lastIndexOf(".");
          skippedExtensions.add(dot === -1 ? "(extensionless)" : p.slice(dot));
        }
        walked.set(i + j, w);
      }),
    );
  }
  // Sweep coverage: unsupported extensions are expected — reported once, never an error. The
  // union of what is parsed and what was seen-but-skipped is the run's honesty line.
  if (skippedExtensions.size > 0) {
    yield {
      type: "note",
      note:
        `parsing ${grammarExtensions().join(", ")} · not parsed (no grammar): ` +
        [...skippedExtensions].sort().join(", "),
    };
  }
  // Element-scope narrowing, right after the walk: the single file's inventory collapses to the
  // selected element, so element jobs fan out to ONE classifier call. A selector that names
  // nothing (a line outside every span) is a caller error — fail setup, naming what
  // the file does contain.
  if (options.element !== undefined) {
    const w = walked.get(0);
    if (w === undefined || w.failed !== null)
      throw new SetupError(
        "ELEMENT_NOT_FOUND",
        `cannot resolve element: ${w?.failed ?? "file did not walk"}`,
      );
    const coverage = w.inventory.map((e) => `L${e.span.start.line}-L${e.span.end.line}`).join(", ");
    let selected: WalkElement[];
    if (options.element.anchor !== undefined) {
      // ANCHOR: the unique CONTAINING element - containment, not enclosure (never a degenerate range).
      const anchor = selectElement(w.inventory, { line: options.element.anchor });
      if (anchor === undefined)
        throw new SetupError(
          "ELEMENT_NOT_FOUND",
          `${options.element.path}: line ${options.element.anchor} is inside no element (elements cover: ${coverage})`,
        );
      selected = [anchor];
    } else {
      // RANGE: fully-enclosed only; each comma item resolves independently.
      selected = [];
      for (const range of options.element.ranges ?? []) {
        const enclosed = selectElements(w.inventory, range);
        if (enclosed.length === 0)
          throw new SetupError(
            "ELEMENT_NOT_FOUND",
            `${options.element.path}: no element fully enclosed in L${range.start}-L${range.end} (elements cover: ${coverage})`,
          );
        selected.push(...enclosed);
      }
    }
    const elementOpt = options.element;
    // Elements no scoped rule targets are skipped + named, never failed: the note says WHICH
    // element, WHICH rules were requested, WHY nothing applies, and that no classifier call was
    // spent - a scoped run that measured nothing must never read as a clean pass.
    for (const element of selected) {
      if (rulesForElement(scopedRules, element, elementOpt.path).length > 0) continue;
      yield { type: "note", note: scopeSkipNote(elementOpt.path, element, scopedRules) };
    }
    walked.set(0, {
      inventory: selected,
      derived: w.derived,
      failed: null,
      failedCause: undefined,
    });
  }

  // custom-tier resolution ONCE per run over the completed walk, then the retention decision: content
  // of files with zero selected targets is dropped (logical drop, no re-read) unless a files-target
  // JSON rule needs every file's text.
  let customResolved: ResolvedCustomTargets | undefined;
  if (customRules.length > 0) {
    const elementsByPath = new Map<string, readonly WalkElement[]>();
    for (let i = 0; i < units.length; i++) {
      const w = walked.get(i);
      if (w !== undefined) elementsByPath.set(units[i]!.state.path, w.inventory);
    }
    customResolved = resolveAllCustomTargets(customRules, elementsByPath);
    // The retention guard is shape-robust on purpose: if the JSON target ever becomes an array
    // form (the TS grammar already allows one), "files" anywhere in the target still retains.
    const wantsAnyFile = (target: Rule["target"]): boolean =>
      Array.isArray(target) ? target.includes("files") : target === "files";
    if (!rules.some((r) => wantsAnyFile(r.target))) {
      const targetPaths = new Set<string>();
      for (const resolved of customResolved.values()) {
        if ("targets" in resolved) for (const t of resolved.targets) targetPaths.add(t.path);
      }
      for (let i = 0; i < units.length; i++) {
        const unit = units[i]!;
        if (walked.has(i) && !targetPaths.has(unit.state.path)) {
          units[i] = { kind: unit.kind, state: { ...unit.state, content: "" } };
        }
      }
    }
  }

  for (let i = 0; i < units.length && !aborted; i += FILE_CONCURRENCY) {
    const results = await Promise.all(
      units
        .slice(i, i + FILE_CONCURRENCY)
        .map((unit, j) =>
          runUnit(
            unit,
            scopedRules,
            classifier,
            () => aborted,
            options.language,
            walked.get(i + j),
          ),
        ),
    );
    for (let j = 0; j < results.length; j++) {
      const result = results[j]!;
      const unit = units[i + j]!;
      if (result.abort) aborted = true;
      // One note per skipped element, named the way every element in jint is named (path@L<line>,
      // the finding convention): a count-only note said the run was incomplete, never WHERE or
      // WHAT was skipped. The stable "skipped:" token is the machine-matchable marker — the note
      // channel is plain strings in the report contract, so there is no code field to match on.
      for (const skipped of result.oversized) {
        const path = "path" in unit.state ? unit.state.path : "unit";
        yield {
          type: "note",
          note:
            `${path}@L${skipped.span.start.line}` +
            ` skipped: ${skipped.role} '${skipped.label}'` +
            ` — ${skipped.chars} chars (over the ${MAX_ELEMENT_TOKENS}-token cap)`,
        };
      }
      for (const note of result.notes) yield { type: "note", note };
      for (const { event, element } of result.events) {
        if (event instanceof ClassifyError) {
          yield { type: "error", error: withLanguageHint(event, options) };
          continue;
        }

        yield { type: "measurement", measurement: { ...event, element } };
        // One pass, no candidacy: every measurement is a reading; the rule's handle is the
        // only threshold. Element readings carry their span into the finding's location.
        const handle = byName.get(event.rule)?.handle;
        // custom-tier events run their own policy pipeline; a rule outside the JSON map has no
        // finding policy here.
        if (handle === undefined) continue;
        // the full answer flows to the handle: score resolution reads value (DEFAULT round) and
        // carries probabilities/confidence for future reads
        const outcome = handle(event);
        if (outcome !== null) {
          // Findings carry no free-form message: consumers join by rule id to the config. Score
          // rules embed the chosen rubric level's legend text (v1.3), so the report displays
          // self-contained; noul findings stay bare.
          const criteria = byName.get(event.rule)?.criteria;
          const note = Array.isArray(criteria) ? criteria[Math.round(event.value)] : undefined;
          yield {
            type: "finding",
            finding: {
              rule: event.rule,
              input: event.input,
              value: event.value,
              severity: outcome.severity,
              ...(note !== undefined && { note }),
              ...(element !== undefined && {
                location: { input: event.input, span: element.span },
              }),
            },
          };
        }
      }
    }
  }

  // custom-tier classification runs after the JSON waves (one resolution, fan-out, policy once per
  // rule); its findings stream at the end of the run, bound to each target's span.
  if (customResolved !== undefined && !aborted) {
    const phase = await runCustomRules(customRules, customResolved, classifier, () => aborted);
    for (const event of phase.events) yield event;
    if (phase.fatal) aborted = true;
  }
}

/** A key reaches the classifier via config apiKey or the environment; empty counts as absent. */
export function apiKeyAvailable(configKey?: string): boolean {
  return (configKey !== undefined && configKey !== "") || !!process.env.TYPESAFE_API_KEY;
}

/**
 * A str unit's grammar cannot be inferred from an extension — the unit path is synthetic
 * (str:stdin) — so a WALK_FAILED on the piped-stdin path without --language should say so: the fix
 * is declaring the grammar, not renaming a file.
 */
function withLanguageHint(error: ClassifyError, options: LintOptions): ClassifyError {
  if (
    error.code !== "WALK_FAILED" ||
    options.str === undefined ||
    options.language !== undefined ||
    // classify already names the --language remedy for extensionless (stdin) units
    error.message.includes("--language")
  ) {
    return error;
  }
  return new ClassifyError(
    error.code,
    error.input,
    error.message + " — declare the grammar with --language (e.g. --language typescript)",
    { cause: error },
  );
}

/** One unit's pipeline outcome: streamed classification events plus the abort flag. */
interface UnitResult {
  events: ClassifyEvent[];
  abort: boolean;
  oversized: readonly OversizedElement[];
  notes: string[];
}

async function runUnit(
  unit: Unit,
  rules: readonly Rule[],
  classifier: Classifier,
  isAborted: () => boolean,
  language?: string,
  walked?: WalkedUnit,
): Promise<UnitResult> {
  const result = await classifyFile(
    unit,
    rules,
    classifier,
    isAborted,
    language !== undefined ? { language } : {},
    walked,
  );
  // Oversized elements are skipped by the classifier (no rules) — never silent: an in-band note
  // rides the same stream as measurements, and the reporters count it in the run summary.
  return {
    events: result.events,
    abort: result.fatal,
    oversized: result.oversized,
    notes: result.notes,
  };
}

/** A str as one file unit: the piped-stdin path (identity str:stdin unless named). */
function strUnit(content: string, path?: string): Unit {
  return {
    kind: "str",
    state: {
      path: path ?? "str:stdin",
      content,
      id: elementWireId({ start: { line: 1 }, end: { line: content.split("\n").length } }),
    },
  };
}

async function collectUnits<T>(units: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const u of units) out.push(u);
  return out;
}

/** Cheap edit distance for close-match suggestions over rule names. */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length]![b.length]!;
}

/**
 * The nearest known name within a typo's distance (<= max(2, a third of the guess)); undefined when
 * no candidate is close — a legitimate no-suggestion. Distance computation ONLY: the detail carries
 * the data, the consumer's emitter renders the prose.
 */
export function closestName(name: string, known: ReadonlySet<string>): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of known) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== undefined && bestDistance <= Math.max(2, Math.floor(name.length / 3))
    ? best
    : undefined;
}

/** The unknown-name SetupError with its structured detail: the valid vocabulary + closest match. */
function unknownRuleError(name: string, known: ReadonlySet<string>): SetupError {
  const suggest = closestName(name, known);
  return new SetupError("CONFIG_INVALID", `unknown rule "${name}"`, {
    detail: {
      kind: "unknown-rule",
      valid: [...known],
      ...(suggest !== undefined && { suggest }),
    },
  });
}

/**
 * Applies disable/only across BOTH tiers with one shared name space: unknown rule names are a usage
 * error, never a silent empty run (design: setup failures throw, per-unit failures don't).
 */
/**
 * The pure selection half of partitionRules: disable/only set membership, nothing more. No
 * validation, no throw — shared by lint() (after it validates) and the CLI's rules pre-print, so
 * the block always shows exactly the set the run will classify.
 */
export function selectRules(
  jsonRules: readonly Rule[],
  customRules: readonly CustomRule[],
  disable: readonly string[] | undefined,
  only: readonly string[] | undefined,
): { json: Rule[]; custom: CustomRule[] } {
  const disabled = disable !== undefined && disable.length > 0 ? new Set(disable) : null;
  const wanted = only !== undefined && only.length > 0 ? new Set(only) : null;
  const keep = (rule: { name: string }): boolean =>
    (disabled === null || !disabled.has(rule.name)) && (wanted === null || wanted.has(rule.name));
  return { json: jsonRules.filter(keep), custom: customRules.filter(keep) };
}

/**
 * Applies disable/only across BOTH tiers with one shared name space: unknown rule names are a usage
 * error, never a silent empty run (design: setup failures throw, per-unit failures don't).
 */
function partitionRules(
  jsonRules: readonly Rule[],
  customRules: readonly CustomRule[],
  disable: readonly string[] | undefined,
  only: readonly string[] | undefined,
): { json: Rule[]; custom: CustomRule[] } {
  validateRuleSelection(jsonRules, customRules, disable, only);
  return selectRules(jsonRules, customRules, disable, only);
}

/**
 * The validation half of partitionRules, shared with the CLI's pre-flight: an unknown disable/only
 * name throws before the rubric pre-print, so the error is never buried under the block.
 */
export function validateRuleSelection(
  jsonRules: readonly Rule[],
  customRules: readonly CustomRule[],
  disable: readonly string[] | undefined,
  only: readonly string[] | undefined,
): void {
  const known = new Set([...jsonRules, ...customRules].map((rule) => rule.name));
  for (const name of disable ?? []) if (!known.has(name)) throw unknownRuleError(name, known);
  for (const name of only ?? []) if (!known.has(name)) throw unknownRuleError(name, known);
}

/** The run pointer: the run-store dir this run's captures landed in, and its id (the dir name). */
export interface RunPointer {
  id: string;
  dir: string;
}

export interface LintReport {
  measurements: Measurement[];
  findings: Finding[];
  /** Per-unit failures of the request to the classifier: the unit produced no measurement. */
  errors: ClassifyError[];
  /** In-band degradation notes (oversized elements skipped): counted in the run summary. */
  notes: string[];
  /**
   * The run pointer (recording is always on; absent only when no classifier call started a run — a
   * report without captures). Consumers join findings to judged text via run.dir's captures
   * (finding.input == capture state.id); identity itself comes from the URL/dir, never this field.
   */
  run?: RunPointer;
}

/** Drain the stream into the stable report shape both reporters render. */
export async function collectReport(events: AsyncIterable<LintEvent>): Promise<LintReport> {
  const report: LintReport = { measurements: [], findings: [], errors: [], notes: [] };
  for await (const event of events) {
    if (event.type === "measurement") report.measurements.push(event.measurement);
    else if (event.type === "finding") report.findings.push(event.finding);
    else if (event.type === "error") report.errors.push(event.error);
    else if (event.type === "note") report.notes.push(event.note);
  }
  // Concurrent classification completes out of order; the REPORT is the stable artifact. Every
  // array sorts on a total key over the data (never completion order, never stable-sort tie
  // preservation):
  // - findings: (file, span startByte, span start line, input, rule) - one file can fire one rule
  //   on many elements, so (input, rule) alone can tie. The element id suffix after '#' is a
  //   per-run uuid (element-identity design), so it sorts only as a final tiebreak, never first —
  //   a uuid-first key would make the document ordering differ between identical runs.
  // - measurements: (file, span, input, rule, stage, value); errors: (file, code, message,
  //   input); notes: lexical.
  // The event STREAM stays completion-ordered by design; the serialized document is byte-stable.
  const idFile = (input: string): string => input.split("#")[0] ?? input;
  const spanKey = (f: Finding): number => f.location?.span.startByte ?? -1;
  const lineKey = (f: Finding): number => f.location?.span.start.line ?? -1;
  const measurementSpan = (m: Measurement): number => m.element?.span.startByte ?? -1;
  report.findings.sort(
    (a, b) =>
      idFile(a.input).localeCompare(idFile(b.input)) ||
      spanKey(a) - spanKey(b) ||
      lineKey(a) - lineKey(b) ||
      a.input.localeCompare(b.input) ||
      a.rule.localeCompare(b.rule),
  );
  report.measurements.sort(
    (a, b) =>
      idFile(a.input).localeCompare(idFile(b.input)) ||
      measurementSpan(a) - measurementSpan(b) ||
      a.input.localeCompare(b.input) ||
      a.rule.localeCompare(b.rule) ||
      (a.element?.kind ?? "").localeCompare(b.element?.kind ?? "") ||
      a.value - b.value,
  );
  report.errors.sort(
    (a, b) =>
      idFile(a.input).localeCompare(idFile(b.input)) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message) ||
      a.input.localeCompare(b.input),
  );
  report.notes.sort((a, b) => a.localeCompare(b));
  // The run pointer is read AFTER the drain: recording starts at the FIRST classifier call, which
  // happens inside the drained events — reading it before would see null on every run.
  const summary = recordSummary();
  if (summary !== null) report.run = { id: summary.dir.split("/").pop()!, dir: summary.dir };
  return report;
}
