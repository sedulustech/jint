/**
 * Regenerates the checked-in generated artifacts from source:
 *
 * - Jint.schema.json from CONFIG_SCHEMA (packages/sdk/src/config/load.ts)
 * - Docs/rules.md from the default rules (packages/defaults/src/index.ts)
 * - Skills/jint-follow/SKILL.md, skills/jint-author/SKILL.md, skills/jint-author/REFERENCE.md
 * - Docs/targets.md from the target vocabulary and each embedded grammar's queries.scm census
 * - Docs/directives.md from the loader's directive vocabulary and each embedded grammar's use of it
 *
 * Run after any config-schema, default-rule, or skill change: bun run schema (wired into bun run
 * validate). Outputs are checked in so editors resolve "$schema" without running jint and docs stay
 * browsable, and CI diffs them against this output to catch drift - generated means never stale.
 *
 * Structure: pure render functions (strings in, strings out) plus GENERATED_OUTPUTS; a thin
 * writeGeneratedOutputs() edge is the only code that touches the filesystem. Consumers of the
 * renderers: scripts/generate-schema.test.ts (synthetic-spec unit tests) and
 * tests/generated-outputs.test.ts (freshness over every generated output, driven by
 * GENERATED_OUTPUTS).
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
  defaultRules as defaultSpecs,
  type ChoiceRuleSchema,
  type NoulRuleSchema,
  type RuleSchema,
  type ScoreRuleSchema,
} from "@jint/defaults";
import { CONFIG_SCHEMA } from "@jint/sdk";
import { validateRunSearch } from "../packages/app/src/router.tsx";
import { VERBS } from "../packages/cli/src/cli.ts";
import { ruleTargets } from "../packages/contract/src/handlers.ts";
import { knownLanguages } from "../packages/sdk/src/core/grammars/grammars.ts";
import {
  directiveVocabulary,
  parseScmPatterns,
  scmCaptureDeclarations,
  scmDirectives,
  type DirectiveRow,
} from "../packages/sdk/src/core/grammars/query.ts";
import { isSharedCapture } from "../packages/sdk/src/core/grammars/shared.ts";

const GENERATION_NOTE =
  "GENERATED FILE — do not edit. Regenerate with: bun run schema (scripts/generate-schema.ts, from src/config/load.ts CONFIG_SCHEMA).";

export const GENERATED_OUTPUTS = [
  "jint.schema.json",
  "docs/rules.md",
  "skills/jint-follow/SKILL.md",
  "skills/jint-author/SKILL.md",
  "skills/jint-author/REFERENCE.md",
  "docs/targets.md",
  "docs/directives.md",
];

// ---------------------------------------------------------------------------
// Pure renderers: strings in, strings out. No filesystem, no process access.
// ---------------------------------------------------------------------------

export function renderSchemaJson(): string {
  const schema = { $comment: GENERATION_NOTE, ...CONFIG_SCHEMA };
  return JSON.stringify(schema, null, 2) + "\n";
}

function renderScoreHandle(map: ScoreRuleSchema["handle"]["map"]): string {
  const levels = map.map((tier) => (typeof tier === "string" ? tier : tier.level));
  const messages = map.flatMap((tier) =>
    typeof tier !== "string" && tier.message !== undefined ? [`"${tier.message}"`] : [],
  );
  return [`score map: ${levels.join(" → ")}`, ...messages].join(", ");
}

function renderThresholdHandle(handle: NoulRuleSchema["handle"]): string {
  const tiers = Object.entries(handle) as [string, Record<string, number | string>][];
  const thresholds = tiers.map(([level, op]) => {
    const [opName, threshold] = Object.entries(op)[0]!;
    return `${level} ${opName.replace(/_/g, " ")} ${threshold}`;
  });
  const messages = tiers.flatMap(([, op]) =>
    typeof op.message === "string" ? [`"${op.message}"`] : [],
  );
  return [...thresholds, ...messages].join(", ");
}

function renderChoiceHandle(choices: ChoiceRuleSchema["handle"]["choices"]): string {
  const entries = Object.entries(choices);
  const map = entries.map(
    ([label, tier]) => `${label} → ${typeof tier === "string" ? tier : tier.level}`,
  );
  const messages = entries.flatMap(([, tier]) =>
    typeof tier !== "string" && tier.message !== undefined ? [`"${tier.message}"`] : [],
  );
  return [`choice map: ${map.join(", ")}`, ...messages].join(", ");
}

export function renderHandleCell(spec: RuleSchema): string {
  if (spec.kind === "choice") return renderChoiceHandle(spec.handle.choices);
  return spec.kind === "score"
    ? renderScoreHandle(spec.handle.map)
    : renderThresholdHandle(spec.handle as NoulRuleSchema["handle"]);
}

export function renderRuleSection(spec: RuleSchema): string {
  const out: string[] = [];
  out.push(`## \`${spec.name}\`\n\n`);
  const handle = renderHandleCell(spec);
  // oxfmt-aligned tables: pad every cell to the column's widest entry, dash-rule included
  const cells = [
    ["kind", spec.kind ?? "noul"],
    // targets render joined: the explicit list form (the defaults' union) is one cell
    ["target", Array.isArray(spec.target) ? spec.target.join(", ") : String(spec.target)],
    ["handle", handle],
  ];
  const width = cells.map(([header, value]) => Math.max(header.length, value.length));
  const tableRow = (values: string[]) =>
    `| ${values.map((v, i) => v.padEnd(width[i]!)).join(" | ")} |\n`;
  out.push(tableRow(cells.map(([h]) => h)));
  out.push(`| ${width.map((w) => "-".repeat(w)).join(" | ")} |\n`);
  out.push(tableRow(cells.map(([, v]) => v)) + "\n");
  out.push(`**Instructions.** ${spec.instructions}\n\n`);
  if (spec.kind === "score") {
    spec.criteria.forEach((criterion, i) => out.push(`**Score ${i}.** ${criterion}\n\n`));
  } else if (spec.kind === "choice") {
    for (const [label, meaning] of Object.entries(spec.criteria)) {
      out.push(`**Option \`${label}\`.** ${meaning}\n\n`);
    }
  } else {
    out.push(`**True.** ${spec.criteria.true}\n\n`);
    out.push(`**False.** ${spec.criteria.false}\n\n`);
  }
  return out.join("");
}

export function renderRulesDoc(specs: readonly RuleSchema[]): string {
  const frontmatter =
    "---\n" +
    "title: Rules\n" +
    "description: The default rule set, rendered from the default rules. Generated - do not edit.\n" +
    "---\n\n";
  const out = [
    frontmatter,
    "# Default rules\n\n",
    "Rendered verbatim from the spec package (@jint/defaults). Instructions are the yes/no question " +
      "the classifier answers per element; criteria pins what each answer means; the target is the " +
      "element role the rule judges; the handle turns readings into findings. Editing any of these in " +
      "the specs is a recalibration event. Regenerate: `bun run schema`.\n\n",
  ];
  for (const spec of specs) out.push(renderRuleSection(spec));
  return out.join("").replace(/\n+$/, "\n");
}

// The rule-schema material, rendered from the same sources as the schema and the specs, so the
// authoring doc cannot rot behind the wire shape.
type SchemaPropertyMeta = {
  description?: string;
  const?: string;
  anyOf?: { description?: string; properties?: Record<string, unknown> }[];
};

export function extractRuleSchemaProps(): Record<string, SchemaPropertyMeta> {
  const ruleItems = (CONFIG_SCHEMA.properties.rules as { items: { anyOf: unknown[] } }).items;
  const ruleObject = ruleItems.anyOf.find(
    (v) => (v as { anyOf?: unknown[] }).anyOf !== undefined,
  ) as { anyOf: Array<{ properties: Record<string, { description?: string; const?: string }> }> };
  return ruleObject.anyOf[0]!.properties;
}

const FALLBACK_DESCRIPTIONS: Record<string, string> = {
  name: "The rule id: findings join back to it; config rules later in the array override same-named earlier ones.",
  criteria:
    "The answer contract: noul carries {true, false}; score carries an ordered rubric (score 0..N); choice carries named options (label -> meaning). The handle decides which answers fire.",
  target:
    "What the rule judges: files = the whole unit; functions/definitions/comments/imports = elements derived from the parse.",
  handle: "When readings surface as findings; the shape depends on kind (the descriptions below).",
  include:
    "Rule scoping: glob list over walked paths; replaces any fragment-level scope wholesale. Config exclude stays absolute.",
  exclude:
    "Rule scoping: glob list over walked paths; replaces any fragment-level scope wholesale. Config exclude stays absolute.",
};
const callbackHandle =
  'Callback custom rules (TS config only): handle may be a (results, ctx) => decisions function, one decision per reading: { severity: "error" | "warn" | null, message? }. Null severity is silent (measurement only). message is an instruction to the caller fixing the finding; severity says whether, message says how - it renders beneath the finding line and rides the report as finding.message.';

// Each handle form's description, read from the schema the loader validates against - one source,
// so the authoring doc cannot describe a handle the loader no longer accepts.
function handleDescription(props: Record<string, SchemaPropertyMeta>, key: string): string {
  const form = props.handle?.anyOf?.find((f) => f.properties !== undefined && key in f.properties);
  if (form?.description === undefined)
    throw new Error(`no handle form with '${key}' in the schema`);
  return form.description;
}

export function renderRuleSchemaBlock(props: Record<string, SchemaPropertyMeta>): string {
  const propRows = Object.entries(props)
    .map(
      ([key, meta]) =>
        "| `" +
        key +
        "` | " +
        (meta.description ?? FALLBACK_DESCRIPTIONS[key] ?? meta.const ?? "") +
        " |",
    )
    .join("\n");
  return [
    "| key | meaning |",
    "| --- | --- |",
    propRows,
    "",
    "Handles, one form per kind - direction lives in the handle, never in prose:",
    "",
    "- **noul** (yes/no): `" + handleDescription(props, "warn") + "`",
    "- **score** (scored rubric): `" + handleDescription(props, "map") + "`",
    "- **choice** (named options): `" + handleDescription(props, "choices") + "`",
    "",
    callbackHandle,
  ].join("\n");
}

// The fixer-message table, derived from the same handle message fields the
// findings renderer reads - never hand-copied, so the follower skill cannot
// drift from the messages it is told to execute.
export type FixerMessage = { rule: string; severity: string; message: string };

export function collectFixerMessages(specs: readonly RuleSchema[]): FixerMessage[] {
  const messages: FixerMessage[] = [];
  for (const spec of specs) {
    if (spec.kind === "choice") {
      for (const entry of Object.values(spec.handle.choices)) {
        if (typeof entry !== "string" && typeof entry.message === "string") {
          messages.push({ rule: spec.name, severity: entry.level, message: entry.message });
        }
      }
    } else if (spec.kind === "score") {
      for (const entry of spec.handle.map) {
        if (typeof entry !== "string" && typeof entry.message === "string") {
          messages.push({ rule: spec.name, severity: entry.level, message: entry.message });
        }
      }
    } else {
      for (const [level, op] of Object.entries(spec.handle)) {
        const message = (op as { message?: string }).message;
        if (typeof message === "string") {
          messages.push({ rule: spec.name, severity: level, message });
        }
      }
    }
  }
  return messages;
}

export function renderFixerTable(messages: readonly FixerMessage[]): string {
  return [
    "| rule | severity | fixer message |",
    "| --- | --- | --- |",
    ...messages.map((m) => `| \`${m.rule}\` | ${m.severity} | ${m.message} |`),
  ].join("\n");
}

// --- skills/jint-follow/SKILL.md -------------------------------------------
export function renderSkillFollow(specs: readonly RuleSchema[]): string {
  const fixerTable = renderFixerTable(collectFixerMessages(specs));
  const follow = [
    "---",
    "name: jint-follow",
    "description: >",
    "  Run jint on a path and resolve its findings. Use when measuring code quality,",
    "  naming, or comments and fixing what jint flags. Triggers: jint, jev lint.",
    "---",
    "",
    "<!-- Generated - do not edit. Regenerate with: bun run schema -->",
    "",
    "# jint - run it, fix what it flags",
    "",
    "jint measures code with AI-classifier judgments and prints findings: a severity",
    "and, for most rules, a fixer message that states the exact fix.",
    "",
    "## Run it",
    "",
    "Install: https://github.com/sedulustech/jint#install.",
    "`TYPESAFE_API_KEY` must be in the environment. Every flag, including output",
    "formats and scoping, lives in `jint --help` - the tool's own contract, not",
    "duplicated here.",
    "",
    "A whole path: `jint run <path>`. One element: `jint run <path>@L<line> --rule",
    "<rule>`. The CLI echoes which element an @L selector captured - verify that",
    "element is the one you mean before fixing anything.",
    "",
    "Anchors are PRE-EDIT. `@L<n>` names the line the run saw, not the line that",
    "exists now. After any edit, re-anchor: grep the declaration, re-run.",
    "",
    "## Read the findings",
    "",
    "A finding carries a severity and a fixer message. Severity + message is the",
    "whole actionable surface - not the schema, not thresholds, not score numbers.",
    "",
    "The canonical fixer message per rule (rendered from the same tables the CLI",
    "uses, so this cannot drift from the messages you will see):",
    "",
    fixerTable,
    "",
    "A finding without a row above carries no fixer message; the finding's own text",
    "is the instruction.",
    "",
    "## Spend",

    "Every run costs classifier spend. Measure the smallest surface that answers",
    "the question.",

    "- Fixing one finding: re-run scoped to that element (`path@L<line>`), not the",
    "  file, not the tree.",
    "- Working in one file: run that file, not the directory.",
    "- A full run is for discovering findings; scoped runs are for verifying a fix.",
    "## The fix loop",
    "",
    "1. Take a finding. Re-query just that unit:",
    "   `jint run <path>@L<line> --rule <rule>`. One query, one unit, one verdict.",
    "2. Read the element the CLI echoed. Verify it is the finding's target.",
    "3. Execute the fixer message EXACTLY. The message is canonical - do not",
    "   interpret, soften, or improve on it. Do not fork: no partial fix, no",
    "   rewording that leaves the flagged thing in place.",
    "4. Edit the source file itself. Captures and request dumps record what was",
    "   judged, not how the file is written now; their indentation is not source.",
    "5. Re-anchor at the current line and re-query to confirm the finding is gone.",
    "",
    "## Hard rules",
    "",
    "- Never edit rules, thresholds, the engine, or config to make a finding pass.",
    "- If you believe a finding is wrong, report it and stop. Do not work around it.",
    "- Do not read the schema, thresholds, or score numbers. Severity + message is",
    "  all you act on.",
    "",
  ];
  return follow.join("\n");
}

// The run UI and a reading's address in it: the verb and its description come from the CLI, the
// params from the app router - if the router drops one, generation fails instead of the skill
// teaching a dead link.
export function renderRunAddress(): string {
  const params = { rule: "<rule>", input: "<input>" };
  const accepted = validateRunSearch(params);
  for (const key of Object.keys(params)) {
    if (!(key in accepted)) throw new Error(`the run UI no longer accepts the '${key}' param`);
  }
  const query = Object.keys(params)
    .map((key) => `${key}=<${key}>`)
    .join("&");
  const serve = `\`${VERBS.serve.example}\`: ${VERBS.serve.blurb.split(" - ")[0]}; it prints its URL.`;
  return `${serve} A reading's address there: \`<serve url>/runs/<run.id>?${query}\`, with \`run.id\` and the reading's \`input\` from \`--json\`. URL-encode \`input\`: it contains \`#\`.`;
}

// --- skills/jint-author/SKILL.md -------------------------------------------
export function renderSkillAuthor(ruleSchemaBlock: string, exampleJson: string): string {
  const author = [
    "---",
    "name: jint-author",
    "description: >",
    "  Author and calibrate jint rules: criteria, handles, fixer messages, and the",
    "  calibration ritual - small tests on many languages - for promoting a rule to the",
    "  default set.",
    "  Triggers: rule calibration, jint rules.",
    "---",
    "",
    "<!-- Generated - do not edit. Regenerate with: bun run schema -->",
    "",
    "# jint - author and calibrate rules",
    "",
    "jint measures code: rules in, findings out. A **rule** compiles to one question",
    "for **jev** (TypeSafe's System One classifier); each answer is a calibrated",
    "reading; a reading that crosses the rule's thresholds becomes a **finding**.",
    "",
    "## Rules are data",
    "",
    "Every rule (noul included) may carry `instructions`: the yes/no question the",
    "model answers, one sentence, stating the claim. The compiler always prepends a",
    'kind sentence ("This unit is a function definition.") to whatever you write, so',
    "never state the element kind yourself. Changing instructions is a recalibration",
    "event. Criteria pin what each answer means; for score rules the ordered",
    "criteria list is the score legend (score 0..N).",
    "",
    ruleSchemaBlock,
    "",
    "A live config example, serialized from real default specs (always the current",
    "wire shape):",
    "",
    "```json",
    "AUTHOR_EXAMPLE_PLACEHOLDER",
    "```",
    "",
    "Worked examples and failure shapes: REFERENCE.md next to this file.",
    "",
    renderRunAddress(),
    "",
    "## Fixer messages are decisive",
    "",
    "A handle tier's `message` is the instruction the fixing agent executes. Write",
    'it imperative and singular: "Remove this comment." One action, no forks, no',
    'alternatives - a forked message ("remove it, or better, rewrite the function")',
    "gives the agent a choice, and a choice is where fixes die.",
    "",
    "Measured: an agent briefed with extra rule taxonomy kept 34 error-tier",
    'comments; an agent briefed only with "follow the fixer messages" reached zero.',
    "The message is the intervention. Everything else is rationalization material.",
    "",
    "## Preview the population",
    "",
    "Before calibrating, see what the rule will judge. `jint capture` runs the",
    "extraction only - no classifier calls, no cost:",
    "",
    "```bash",
    "jint capture <path>                  # every element: grammar, capture, span, name",
    "jint capture <path> --rule <name>    # mark the elements this rule judges",
    "```",
    "",
    "A defect in code that no element covers is invisible to every rule. If the",
    "construct you want judged is not an element, the fix is a capture in the",
    "grammar's queries.scm, not a rule: see docs/captures.md and docs/directives.md",
    "(https://github.com/sedulustech/jint/tree/main/docs).",
    "",
    "## The calibration ritual",
    "",
    "A rule is not promoted to the default set from one corpus:",
    "single-language calibration overfits that language's naming and structure",
    "conventions.",
    "",
    "- Test small on many languages, not big on a couple: a few healthy units plus",
    "  a few defective fixtures per language. A language's conventions show in a few",
    "  units; another hundred units of the same language add little.",
    "- Document the healthy-max / defective-min gap for each language; thresholds",
    "  must sit inside every measured gap.",
    "- Validate that the rule's claim survives each language's conventions (naming",
    "  style, file/package layout), not only its syntax.",
    "- Defective fixtures are mandatory: a rule with no defective example is a",
    "  hypothesis, not a rule.",
    "",
    'AGENTS.md ("Adding defaults") is the authority for this ritual, including the',
    "precedent (is_filename_fitting, issue 006: TS test 0.36/0.88, Go test",
    "0.25/0.72). Defer to it; do not restate thresholds here.",
    "",
  ];
  return author.join("\n").replace("AUTHOR_EXAMPLE_PLACEHOLDER", exampleJson);
}

const specJson = (spec: unknown) => JSON.stringify(spec, null, 2);

export function renderReference(noulSpec: RuleSchema, scoreSpec: RuleSchema): string {
  const reference = [
    "# jint authoring - reference",
    "",
    "Generated - do not edit. Regenerate with: `bun run schema`.",
    "",
    "## What jev is (read before writing criteria)",
    "",
    "jev is a System One classifier, not a chat model: it returns calibrated",
    "probabilities (noul, 0..1) or rubric scores, no explanations. Key properties:",
    "",
    "- **0.5 is undecided, not medium.** A noul of 0.45 vs 0.55 is not a ranking.",
    "- **Calibrated middle matters.** Thresholds live in the 0.3-0.8 band; generic",
    "  LLMs quantize to 0/1 and are useless here (measured: gemini flash-lite).",
    "- **State shape changes readings.** One state x many questions is valid; the",
    "  matrix form (many states + many questions in one call) averages everything.",
    "  jint handles this for you - never stack elements into one state yourself.",
    "",
    "## Noul example: a two-sided criteria contract",
    "",
    `Rendered from the live default spec \`${noulSpec.name}\` (always the current`,
    "wire shape):",
    "",
    "```json",
    specJson(noulSpec),
    "```",
    "",
    "Note the shape: `true` names the exact observable condition for yes, `false`",
    "for no, and both sides are exhaustive. The defect side decides the handle",
    "direction.",
    "",
    "## Score example: the scored rubric",
    "",
    "Use a rubric when the property is graded, not yes/no. The instructions carry a",
    'scoping sentence ("do not score X here"); the ordered criteria are the score',
    "legend; levels are descriptions, not true/false. Rendered from the live spec",
    `\`${scoreSpec.name}\`:`,
    "",
    "```json",
    specJson(scoreSpec),
    "```",
    "",
    "## The criteria shape that fails",
    "",
    "This shape reads reasonable and fails on a healthy corpus:",
    "",
    "```json",
    '  "rules": [',
    "    {",
    '      "name": "will_naming_drift",',
    '      "target": "definitions",',
    '      "criteria": {',
    '        "true": "The change introduces naming drift: the same concept is called by different names across the change.",',
    '        "false": "Naming is consistent."',
    "      },",
    '      "handle": { "warn": { "greater_than": 0.5 }, "error": { "greater_than": 0.7 } }',
    "    }",
    "  ]",
    "```",
    "",
    "It fails three ways: `false` is generic (name the exact observable condition),",
    "the claim spans multiple elements - the model compares against names it cannot",
    'see - and "drift" invites narrating quality instead of checking a condition.',
    "The fix is never thresholds; rewrite the criteria until they name an observable",
    "condition.",
    "",
  ];
  return reference.join("\n");
}

interface Row {
  target: string;
  namespace: string;
  singular: string;
  resolves: string;
  grammars: string;
  frame: string;
  scope: string;
}

const CAPTURE_NAMESPACE = "CAPTURE";
const FILE_NAMESPACE = "FILE";

export function renderTargetsDoc(
  census: Readonly<Record<string, ReadonlySet<string>>>,
  grammarOrder: readonly string[],
): string {
  /** Grammars whose .scm assigns any of `captures`, in registration order. */
  const emitting = (...captures: string[]): string =>
    grammarOrder.filter((language) => captures.some((c) => census[language]?.has(c))).join(", ") ||
    "none";

  const rows: Row[] = [
    {
      target: "files",
      namespace: FILE_NAMESPACE,
      singular: "file",
      resolves: "the whole unit as source text (no walk)",
      grammars: "every format (no grammar needed)",
      frame: "the unit's raw content under its path",
      scope: "yes",
    },
    {
      target: "functions",
      namespace: CAPTURE_NAMESPACE,
      singular: "function",
      resolves: "elements captured as functions",
      grammars: emitting("function"),
      frame: "attached run + inline comments + code (the pair frame)",
      scope: "yes",
    },
    {
      target: "classes",
      namespace: CAPTURE_NAMESPACE,
      singular: "class",
      resolves: "elements captured as classes (the @class capture: class-like units)",
      grammars: emitting("class"),
      frame: "attached run + inline comments + code (the pair frame)",
      scope: "yes",
    },
    {
      target: "methods",
      namespace: CAPTURE_NAMESPACE,
      singular: "method",
      resolves: "elements captured as methods (the @method capture: member functions)",
      grammars: emitting("method"),
      frame: "attached run + inline comments + code (the pair frame)",
      scope: "yes",
    },
    {
      target: "types",
      namespace: CAPTURE_NAMESPACE,
      singular: "type",
      resolves: "elements captured as types (interfaces, structs, enums, aliases)",
      grammars: emitting("type"),
      frame: "attached run + inline comments + code (the pair frame)",
      scope: "yes",
    },
    {
      target: "bindings",
      namespace: CAPTURE_NAMESPACE,
      singular: "binding",
      resolves: "elements captured as bindings (a name bound to a value)",
      grammars: emitting("binding"),
      frame: "attached run + inline comments + code (the pair frame)",
      scope: "yes",
    },
    {
      target: "definitions",
      namespace: CAPTURE_NAMESPACE,
      singular: "definition (umbrella)",
      resolves:
        "SHORTHAND for every definition capture at once (functions, classes, methods, types, bindings) - the same measured set; prefer the specific targets in new rules",
      grammars: emitting("function", "method", "class", "type", "binding"),
      frame: "attached run + inline comments + code (the pair frame)",
      scope: "yes",
    },
    {
      target: "comments",
      namespace: CAPTURE_NAMESPACE,
      singular: "definition (the pair frame)",
      resolves:
        "the DOCUMENTATION pair frame: a definition judged together with the comments it owns (attached run, internal notes, docstrings); a module docstring, which has no definition frame, is its own match. An owned comment element never matches separately, so a narration rule fires once per documented definition",
      grammars: emitting("comment", "docstring"),
      frame: "attached run + inline comments + docstrings + code (the pair frame)",
      scope: "yes",
    },
    {
      target: "loose-comments",
      namespace: CAPTURE_NAMESPACE,
      singular: "comment (element)",
      resolves:
        "comment elements NO definition owns: standalone runs and inline comments outside any definition (the complement of comments)",
      grammars: emitting("comment", "docstring"),
      frame: "the comment's own text under its path",
      scope: "yes",
    },
    {
      target: "imports",
      namespace: CAPTURE_NAMESPACE,
      singular: "import (element)",
      resolves: "the one merged import-group element per file",
      grammars: emitting("import"),
      frame: "the merged import statements",
      scope: "yes",
    },
  ];

  // Guard: the doc must have exactly one row per real target, no more, no fewer. A new target
  // without a row (or a row for a target that does not exist) fails generation loudly.
  const rowTargets = rows.map((r) => r.target).sort();
  const realTargets = [...ruleTargets].sort();
  if (JSON.stringify(rowTargets) !== JSON.stringify(realTargets)) {
    throw new Error(
      "targets doc drifted from the vocabulary: rows " +
        JSON.stringify(rowTargets) +
        " vs ruleTargets " +
        JSON.stringify(realTargets),
    );
  }

  const header = [
    "---\n",
    "title: Targets\n",
    "description: The rule-side target table, generated from the live resolution and the grammars' patterns.\n",
    "---\n\n",
    "# Rule targets\n\n",
    "GENERATED — do not edit. Regenerate with `bun run schema` (scripts/generate-schema.ts). The rows\n" +
      "come from the target vocabulary (`@jint/contract`), the resolution predicate\n" +
      "(`packages/sdk/src/core/rules/classify.ts`), and each grammar's own `queries.scm` census — a\n" +
      "rule resolves what this table says or the generator fails.\n\n",
    "The two rule-target namespaces are FILE / CAPTURE (`docs/designs/grammar-loading.md`).\n" +
      "The table below covers the CAPTURE namespace's fixed targets; a grammar's own capture is\n" +
      "addressed through the qualified `{grammar}:{capture}` form - markdown's four: " +
      "`markdown:section`, `markdown:paragraph`, `markdown:list_item`, `markdown:list`; " +
      "typescript's and tsx's top-level code: `typescript:statement_group`, `tsx:statement_group`.\n\n",
  ];

  const columns: [string, (r: Row) => string][] = [
    ["target", (r) => "`" + r.target + "`"],
    ["namespace", (r) => r.namespace],
    ["singular", (r) => r.singular],
    ["resolves to", (r) => r.resolves],
    ["grammars emitting it", (r) => r.grammars],
    ["frame carried", (r) => r.frame],
    ["scope-coupled", (r) => r.scope],
  ];

  const table = [
    "| " + columns.map(([h]) => h).join(" | ") + " |\n",
    "| " + columns.map(() => "---").join(" | ") + " |\n",
    ...rows.map((r) => "| " + columns.map(([, v]) => v(r)).join(" | ") + " |\n"),
  ];

  return header.join("") + table.join("");
}

// --- docs/directives.md ----------------------------------------------------
export function renderDirectivesDoc(
  rows: readonly DirectiveRow[],
  usage: ReadonlyMap<string, readonly string[]>,
): string {
  const escapePipes = (text: string) => text.replaceAll("|", "\\|");
  const lines = [
    "---",
    "title: Directives",
    "description: Every #set! directive a grammar's queries.scm may declare, generated from the loader's vocabulary.",
    "---",
    "",
    "# Grammar directives",
    "",
    "GENERATED — do not edit. Regenerate with `bun run schema` (scripts/generate-schema.ts). The rows",
    "come from the directive vocabulary the loader validates against",
    "(`packages/sdk/src/core/grammars/query.ts`); a directive not listed here fails at load.",
    "",
    'A directive rides a pattern in `queries.scm`: `(pattern) @capture (#set! "<name>" "<value>")`.',
    "One name, one setting per file. A `capture.<name>.*` directive must ride a pattern that binds",
    "`@<name>`. How captures become elements, and how to check them: docs/captures.md.",
    "",
    "| directive | values | what it does | declared in |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| \`${row.name}\` | ${escapePipes(row.values)} | ${escapePipes(row.summary)} | ${(usage.get(row.name) ?? ["—"]).join(", ")} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Edge: the only code that touches the filesystem. Everything above is pure.
// ---------------------------------------------------------------------------

function repoPath(rel: string): string {
  return new URL("../" + rel, import.meta.url).pathname;
}

const embeddedDir = new URL("../packages/sdk/src/core/grammars/embedded/", import.meta.url)
  .pathname;

function readEmbeddedQueriesScm(language: string): string {
  return readFileSync(embeddedDir + language + "/queries.scm", "utf8");
}

/** Per grammar: which element captures its .scm actually assigns (the keyword census). */
function captureCensus(): Record<string, Set<string>> {
  const census: Record<string, Set<string>> = {};
  for (const language of knownLanguages()) {
    const scm = readEmbeddedQueriesScm(language);
    const found = new Set<string>();
    const declared = scmCaptureDeclarations(scm);
    for (const pattern of parseScmPatterns(scm)) {
      // addressable = shared (lingua franca) or declared autonomous (the open namespace):
      // the census counts what a rule could ADDRESS, declared captures included
      if (
        pattern.capture !== null &&
        (isSharedCapture(pattern.capture) || declared.definitions.has(pattern.capture))
      )
        found.add(pattern.capture);
    }
    census[language] = found;
  }
  return census;
}

/** The directive reference row a #set! name belongs to, and the capture it names, if any. */
function directiveRowOf(name: string): { row: string; capture?: string } {
  const knob = name.match(/^capture\.([^.]+)\.(.+)$/);
  return knob === null ? { row: name } : { row: `capture.<name>.${knob[2]}`, capture: knob[1] };
}

/** Per directive row: the embedded grammars declaring it, as "grammar" or "grammar (captures)". */
function directiveUsageByGrammar(): Map<string, string[]> {
  const capturesByGrammarByRow = new Map<string, Map<string, Set<string>>>();
  for (const language of knownLanguages()) {
    for (const directive of scmDirectives(readEmbeddedQueriesScm(language))) {
      const { row, capture } = directiveRowOf(directive.name);
      const byGrammar = capturesByGrammarByRow.get(row) ?? new Map<string, Set<string>>();
      const captures = byGrammar.get(language) ?? new Set<string>();
      if (capture !== undefined) captures.add(capture);
      byGrammar.set(language, captures);
      capturesByGrammarByRow.set(row, byGrammar);
    }
  }
  const usage = new Map<string, string[]>();
  for (const [row, byGrammar] of capturesByGrammarByRow) {
    const grammars = [...byGrammar].map(([language, captures]) =>
      captures.size === 0 ? language : `${language} (${[...captures].join(", ")})`,
    );
    usage.set(row, grammars);
  }
  return usage;
}

function writeGeneratedOutputs() {
  const schemaOut = repoPath(GENERATED_OUTPUTS[0]!);
  writeFileSync(schemaOut, renderSchemaJson());
  // Match the repo formatter so `bun run schema` output is stable under `bun run lint`.
  Bun.spawnSync(["bunx", "oxfmt", schemaOut]);
  process.stdout.write("wrote " + schemaOut + "\n");

  const mdxOut = repoPath(GENERATED_OUTPUTS[1]!);
  writeFileSync(mdxOut, renderRulesDoc(defaultSpecs));
  process.stdout.write("wrote " + mdxOut + "\n");

  const followOut = repoPath(GENERATED_OUTPUTS[2]!);
  writeFileSync(followOut, renderSkillFollow(defaultSpecs));
  Bun.spawnSync(["bunx", "oxfmt", followOut]);
  process.stdout.write("wrote " + followOut + "\n");

  const authorOut = repoPath(GENERATED_OUTPUTS[3]!);
  const example = {
    $schema: "./jint.schema.json",
    rules: [
      defaultSpecs.find((spec) => spec.name === "is_greppable"),
      defaultSpecs.find((spec) => spec.name === "is_cognitively_complex"),
    ],
  };
  writeFileSync(
    authorOut,
    renderSkillAuthor(
      renderRuleSchemaBlock(extractRuleSchemaProps()),
      JSON.stringify(example, null, 2),
    ),
  );
  process.stdout.write("wrote " + authorOut + "\n");

  const referenceOut = repoPath(GENERATED_OUTPUTS[4]!);
  writeFileSync(
    referenceOut,
    renderReference(
      defaultSpecs.find((spec) => spec.name === "is_greppable")!,
      defaultSpecs.find((spec) => spec.name === "is_cognitively_complex")!,
    ),
  );
  Bun.spawnSync(["bunx", "oxfmt", authorOut, referenceOut]);
  process.stdout.write("wrote " + referenceOut + "\n");

  const targetsOut = repoPath(GENERATED_OUTPUTS[5]!);
  writeFileSync(targetsOut, renderTargetsDoc(captureCensus(), knownLanguages()));
  Bun.spawnSync(["bunx", "oxfmt", targetsOut]);
  process.stdout.write("wrote " + targetsOut + "\n");

  const directivesOut = repoPath(GENERATED_OUTPUTS[6]!);
  writeFileSync(
    directivesOut,
    renderDirectivesDoc(directiveVocabulary(), directiveUsageByGrammar()),
  );
  Bun.spawnSync(["bunx", "oxfmt", directivesOut]);
  process.stdout.write("wrote " + directivesOut + "\n");
}

if (import.meta.main) writeGeneratedOutputs();
