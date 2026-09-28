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

import { decomposeDiff } from "./input/diff.ts";
import { resolveInput } from "./input/infer.ts";
import { MAX_ELEMENT_CHARS, type InventoryElement } from "./input/walk.ts";
import { createClassifier } from "./jev/client.ts";
import {
  classifyFile,
  elementWireId,
  walkUnit,
  type ClassifyEvent,
  type WalkedUnit,
} from "./sensors/classify.ts";
import { resolveAllTsTargets, runTsRules, type ResolvedTsTargets } from "./tsrules/execute.ts";
import { loadTsConfigRules } from "./tsrules/loader.ts";
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
import type { TsRule } from "./tsrules/sdk.ts";

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
   * One in-memory str unit (the CLI's piped-stdin form): judged whole under `path` (default
   * "str:stdin"); bypasses input resolution entirely. Its own inventory — every rule judges the
   * whole input, no grammar is ever inferred, and it never WALK_FAILEDs.
   */
  str?: { readonly content: string; readonly path?: string };
  /**
   * In-memory diff text (the CLI's piped-stdin diff form); decomposed directly, never
   * path-resolved.
   */
  diffText?: { readonly text: string };
  /** Explicit grammar for the str unit (CLI --language); no effect on resolved inputs. */
  language?: string;
}

export async function* lint(options: LintOptions): AsyncGenerator<LintEvent> {
  const input: string | string[] | undefined = options.input ?? options.config.input;
  // Backstop for optional config.input: no input at all is a setup failure (the CLI resolves
  // flags > stdin > config before getting here).
  if (
    options.str === undefined &&
    options.diffText === undefined &&
    (input === undefined || input === "" || (Array.isArray(input) && input.length === 0))
  ) {
    throw new SetupError(
      "CONFIG_INVALID",
      "no input: pass a path (jint src/), declare piped stdin (jint diff - / jint str -), or set input in jint.config.json",
    );
  }
  const exclude = [...options.config.exclude, ...(options.exclude ?? [])];
  // TS-tier rules load at setup: any load failure (gate, thrown module, invalid defineConfig,
  // duplicate names across both tiers) is fatal and names the file (design rules-context/01).
  const loadedTsRules = await loadTsConfigRules(options.config.tsRules ?? []);
  assertNoCrossTierDuplicates(options.config.rules, loadedTsRules);
  const { json: rules, ts: tsRules } = partitionRules(
    options.config.rules,
    loadedTsRules,
    options.disable,
    options.only,
  );
  // Auth is global, not per-unit: with rules to classify and no key anywhere, every unit would
  // stream the same JEV_AUTH failure. Fail fast as a setup error, before any input is walked.
  if (
    rules.length + tsRules.length > 0 &&
    options.classifier === undefined &&
    !apiKeyAvailable(options.config.apiKey)
  ) {
    throw new SetupError(
      "CONFIG_INVALID",
      "no TYPESAFE_API_KEY set - measurements need a valid key (override per run: --config with apiKey)",
    );
  }
  const classifier = options.classifier ?? createClassifier({ apiKey: options.config.apiKey });
  const units =
    options.str !== undefined
      ? [strUnit(options.str.content, options.str.path)]
      : options.diffText !== undefined
        ? [...decomposeDiff(options.diffText.text, null, exclude)]
        : await collectUnits(
            resolveInput({
              // the empty-input guard above established non-empty
              input: input as string | string[],
              inputType: options.inputType ?? options.config.inputType,
              exclude,
            }),
          );
  const byName = new Map(rules.map((s) => [s.name, s]));
  let aborted = false;

  // WALK-FIRST (design rules-context/03): one walk over every file unit BEFORE any classification,
  // inventories (metadata + parent links) retained, trees freed inside walkUnit. Peak memory =
  // metadata-so-far + contents-so-far + one tree, the same profile as the old streaming walk.
  const walked = new Map<number, WalkedUnit>();
  for (let i = 0; i < units.length; i += FILE_CONCURRENCY) {
    await Promise.all(
      units.slice(i, i + FILE_CONCURRENCY).map(async (unit, j) => {
        if (unit.kind === "file") {
          walked.set(
            i + j,
            await walkUnit(
              unit,
              options.language !== undefined ? { language: options.language } : {},
            ),
          );
        }
      }),
    );
  }

  // TS-tier resolution ONCE per run over the completed walk, then the retention decision: content
  // of files with zero selected targets is dropped (logical drop, no re-read) unless a files-target
  // JSON rule needs every file's text.
  let tsResolved: ResolvedTsTargets | undefined;
  if (tsRules.length > 0) {
    const elementsByPath = new Map<string, readonly InventoryElement[]>();
    for (let i = 0; i < units.length; i++) {
      const w = walked.get(i);
      if (w !== undefined) elementsByPath.set(units[i]!.state.path, w.inventory);
    }
    tsResolved = resolveAllTsTargets(tsRules, elementsByPath);
    if (!rules.some((r) => r.target === "files")) {
      const targetPaths = new Set<string>();
      for (const resolved of tsResolved.values()) {
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
          runUnit(unit, rules, classifier, () => aborted, options.language, walked.get(i + j)),
        ),
    );
    for (let j = 0; j < results.length; j++) {
      const result = results[j]!;
      const unit = units[i + j]!;
      if (result.abort) aborted = true;
      if (result.oversized > 0) {
        const path = "path" in unit.state ? unit.state.path : "unit";
        yield {
          type: "note",
          note:
            path +
            ": " +
            result.oversized +
            " oversized element(s) skipped (over " +
            MAX_ELEMENT_CHARS +
            " chars)",
        };
      }
      for (const { event, stage, span } of result.events) {
        if (event instanceof ClassifyError) {
          yield { type: "error", error: withLanguageHint(event, options) };
          continue;
        }

        yield { type: "measurement", measurement: { ...event, stage } };
        // One pass, no candidacy: every measurement is a reading; the rule's handle is the
        // only threshold. Element readings carry their span into the finding's location.
        const handle = byName.get(event.rule)?.handle;
        const severity = handle?.(event.value) ?? null;
        if (severity !== null) {
          yield {
            type: "finding",
            finding: {
              rule: event.rule,
              input: event.input,
              value: event.value,
              severity,
              ...(span !== undefined && { location: { input: event.input, span } }),
            },
          };
        }
      }
    }
  }

  // TS-tier classification runs after the JSON waves (one resolution, fan-out, policy once per
  // rule); its findings stream at the end of the run, bound to each target's span.
  if (tsResolved !== undefined && !aborted) {
    const phase = await runTsRules(tsRules, tsResolved, classifier, () => aborted);
    for (const event of phase.events) yield event;
    if (phase.fatal) aborted = true;
  }
}

/** A key reaches the classifier via config apiKey or the environment; empty counts as absent. */
function apiKeyAvailable(configKey?: string): boolean {
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
  oversized: number;
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
  return { events: result.events, abort: result.fatal, oversized: result.oversized };
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

/** "unknown rule "x" — did you mean: y?" when a known name is within a typo's distance. */
function unknownRuleMessage(name: string, known: ReadonlySet<string>): string {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of known) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== null && bestDistance <= Math.max(2, Math.floor(name.length / 3))
    ? `unknown rule "${name}" — did you mean: ${best}?`
    : `unknown rule "${name}"`;
}

/** Load-time fatality: a TS rule shadowing a JSON rule (or vice versa) is a config contradiction. */
function assertNoCrossTierDuplicates(jsonRules: readonly Rule[], tsRules: readonly TsRule[]): void {
  const json = new Set(jsonRules.map((rule) => rule.name));
  for (const rule of tsRules) {
    if (json.has(rule.name)) {
      throw new SetupError(
        "RULE_INVALID",
        'duplicate rule name "' +
          rule.name +
          '" in tsRules and the JSON rules tier — names are global across tiers',
      );
    }
  }
}

/**
 * Applies disable/only across BOTH tiers with one shared name space: unknown rule names are a usage
 * error, never a silent empty run (design: setup failures throw, per-unit failures don't).
 */
function partitionRules(
  jsonRules: readonly Rule[],
  tsRules: readonly TsRule[],
  disable: readonly string[] | undefined,
  only: readonly string[] | undefined,
): { json: Rule[]; ts: TsRule[] } {
  const known = new Set([...jsonRules, ...tsRules].map((rule) => rule.name));
  for (const name of disable ?? [])
    if (!known.has(name)) throw new SetupError("CONFIG_INVALID", unknownRuleMessage(name, known));
  for (const name of only ?? [])
    if (!known.has(name)) throw new SetupError("CONFIG_INVALID", unknownRuleMessage(name, known));
  const disabled = disable !== undefined && disable.length > 0 ? new Set(disable) : null;
  const wanted = only !== undefined && only.length > 0 ? new Set(only) : null;
  const keep = (rule: { name: string }): boolean =>
    (disabled === null || !disabled.has(rule.name)) && (wanted === null || wanted.has(rule.name));
  return { json: jsonRules.filter(keep), ts: tsRules.filter(keep) };
}

export interface LintReport {
  measurements: Measurement[];
  findings: Finding[];
  /** Per-unit failures of the request to the classifier: the unit produced no measurement. */
  errors: ClassifyError[];
  /** In-band degradation notes (oversized elements skipped): counted in the run summary. */
  notes: string[];
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
  return report;
}
