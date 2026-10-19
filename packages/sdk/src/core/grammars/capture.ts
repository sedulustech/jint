import { resolveInput, type InputOptions } from "../input/infer.ts";
import { inputStats, SKIP_REASONS, type InputSummary } from "../input/stats.ts";
import { validateRuleSelection } from "../lint.ts";
import { matchesTarget, targetsOf } from "../rules/classify.ts";
import { resolveTargets, tsElementsOf } from "../rules/custom/execute.ts";
import { ruleInScope } from "../scope.ts";
import { SetupError, type Rule } from "../types.ts";
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
import { decompose, projectElement, type InventoryElement } from "./walk.ts";
import type { ResolvedConfig } from "../../config/load.ts";
import type { CustomRule } from "../rules/custom/schema.ts";
import type { Element } from "@jint/contract";

/**
 * One extracted element: the contract Element EXTENDED with its provenance - which input file it
 * came from and which grammar extracted it. Nothing redeclared: span/label/parent/kind/name ride on
 * Element untouched.
 */
export type CapturedElement = Element & {
  readonly input: string;
  readonly grammar: string;
  /**
   * The element's own source (the span sliced from the file), TRUNCATED: first 200 chars then one
   * ellipsis when longer. The span stays the authority for the full content.
   */
  readonly text: string;
  /**
   * Population preview (--rule): TRUE on exactly the elements the rule's target and scope globs
   * would measure. ABSENT otherwise - never false - so the field's presence IS the preview, and an
   * element outside the population is indistinguishable from a no-preview element.
   */
  readonly matches?: true;
};

/**
 * Read the .scm override, loud on a blank path (quoted, never a double space) or an unreadable
 * file.
 */
async function loadQueryFile(queryPath: string): Promise<string> {
  if (queryPath.trim() === "") {
    throw new SetupError(
      "CONFIG_INVALID",
      `queryPath must be a path to an .scm file, got "${queryPath}"`,
    );
  }
  return Bun.file(queryPath)
    .text()
    .catch(() => {
      throw new SetupError(
        "CONFIG_INVALID",
        `query file "${queryPath}" is unreadable - capture() extracts with an .scm file or no override`,
      );
    });
}

/**
 * The colliding half of the cross-grammar guard: compileQuery's vocabulary check cannot catch an
 * .scm whose node types all exist in the routed grammar - css's comments-only mapping compiles
 * clean over typescript. Identity can: a query file byte-equal to a registered grammar's OWN
 * queries.scm IS that grammar's mapping, and handing it to another language is a setup error naming
 * both, before extraction - a BYTE-IDENTITY check, not a node-mapping claim. (A grammar whose own
 * .scm is passed back - or a sibling with a byte-identical .scm, ts/tsx - extracts as itself and
 * stays legal.)
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

/**
 * Capture (verb) - run extraction over an input under a chosen grammar and query set, yielding
 * elements; the classifier stays unplugged. It is lint's pipeline with the classifier unplugged:
 * input resolution, grammar registration, walk, inventory - no rules, no jev, no config, no
 * handles. The CLI verb `jint capture` is a thin print of this function (one word, two layers: the
 * SDK function and the CLI verb share the name by design). captureFor() below is the config-aware
 * door over the same walk: run's resolution seams, still no classifier.
 *
 * - TargetPath: a file or dir, through the SAME input resolution lint uses - no new input logic. An
 *   explicit FILE no grammar claims fails loud at resolution (fileUnit); a DIR's unclaimable files
 *   are skipped under lint's sweep-coverage policy, and each skip is ONE onSkip event carrying the
 *   file and its extension token - raw events, no aggregate (what parses is derivable from the
 *   returned elements; the caller folds the events into its own reporting).
 * - QueryPath: an .scm FILE that becomes the extraction source, ALWAYS through the full loud compile
 *   checks (vocabulary, #set! directives, pattern-order conflicts) plus the cross-grammar guard
 *   (unknown node types fail compileQuery; a byte-equal foreign queries.scm fails here). When both
 *   are given, the query file WINS; grammarPath's own queries.scm is ignored for extraction
 *   (grammarPath is still validated for routing and wasm).
 * - GrammarPath: a grammar DIRECTORY (wasm + extensions.json [+ queries.scm]) registered custom for
 *   this call - id from the dir name, wasm tree_sitter_<id> cross-check, extensions.json routing,
 *   every BYOG loud validation. Nothing is installed: the registration is a VALUE in this call's
 *   registry, which dies with the call.
 *
 * Grammar resolution precedence: grammarPath (custom) > embedded. (The JINT_GRAMMAR_DIR scan is the
 * CONFIG door - captureFor below - exactly as it is lint's.)
 *
 * No filters, no options bag: callers filter the returned array.
 */
export async function capture(
  targetPath: string,
  queryPath?: string,
  grammarPath?: string,
  onSkip?: (skip: { readonly file: string; readonly extension: string }) => void,
  onStats?: (summary: InputSummary) => void,
): Promise<CapturedElement[]> {
  // THIS CALL's registry value: the embedded base, plus the grammarPath overlay when given. The
  // value dies with the call - a custom registration can never outlive the capture that asked for
  // it, so the walk is side-effect-free by construction.
  let registry: GrammarRegistry = EMBEDDED;
  if (grammarPath !== undefined) {
    // the query file, when present, replaces the dir's own .scm for extraction - registration
    // still requires routing + wasm, but may skip its queries.scm
    const entry = await registerCustomGrammar(grammarPath, {
      queriesOptional: queryPath !== undefined,
    });
    registry = { ...EMBEDDED, [entry.language]: entry };
  }
  const queries = queryPath !== undefined ? await loadQueryFile(queryPath) : undefined;
  const stats = inputStats();
  const { captured } = await walkAndExtract(
    { input: targetPath, registry, stats },
    queries,
    queryPath,
    onSkip,
  );
  onStats?.(stats.summary());
  return captured;
}

/** One walked file's elements in emission order - the flat order `captured` is built in. */
interface WalkedFile {
  readonly path: string;
  readonly elements: readonly InventoryElement[];
}

/** The shared walk's product: projected elements plus the per-file inventories they came from. */
interface WalkOutcome {
  readonly captured: CapturedElement[];
  readonly files: readonly WalkedFile[];
}

/**
 * The walk both capture doors share: resolve the input lint's way, extract each file's inventory,
 * project to CapturedElements. Also records each file's elements in emission order (the exact flat
 * order the captured array is built in), so a rule preview can mark population indices without
 * re-walking - the inventory metadata (comment counts, ownership) that targeting reads lives on the
 * walk-time elements and does not survive projection.
 */
async function walkAndExtract(
  input: InputOptions,
  queries: string | undefined,
  queryPath: string | undefined,
  onSkip?: (skip: { readonly file: string; readonly extension: string }) => void,
): Promise<WalkOutcome> {
  // the CALL's registry rides the input options: fileUnit routes through it, and the walk below
  // reads it back out for every file
  const registry = input.registry ?? EMBEDDED;
  const captured: CapturedElement[] = [];
  const files: WalkedFile[] = [];
  for await (const unit of resolveInput(input)) {
    // file units only: capture() takes a file or a dir - str/diff forms are lint's callers
    if (unit.kind !== "file") continue;
    const language = languageOf(registry, unit.state.path);
    if (language === null) {
      // a dir-walked file no grammar claims: lint's sweep-coverage policy (shared, not repeated) -
      // skip it and emit ONE event carrying the file and its extension token (".json", or
      // "(extensionless)"); an explicit file never reaches here (fileUnit already failed it loud)
      input.stats?.retractIncluded();
      input.stats?.tallySkip(SKIP_REASONS.missingGrammar);
      onSkip?.({ file: unit.state.path, extension: unclaimedExtension(unit.state.path) });
      continue;
    }
    if (queries !== undefined) assertQueriesAuthoredFor(registry, queries, queryPath!, language);
    const inventory = await decompose(unit.state.content, language, { queries, registry });
    const elements = [...inventory.definitions, ...inventory.comments, ...inventory.imports];
    files.push({ path: unit.state.path, elements });
    for (const element of elements) {
      const text =
        element.content.length > 200 ? element.content.slice(0, 200) + "…" : element.content;
      captured.push({
        ...projectElement(element),
        input: unit.state.path,
        grammar: language,
        text,
      });
    }
  }
  return { captured, files };
}

/** Capture() bound to a resolved config: capture's own four params, the config's seams applied. */
export type ConfiguredCapture = (
  targetPath: string | undefined,
  queryPath?: string,
  grammarPath?: string,
  onSkip?: (skip: { readonly file: string; readonly extension: string }) => void,
  onStats?: (summary: InputSummary) => void,
) => Promise<CapturedElement[]>;

export interface CaptureForOptions {
  /** Extra input exclusions (CLI --exclude), unioned with config.exclude - lint()'s seam. */
  readonly exclude?: readonly string[];
  /**
   * Population preview: ONE rule name, resolved against the config's rules (defaults + custom). The
   * elements the rule's target and scope globs would measure carry matches: true; nothing is
   * classified - no questions, no criteria, no handles, no jev.
   */
  readonly rule?: string;
  /**
   * Config-scope basis for dir inputs (lint()'s scopeBase): the walk root's path relative to the
   * config's directory, so config patterns apply wherever the walk starts.
   */
  readonly scopeBase?: string;
  /** Walk coverage notes (grammar-dir and secret-denylist skips) - lint()'s note channel. */
  readonly onNote?: (note: string) => void;
}

/** A custom (callback) rule is recognizable by its classify function; the JSON tier has none. */
const isCustomRule = (rule: Rule | CustomRule): rule is CustomRule =>
  typeof (rule as CustomRule).classify === "function";

/**
 * Mark one rule's population on the walked elements: JSON-tier rules evaluate the shared target
 * grammar per element (targetsOf + matchesTarget + ruleInScope - the same selectors rulesForElement
 * applies); custom rules go through run's own resolver, resolveTargets, over the whole walk (a
 * function target is arbitrary selection; reusing the seam is the only way the preview cannot drift
 * from what the run would measure). Marks ride the flat index captured was built in.
 */
function markPreviewPopulation(
  rule: Rule | CustomRule,
  captured: CapturedElement[],
  files: readonly WalkedFile[],
): void {
  const marked = new Set<number>();
  if (isCustomRule(rule)) {
    const all = files.flatMap((file) => tsElementsOf(file.elements, file.path));
    const resolved = resolveTargets(rule, all);
    // a target function that threw: the preview cannot know the population, and the failure is
    // the rule's own - it surfaces loud, exactly as the run would stream it
    if ("error" in resolved) throw resolved.error;
    const picked = new Set(resolved.targets.map((element) => `${element.path}|${element.id}`));
    let index = 0;
    for (const file of files) {
      for (const element of file.elements) {
        if (picked.has(`${file.path}|${element.label}`)) marked.add(index);
        index++;
      }
    }
  } else {
    let index = 0;
    for (const file of files) {
      for (const element of file.elements) {
        if (
          targetsOf(rule).some((target) => matchesTarget(target, element)) &&
          ruleInScope(rule, file.path)
        ) {
          marked.add(index);
        }
        index++;
      }
    }
  }
  for (const index of marked) captured[index] = { ...captured[index]!, matches: true };
}

/**
 * The config-aware capture door: captureFor(config) returns capture's own four-param walker with
 * run's resolution seams applied - the SAME loader output (the config arrives resolved, baseline
 * included, because the sdk cannot resolve default rule names itself), the same input fallback
 * (target > config.input), the same walk scoping (config include/exclude/secretDenylist + extra
 * excludes + scopeBase), the same registry build order (the grammar dir's customs first, then the
 * call's own grammarPath). What never crosses: criteria, handles, question shapes, jev, severity.
 * The classifier stays unplugged - captureFor measures the population a run would classify, nothing
 * else. An unknown rule name fails through validateRuleSelection, run's own --rule door.
 */
export function captureFor(
  config: ResolvedConfig,
  options: CaptureForOptions = {},
): ConfiguredCapture {
  if (options.rule !== undefined) {
    validateRuleSelection(config.rules, config.customRules ?? [], undefined, [options.rule]);
  }
  const rule =
    options.rule === undefined
      ? undefined
      : [...config.rules, ...(config.customRules ?? [])].find((r) => r.name === options.rule);
  return async (targetPath, queryPath, grammarPath, onSkip, onStats) => {
    // THIS CALL's registry value, built in lint()'s registration order: the grammar dir first (a
    // run measures through it), then the call's own grammarPath (the BYOG door wins last). The
    // value dies with the call.
    let registry = await loadCustomGrammars(undefined, options.onNote);
    if (grammarPath !== undefined) {
      const entry = await registerCustomGrammar(grammarPath, {
        queriesOptional: queryPath !== undefined,
      });
      registry = { ...registry, [entry.language]: entry };
    }
    const queries = queryPath !== undefined ? await loadQueryFile(queryPath) : undefined;
    const input = targetPath ?? config.input;
    if (input === undefined || input === "") {
      throw new SetupError(
        "CONFIG_INVALID",
        "no input: pass a target path or set input in the config",
      );
    }
    const stats = inputStats();
    const { captured, files } = await walkAndExtract(
      {
        input,
        inputType: config.inputType,
        exclude: [...config.exclude, ...(options.exclude ?? [])],
        include: config.include.length > 0 ? [...config.include] : undefined,
        scopeBase: options.scopeBase,
        secretDenylist: config.secretDenylist,
        onNote: options.onNote,
        registry,
        stats,
      },
      queries,
      queryPath,
      onSkip,
    );
    if (rule !== undefined) markPreviewPopulation(rule, captured, files);
    onStats?.(stats.summary());
    return captured;
  };
}
