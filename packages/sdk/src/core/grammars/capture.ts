import { walkInputOptions } from "../input-options.ts";
import { resolveInput, type InputOptions } from "../input/infer.ts";
import { inputStats, SKIP_REASONS, type InputSummary } from "../input/stats.ts";
import { validateRuleSelection } from "../lint.ts";
import { matchesTarget, targetsOf } from "../rules/classify.ts";
import { resolveTargets, tsElementsOf } from "../rules/custom/execute.ts";
import { isCustomRule, type CustomRule } from "../rules/custom/schema.ts";
import { ruleInScope } from "../scope.ts";
import { SetupError, type Rule, type Unit } from "../types.ts";
import { POOL_FAILED_NOTE, walkEach } from "../walk-pool.ts";
import { CoverageTally } from "./coverage.ts";
import {
  grammar,
  knownLanguages,
  languageOf,
  loadCustomGrammars,
  registerCustomGrammar,
  unclaimedExtension,
  EMBEDDED,
  type GrammarRegistry,
} from "./grammars.ts";
import { projectElement, type InventoryElement } from "./walk.ts";
import type { ResolvedConfig } from "../../config/load.ts";
import type { Element } from "@jint/contract";

/**
 * One extracted element: the contract Element EXTENDED with its provenance - which input file it
 * came from and which grammar extracted it. Nothing redeclared: span/label/parent/kind/name ride on
 * Element untouched.
 */
export type CapturedElement = Element & {
  readonly input: string;
  readonly grammar: string;
  /** The element's own source: the file sliced by the element's span, whole. */
  readonly text: string;
  /**
   * Population preview (--rule): TRUE on exactly the elements the rule's target and scope globs
   * would measure. ABSENT otherwise - never false - so the field's presence IS the preview, and an
   * element outside the population is indistinguishable from a no-preview element.
   */
  readonly matches?: true;
};

async function loadQueryFile(queryPath: string): Promise<string> {
  if (queryPath.trim() === "") {
    throw new SetupError(
      "CONFIG_INVALID",
      `queryPath must be a path to an .scm file, got "${queryPath}"`,
    );
  }
  return Bun.file(queryPath)
    .text()
    .catch((cause: unknown) => {
      throw new SetupError(
        "CONFIG_INVALID",
        `query file "${queryPath}" is unreadable - capture() extracts with an .scm file or no override`,
        { cause },
      );
    });
}

/**
 * The colliding half of the cross-grammar guard: the compile-time node-vocabulary check cannot
 * catch an .scm whose node types all exist in the routed grammar - css's comments-only mapping
 * compiles clean over typescript. Identity can: a query file byte-equal to a registered grammar's
 * OWN queries.scm IS that grammar's mapping, and handing it to another language is a setup error
 * naming both, before extraction - a BYTE-IDENTITY check, not a node-mapping claim. (A grammar
 * whose own .scm is passed back - or a sibling with a byte-identical .scm, ts/tsx - extracts as
 * itself and stays legal.)
 */
function assertQueriesAuthoredFor(
  registry: GrammarRegistry,
  queries: string,
  queryPath: string,
  language: string,
): void {
  const owners = knownLanguages(registry).filter((id) => grammar(registry, id).queries === queries);
  if (owners.length > 0 && !owners.includes(language)) {
    throw new SetupError(
      "CONFIG_INVALID",
      `query file "${queryPath}" is byte-identical to the registered queries.scm of ${owners.join(", ")} - it is authored for ${owners.join(", ")}, not ${language}; pass an .scm authored for ${language}`,
    );
  }
}

/** The registry plus the call's own grammar (--grammar), when it names one. */
async function withGrammar(
  base: GrammarRegistry,
  grammarPath: string | undefined,
  queryPath: string | undefined,
): Promise<GrammarRegistry> {
  if (grammarPath === undefined) return base;
  const entry = await registerCustomGrammar(grammarPath, {
    queriesOptional: queryPath !== undefined,
  });
  return { ...base, [entry.language]: entry };
}

export async function capture(
  targetPath: string,
  queryPath?: string,
  grammarPath?: string,
  onSkip?: (skip: { readonly file: string; readonly extension: string }) => void,
  onStats?: (summary: InputSummary) => void,
  walkWorkers?: number,
): Promise<CapturedElement[]> {
  const registry = await withGrammar(EMBEDDED, grammarPath, queryPath);
  const queries = queryPath !== undefined ? await loadQueryFile(queryPath) : undefined;
  const stats = inputStats();
  const captured = await collect(
    extractEach({ input: targetPath, registry, stats }, queries, queryPath, onSkip, walkWorkers),
  );
  onStats?.(stats.summary());
  return captured;
}

async function collect(
  source: AsyncIterable<readonly CapturedElement[]>,
): Promise<CapturedElement[]> {
  const all: CapturedElement[] = [];
  for await (const file of source) all.push(...file);
  return all;
}

/** The one identity of an element across files: the file it is in and its label there. */
const elementKey = (path: string, label: string): string => `${path}|${label}`;

/** The rule whose population a capture marks, and the config's admission test for its scope. */
interface Preview {
  readonly rule: Rule | CustomRule;
  readonly configAdmits: (path: string) => boolean;
}

/** One file's walked elements and their projections, held for a rule that must see every file. */
interface HeldFile {
  readonly path: string;
  readonly source: string;
  readonly elements: readonly InventoryElement[];
  readonly projected: readonly CapturedElement[];
}

function capturedOf(
  element: InventoryElement,
  path: string,
  language: string,
  matches: boolean,
): CapturedElement {
  const captured = {
    ...projectElement(element, element.parent),
    input: path,
    grammar: language,
    text: element.content,
  };
  return matches ? { ...captured, matches: true } : captured;
}

/**
 * JSON-tier rules evaluate the shared target grammar per element - the same selectors the run
 * applies - so an element's mark needs nothing but the element and its path.
 */
function inPopulation(
  rule: Rule,
  path: string,
  element: InventoryElement,
  configAdmits: (path: string) => boolean,
): boolean {
  return (
    targetsOf(rule).some((target) => matchesTarget(target, element)) &&
    // preview == run population: unscoped rules follow the config scope too
    ruleInScope(rule, path) &&
    (rule.include !== undefined || configAdmits(path))
  );
}

/**
 * Custom (callback) rules select over the whole walk, through the run's own resolver: a function
 * target is arbitrary selection, and reusing the seam is the only way the preview cannot drift from
 * what the run would measure.
 */
function* markedByCustomRule(
  rule: CustomRule,
  held: readonly HeldFile[],
): Generator<readonly CapturedElement[]> {
  const resolved = resolveTargets(
    rule,
    held.flatMap((file) => tsElementsOf(file.elements, file.path, file.source)),
  );
  // a target function that threw: the preview cannot know the population, and the failure is
  // the rule's own - it surfaces loud, exactly as the run would stream it
  if ("error" in resolved) throw resolved.error;
  const picked = new Set(
    resolved.targets.map((element) => elementKey(element.path, element.label)),
  );
  for (const file of held) {
    yield file.projected.map((projected, i) =>
      picked.has(elementKey(file.path, file.elements[i]!.label))
        ? { ...projected, matches: true }
        : projected,
    );
  }
}

/**
 * The walk both capture entry points share: resolve the input lint's way, walk each file as it
 * arrives, and yield its elements projected, one array per file in file order, marked when a rule
 * preview asks. A file's elements are dropped once yielded, except for a custom rule, which must
 * see every file.
 */
async function* extractEach(
  input: InputOptions,
  queries: string | undefined,
  queryPath: string | undefined,
  onSkip?: (skip: { readonly file: string; readonly extension: string }) => void,
  walkWorkers?: number,
  preview?: Preview,
): AsyncGenerator<readonly CapturedElement[]> {
  // the CALL's registry rides the input options: fileUnit routes through it, and the walk below
  // reads it back out for every file
  const registry = input.registry ?? EMBEDDED;
  const languages = new WeakMap<Unit, string>();
  async function* claimed(): AsyncGenerator<Unit> {
    for await (const unit of resolveInput(input)) {
      // file units only: capture() takes a file or a dir - str/diff forms are lint's callers
      if (unit.kind !== "file") continue;
      const language = languageOf(registry, unit.state.path);
      if (language === null) {
        // a dir-walked file no grammar claims: lint's sweep-coverage policy (shared, not
        // repeated) - skip it and emit ONE event carrying the file and its extension token
        // (".json", or "(extensionless)"); an explicit file never reaches here (fileUnit already
        // failed it loud)
        input.stats?.retractIncluded();
        input.stats?.tallySkip(SKIP_REASONS.missingGrammar);
        onSkip?.({ file: unit.state.path, extension: unclaimedExtension(unit.state.path) });
        continue;
      }
      if (queries !== undefined) assertQueriesAuthoredFor(registry, queries, queryPath!, language);
      languages.set(unit, language);
      yield unit;
    }
  }
  const custom = preview !== undefined && isCustomRule(preview.rule) ? preview.rule : undefined;
  const jsonRule = preview !== undefined && !isCustomRule(preview.rule) ? preview : undefined;
  const held: HeldFile[] = [];
  const coverage = new CoverageTally();
  let poolNoted = false;
  const walked = walkEach(
    claimed(),
    registry,
    { queries },
    {
      workers: walkWorkers,
      onPoolFailed: () => {
        if (!poolNoted) input.onNote?.(POOL_FAILED_NOTE);
        poolNoted = true;
      },
    },
  );
  for await (const { unit, walked: file } of walked) {
    // a file with nothing to extract is an empty capture; a parse that failed is loud
    if (file.failed !== null && file.failedCause !== undefined) throw file.failedCause;
    const path = unit.state.path;
    const language = languages.get(unit)!;
    if (file.coverage !== undefined) coverage.add(path, file.coverage);
    const projected = file.inventory.map((element) =>
      capturedOf(
        element,
        path,
        language,
        jsonRule !== undefined &&
          inPopulation(jsonRule.rule as Rule, path, element, jsonRule.configAdmits),
      ),
    );
    if (custom !== undefined)
      held.push({ path, source: unit.state.content, elements: file.inventory, projected });
    else if (projected.length > 0) yield projected;
  }
  if (custom !== undefined) yield* markedByCustomRule(custom, held);
  const own = queries === undefined ? undefined : { label: queryPath!, scm: queries };
  for (const note of coverage.notes(registry, own)) input.onNote?.(note);
}

export type ConfiguredCapture = (
  targetPath: string | undefined,
  queryPath?: string,
  grammarPath?: string,
  onSkip?: (skip: { readonly file: string; readonly extension: string }) => void,
  onStats?: (summary: InputSummary) => void,
) => Promise<CapturedElement[]>;

export interface CaptureForOptions {
  /** Extra input exclusions (CLI --exclude), unioned with config.exclude. */
  readonly exclude?: readonly string[];
  /**
   * Population preview: ONE rule name, resolved against the config's rules (defaults + custom). The
   * elements the rule's target and scope globs would measure carry matches: true; nothing is
   * classified - no questions, no criteria, no handles, no provider.
   */
  readonly rule?: string;
  /**
   * Config-scope basis for dir inputs (the run's scopeBase): the walk root's path relative to the
   * config's directory, so config patterns apply wherever the walk starts.
   */
  readonly scopeBase?: string;
  /** Walk coverage notes (grammar-dir and secret-denylist skips) - the run's note channel. */
  readonly onNote?: (note: string) => void;
  /** The threads that parse files, as in a run (default: the pool's own choice). */
  readonly walkWorkers?: number;
}

/** The capture as the walk makes it: one array of elements per file, in file order. */
export type ConfiguredCaptureStream = (
  targetPath: string | undefined,
  queryPath?: string,
  grammarPath?: string,
  onSkip?: (skip: { readonly file: string; readonly extension: string }) => void,
  onStats?: (summary: InputSummary) => void,
) => AsyncGenerator<readonly CapturedElement[]>;

/** The config-aware capture, one file's elements at a time (see captureFor for the array). */
export function captureStreamFor(
  config: ResolvedConfig,
  options: CaptureForOptions = {},
): ConfiguredCaptureStream {
  if (options.rule !== undefined) {
    validateRuleSelection(config.rules, config.customRules ?? [], undefined, [options.rule]);
  }
  const rule =
    options.rule === undefined
      ? undefined
      : [...config.rules, ...(config.customRules ?? [])].find((r) => r.name === options.rule);
  return async function* (targetPath, queryPath, grammarPath, onSkip, onStats) {
    const registry = await withGrammar(
      await loadCustomGrammars(undefined, options.onNote),
      grammarPath,
      queryPath,
    );
    const queries = queryPath !== undefined ? await loadQueryFile(queryPath) : undefined;
    const input = targetPath ?? config.input;
    if (input === undefined || input === "") {
      throw new SetupError(
        "CONFIG_INVALID",
        "no input: pass a target path or set input in the config",
      );
    }
    const stats = inputStats();
    const { options: walkOptions, configAdmits } = walkInputOptions({
      config,
      rules: [...config.rules, ...(config.customRules ?? [])],
      exclude: options.exclude,
      scopeBase: options.scopeBase,
      onNote: options.onNote,
      stats,
    });
    yield* extractEach(
      {
        ...walkOptions,
        input,
        registry,
        // a file no grammar claims has nothing to extract: it is reported as skipped, as it is
        // inside a directory, and never fails the capture, because a run still measures it whole
        requireGrammarFor: () => false,
      },
      queries,
      queryPath,
      onSkip,
      options.walkWorkers,
      rule === undefined ? undefined : { rule, configAdmits },
    );
    onStats?.(stats.summary());
  };
}

export function captureFor(
  config: ResolvedConfig,
  options: CaptureForOptions = {},
): ConfiguredCapture {
  const stream = captureStreamFor(config, options);
  return (...args) => collect(stream(...args));
}
