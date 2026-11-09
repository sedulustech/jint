/**
 * Regenerates the checked-in generated artifacts from source:
 *
 * - Jint.schema.json from CONFIG_SCHEMA (packages/sdk/src/config/load.ts)
 * - The generated regions in skills/jint-follow/SKILL.md, skills/jint-author/SKILL.md and
 *   skills/jint-author/REFERENCE.md: the fixer table, the rule schema, the live examples and the
 *   run-UI address. The prose around them is hand-written
 * - The generated tables in docs/targets.md (the target vocabulary and each embedded grammar's
 *   queries.scm census) and docs/directives.md (the loader's directive vocabulary): the prose
 *   around the markers is hand-written
 *
 * Run after any config-schema, rule-domain, or skill change: bun run schema (wired into bun run
 * validate). Outputs are checked in so editors resolve "$schema" without running jint and docs stay
 * browsable, and CI diffs them against this output to catch drift - generated means never stale.
 *
 * Structure: pure render functions (strings in, strings out) plus GENERATED_OUTPUTS; a thin
 * writeGeneratedOutputs() edge is the only code that touches the filesystem. Consumers of the
 * renderers: scripts/generate-schema.test.ts (synthetic-spec unit tests) and
 * tests/generated-outputs.test.ts (freshness over every generated output, driven by
 * GENERATED_OUTPUTS).
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { allRules as allSpecs } from "@jint/rules";
import { CONFIG_SCHEMA, ENV_VARS } from "@jint/sdk";
import { validateRunSearch } from "../packages/app/src/router.tsx";
import { FLAGS, VERBS } from "../packages/cli/src/cli.ts";
import { ruleTargets } from "../packages/contract/src/handlers.ts";
import { EMBEDDED } from "../packages/sdk/src/core/grammars/grammars.ts";
import { directiveVocabulary, type DirectiveRow } from "../packages/sdk/src/core/grammars/query.ts";
import type { ChoiceRuleSchema, NoulRuleSchema, RuleSchema, ScoreRuleSchema } from "@jint/contract";

const GENERATION_NOTE =
  "GENERATED FILE — do not edit. Regenerate with: bun run schema (scripts/generate-schema.ts, from src/config/load.ts CONFIG_SCHEMA).";

export const GENERATED_OUTPUTS = [
  "jint.schema.json",
  "skills/jint-follow/SKILL.md",
  "skills/jint-author/SKILL.md",
  "skills/jint-author/REFERENCE.md",
  "docs/targets.md",
  "docs/directives.md",
  "docs/config.md",
  "docs/grammars.md",
  "packages/sdk/src/core/grammars/embedded/SOURCES.md",
  "docs/reference/config.md",
  "docs/reference/environment.md",
  "docs/reference/cli.md",
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

function renderChoiceHandle(handle: ChoiceRuleSchema["handle"]): string {
  const entries = Object.entries(handle.choices);
  const undecided = handle.undecided;
  const map = entries.map(
    ([label, tier]) => `${label} → ${typeof tier === "string" ? tier : tier.level}`,
  );
  if (undecided) map.push(`undecided (margin < ${undecided.margin}) → ${undecided.level}`);
  const tiers = [...entries.map(([, tier]) => tier), ...(undecided ? [undecided] : [])];
  const messages = tiers.flatMap((tier) =>
    typeof tier !== "string" && tier.message !== undefined ? [`"${tier.message}"`] : [],
  );
  return [`choice map: ${map.join(", ")}`, ...messages].join(", ");
}

export function renderHandleCell(spec: RuleSchema): string {
  if (spec.kind === "choice") return renderChoiceHandle(spec.handle);
  return spec.kind === "score"
    ? renderScoreHandle(spec.handle.map)
    : renderThresholdHandle(spec.handle as NoulRuleSchema["handle"]);
}

export function renderRuleSection(spec: RuleSchema, heading = "##"): string {
  const out: string[] = [];
  out.push(`${heading} \`${spec.name}\`\n\n`);
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

// The rule-schema material, rendered from the same sources as the schema and the specs, so the
// authoring doc cannot rot behind the wire shape.
type SchemaPropertyMeta = {
  description?: string;
  const?: string;
  anyOf?: { description?: string; properties?: Record<string, unknown> }[];
};

export function extractRuleSchemaProps(): Record<string, SchemaPropertyMeta> {
  const ruleItems = (
    CONFIG_SCHEMA.properties.rules as {
      properties: { use: { items: { anyOf: unknown[] } } };
    }
  ).properties.use.items;
  const ruleObject = ruleItems.anyOf.find(
    (v) => (v as { anyOf?: unknown[] }).anyOf !== undefined,
  ) as { anyOf: Array<{ properties: Record<string, { description?: string; const?: string }> }> };
  return ruleObject.anyOf[0]!.properties;
}

const FALLBACK_DESCRIPTIONS: Record<string, string> = {
  name: "The rule id: findings join back to it. Two entries with one name are a config error unless the later one sets override.",
  criteria:
    "The answer contract: noul carries {true, false}; score carries an ordered rubric (score 0..N); choice carries named options (label -> meaning). The handle decides which answers fire.",
  target:
    "What the rule judges: files = the whole unit; functions/definitions/comments/imports = elements derived from the parse.",
  handle:
    "When classifications surface as findings; the shape depends on kind (the descriptions below).",
  include:
    "Rule scoping: glob list over paths. Replaces the config's rules scope for this rule, and claims its files across the config rules.exclude. A rule without include follows the config's rules scope.",
  exclude:
    "Rule scoping: glob list over paths; always wins over this rule's include. Replaces the config's rules.exclude for this rule.",
};
const callbackHandle =
  'Callback custom rules (TS config only): handle may be a (results, ctx) => decisions function, one decision per classification: { severity: "error" | "warn" | null, message? }. Null severity is silent (classification only). message is an instruction to the caller fixing the finding; severity says whether, message says how - it renders beneath the finding line and rides the report as finding.message.';

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
      const undecided = spec.handle.undecided;
      for (const entry of [
        ...Object.values(spec.handle.choices),
        ...(undecided ? [undecided] : []),
      ]) {
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

// The run UI and a classification's address in it: the verb and its description come from the CLI, the
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
  return `${serve} A classification's address there: \`<serve url>/runs/<run.id>?${query}\`, with \`run.id\` and the classification's \`input\` from \`--json\`. URL-encode \`input\`: it contains \`#\`.`;
}

// --- skills ----------------------------------------------------------------
// The skills are hand-written. Only what drifts from its source is generated into them, as marked
// regions: the fixer table, the rule schema, the live examples, the run-UI address.

/** A live spec as a fenced json block, always the current wire shape. */
export function renderSpecBlock(spec: unknown): string {
  return ["```json", JSON.stringify(spec, null, 2), "```"].join("\n");
}

interface Row {
  target: string;
  namespace: string;
  singular: string;
  resolves: string;
  frame: string;
  scope: string;
}

const CAPTURE_NAMESPACE = "CAPTURE";
const FILE_NAMESPACE = "FILE";

export function renderTargetsTable(): string {
  const rows: Row[] = [
    {
      target: "files",
      namespace: FILE_NAMESPACE,
      singular: "file",
      resolves: "the whole unit as source text (no walk)",
      frame: "the unit's raw content under its path",
      scope: "yes",
    },
    {
      target: "functions",
      namespace: CAPTURE_NAMESPACE,
      singular: "function",
      resolves: "elements captured as functions",
      frame: "attached run + inline comments + code (the pair frame)",
      scope: "yes",
    },
    {
      target: "classes",
      namespace: CAPTURE_NAMESPACE,
      singular: "class",
      resolves: "elements captured as classes (the @class capture: class-like units)",
      frame: "attached run + inline comments + code (the pair frame)",
      scope: "yes",
    },
    {
      target: "methods",
      namespace: CAPTURE_NAMESPACE,
      singular: "method",
      resolves: "elements captured as methods (the @method capture: member functions)",
      frame: "attached run + inline comments + code (the pair frame)",
      scope: "yes",
    },
    {
      target: "types",
      namespace: CAPTURE_NAMESPACE,
      singular: "type",
      resolves: "elements captured as types (interfaces, structs, enums, aliases)",
      frame: "attached run + inline comments + code (the pair frame)",
      scope: "yes",
    },
    {
      target: "bindings",
      namespace: CAPTURE_NAMESPACE,
      singular: "binding",
      resolves: "elements captured as bindings (a name bound to a value)",
      frame: "attached run + inline comments + code (the pair frame)",
      scope: "yes",
    },
    {
      target: "definitions",
      namespace: CAPTURE_NAMESPACE,
      singular: "definition (umbrella)",
      resolves:
        "elements captured as functions, classes, methods, types or bindings (a shorthand: prefer the specific targets in new rules)",
      frame: "attached run + inline comments + code (the pair frame)",
      scope: "yes",
    },
    {
      target: "comments",
      namespace: CAPTURE_NAMESPACE,
      singular: "definition (the pair frame)",
      resolves:
        "elements captured as comments, plus the definition each one belongs to (the comments above it, inside it, and its docstring)",
      frame: "attached run + inline comments + docstrings + code (the pair frame)",
      scope: "yes",
    },
    {
      target: "loose-comments",
      namespace: CAPTURE_NAMESPACE,
      singular: "comment (element)",
      resolves:
        "elements captured as standalone comments, with no definition they belong to: runs of comments and inline comments outside any definition",
      frame: "the comment's own text under its path",
      scope: "yes",
    },
    {
      target: "imports",
      namespace: CAPTURE_NAMESPACE,
      singular: "import (element)",
      resolves: "elements captured as imports: one merged import group per file",
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

  const columns: [string, (r: Row) => string][] = [
    ["target", (r) => "`" + r.target + "`"],
    ["resolves to", (r) => r.resolves],
  ];

  const table = [
    "| " + columns.map(([h]) => h).join(" | ") + " |\n",
    "| " + columns.map(() => "---").join(" | ") + " |\n",
    ...rows.map((r) => "| " + columns.map(([, v]) => v(r)).join(" | ") + " |\n"),
  ];

  return table.join("");
}

// --- docs/grammars.md ------------------------------------------------------
/**
 * The embedded grammars, one row each in registration order (the order that settles a shared
 * extension).
 */
export function renderGrammarsTable(): string {
  const rows = Object.values(EMBEDDED).map((entry) => {
    const extensions = entry.extensions.map((e) => "`." + e.replace(/^\./, "") + "`").join(", ");
    return `| \`${entry.language}\` | ${extensions} |`;
  });
  return ["| grammar | extensions |", "| --- | --- |", ...rows].join("\n");
}

// --- embedded/SOURCES.md ---------------------------------------------------
const EMBEDDED_DIR = "packages/sdk/src/core/grammars/embedded/";

/**
 * Where each embedded wasm came from: the upstream repo and release (embedded/sources.json, the one
 * hand-written fact) beside the sha256 of the wasm in the tree (read here, so it cannot drift from
 * the file). Anyone can compare a row with the release asset of the same name.
 */
export function renderGrammarSources(): string {
  const sources = JSON.parse(
    readFileSync(REPO_ROOT + EMBEDDED_DIR + "sources.json", "utf8"),
  ) as Record<string, { repo: string; version: string }>;
  const rows = Object.keys(EMBEDDED).map((id) => {
    const source = sources[id];
    if (source === undefined) throw new Error(`embedded/sources.json has no entry for ${id}`);
    const sha = createHash("sha256")
      .update(readFileSync(REPO_ROOT + EMBEDDED_DIR + `${id}/${id}.wasm`))
      .digest("hex");
    const link = `[${source.repo}](https://github.com/${source.repo}/releases/tag/v${source.version})`;
    return `| \`${id}\` | ${link} | ${source.version} | \`${sha}\` |`;
  });
  return [
    "<!-- GENERATED FILE — do not edit. Regenerate with: bun run schema (embedded/sources.json is the input). -->",
    "",
    "# Embedded grammar sources",
    "",
    "Each wasm is the file attached to the upstream release of the same version. Compare a row with `sha256sum` of that asset.",
    "",
    "| grammar | repo | release | sha256 of the wasm |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

// --- docs/directives.md ----------------------------------------------------
export function renderDirectivesTable(rows: readonly DirectiveRow[]): string {
  const escapePipes = (text: string) => text.replaceAll("|", "\\|");
  const lines = [
    "| directive | values | what it does |",
    "| --- | --- | --- |",
    ...rows.map(
      (row) => `| \`${row.name}\` | ${escapePipes(row.values)} | ${escapePipes(row.summary)} |`,
    ),
  ];
  return lines.join("\n") + "\n";
}

// --- docs/config.md ---------------------------------------------------------
type ConfigNode = {
  description?: string;
  examples?: readonly unknown[];
  properties?: Record<string, ConfigNode>;
};

/** `text` as `// ` comment lines wrapped to `width` columns, at `indent`. */
function commentLines(text: string, indent: string, width = 90): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && (indent + "// " + line + " " + word).length > width) {
      lines.push(indent + "// " + line);
      line = word;
    } else line = line === "" ? word : line + " " + word;
  }
  return [...lines, indent + "// " + line];
}

function renderConfigKeys(properties: Record<string, ConfigNode>, indent: string): string[] {
  const lines: string[] = [];
  for (const [key, node] of Object.entries(properties)) {
    if (key === "$schema") continue;
    if (node.description === undefined && node.properties === undefined) {
      throw new Error(`config key ${key} has no description in CONFIG_SCHEMA`);
    }
    if (node.description !== undefined) lines.push(...commentLines(node.description, indent));
    if (node.properties !== undefined) {
      lines.push(
        `${indent}${key}: {`,
        ...renderConfigKeys(node.properties, indent + "  "),
        `${indent}},`,
      );
      continue;
    }
    if (node.examples?.[0] === undefined) throw new Error(`config key ${key} has no example`);
    lines.push(`${indent}${key}: ${JSON.stringify(node.examples[0])},`);
  }
  return lines;
}

type TableNode = {
  type?: string;
  description?: string;
  default?: unknown;
  required?: readonly string[];
  properties?: Record<string, TableNode>;
  items?: TableNode;
  anyOf?: TableNode[];
  patternProperties?: Record<string, TableNode>;
  additionalProperties?: TableNode | boolean;
};

/** The words for a schema node's type: a table reader sees `list`, not `array`. */
function typeWord(node: TableNode): string {
  if (node.anyOf !== undefined) return "one of several";
  if (node.type === "array") return node.items?.type === "string" ? "string list" : "list";
  if (node.type === "object") return "object";
  return node.type ?? "value";
}

const withDefault = (node: TableNode): string =>
  (node.description ?? "") + (node.default === undefined ? "" : ` Default ${node.default}.`);

const tableRow = (field: string, node: TableNode): string =>
  `| \`${field}\` | ${typeWord(node)} | ${withDefault(node).replaceAll("|", "\\|")} |`;

/** The run settings: every top-level key but the schema URL and the rules, from CONFIG_SCHEMA. */
export function renderRunSettingsTable(): string {
  const props = CONFIG_SCHEMA.properties as unknown as Record<string, TableNode>;
  const rows = Object.entries(props)
    .filter(([key]) => key !== "$schema" && key !== "rules")
    .map(([key, node]) => tableRow(key, node));
  return ["| Key | Type | Meaning |", "| --- | --- | --- |", ...rows].join("\n") + "\n";
}

/**
 * The fields of a rule, from CONFIG_SCHEMA. The three kinds share most fields, so a field appears
 * once, with the first description the schema gives it. A nested object lists its own fields under
 * a dotted path.
 */
export function renderRuleFieldsTable(): string {
  const props = CONFIG_SCHEMA.properties as unknown as Record<string, TableNode>;
  const use = props["rules"]!.properties!["use"]!;
  const seen = new Map<string, TableNode>();
  const visit = (node: TableNode, path: string) => {
    for (const branch of node.anyOf ?? []) visit(branch, path);
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      const at = path === "" ? key : `${path}.${key}`;
      if (!seen.has(at) && child.description !== undefined) seen.set(at, child);
      visit(child, at);
    }
    if (node.items !== undefined) visit(node.items, path);
  };
  visit(use.items!, "");
  const rows = [...seen].map(([field, node]) => tableRow(field, node));
  return ["| Field | Type | Meaning |", "| --- | --- | --- |", ...rows].join("\n") + "\n";
}

const cell = (text: string): string => text.replaceAll("|", "\\|").replaceAll("\n", " ");

/** The environment variables, from ENV_VARS: the one list a guard test keeps whole. */
export function renderEnvTable(): string {
  const rows = ENV_VARS.map((v) => `| \`${v.name}\` | ${cell(v.default)} | ${cell(v.meaning)} |`);
  return ["| Variable | Default | Meaning |", "| --- | --- | --- |", ...rows].join("\n") + "\n";
}

/** The verbs and the flags of the CLI, from the tables the parser and the help text read. */
export function renderCliReference(): string {
  const verbs = Object.entries(VERBS).map(
    ([name, verb]) => `| \`${name}\` | \`${verb.example}\` | ${cell(verb.blurb)} |`,
  );
  const flags = Object.entries(FLAGS).map(([name, flag]) => {
    const spec = flag as {
      arg?: string;
      aliases?: readonly string[];
      blurb: string;
      verbs?: readonly string[];
    };
    const names = [name, ...(spec.aliases ?? [])].map((n) => `\`${n}\``).join(", ");
    const arg = spec.arg === undefined ? "" : `\`${spec.arg}\``;
    return `| ${names} | ${arg} | ${spec.verbs === undefined ? "all" : spec.verbs.join(", ")} | ${cell(spec.blurb)} |`;
  });
  return (
    [
      "## Verbs",
      "",
      "The first operand is the verb. There is no default verb.",
      "",
      "| Verb | Example | What it does |",
      "| --- | --- | --- |",
      ...verbs,
      "",
      "## Flags",
      "",
      "| Flag | Argument | Verbs | Meaning |",
      "| --- | --- | --- | --- |",
      ...flags,
    ].join("\n") + "\n"
  );
}

/** A schema node's type as a reader writes it in a config: `string[]`, not `array`. */
function typeLabel(node: TableNode): string {
  if (node.anyOf !== undefined) return "string | object";
  if (node.type === "array") return node.items?.type === "string" ? "string[]" : "object[]";
  return node.type ?? "value";
}

/** One field: its name on the left, its type, default and requiredness as pills on the right. */
function renderFieldEntry(path: string, node: TableNode, required: boolean): string {
  const pill = (text: string) => `<span class="pill">${text}</span>`;
  const pills = [
    pill(typeLabel(node)),
    ...(node.default === undefined ? [] : [pill(`default ${node.default}`)]),
    ...(required ? [pill("required")] : []),
  ].join("");
  const id = path.replaceAll(".", "-").toLowerCase();
  return [
    `<h3 id="${id}" class="field"><code>${path}</code><span class="pills">${pills}</span></h3>`,
    "",
    (node.description ?? "").replaceAll("\n", " "),
    "",
  ].join("\n");
}

/** The config reference: every key and rule field as one entry, all from the schema. */
export function renderConfigReference(): string {
  const root = CONFIG_SCHEMA as unknown as TableNode;
  const props = root.properties!;
  const rules = props["rules"]!;
  const run = Object.entries(props).filter(([key]) => key !== "$schema" && key !== "rules");
  const scope = Object.entries(rules.properties!).filter(([key]) => key !== "use");
  const fields = new Map<string, { node: TableNode; required: boolean }>();
  const visit = (node: TableNode, path: string) => {
    for (const branch of node.anyOf ?? []) visit(branch, path);
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      const at = path === "" ? key : `${path}.${key}`;
      if (!fields.has(at) && child.description !== undefined) {
        fields.set(at, { node: child, required: (node.required ?? []).includes(key) });
      }
      visit(child, at);
    }
    if (node.items !== undefined) visit(node.items, path);
  };
  visit(rules.properties!["use"]!.items!, "");
  return [
    "## Run settings",
    "",
    ...run.map(([key, node]) => renderFieldEntry(key, node, (root.required ?? []).includes(key))),
    "## Rule scope",
    "",
    ...scope.map(([key, node]) =>
      renderFieldEntry(`rules.${key}`, node, (rules.required ?? []).includes(key)),
    ),
    "## Rule fields",
    "",
    "Each entry of `rules.use` is a rule name or a rule object with these fields.",
    "",
    ...[...fields].map(([path, { node, required }]) => renderFieldEntry(path, node, required)),
  ].join("\n");
}

/** The config file with every key, each with its description as a comment above it. */
export function renderConfigExample(): string {
  const keys = renderConfigKeys(CONFIG_SCHEMA.properties as Record<string, ConfigNode>, "  ");
  return [
    "```ts",
    'import { defineConfig } from "jint:sdk";',
    "",
    "export default defineConfig({",
    ...keys,
    "});",
    "```",
  ].join("\n");
}

/**
 * Replaces the body between a doc's `<!-- generated:<name> ... -->` and `<!-- /generated:<name>
 * -->` markers. The prose around the markers is hand-written and stays as it is; the open marker
 * spells the regenerate command, so a file with a generated region is declared in
 * GENERATED_OUTPUTS.
 */
export function spliceGenerated(doc: string, name: string, body: string): string {
  const open = doc.match(new RegExp(`<!-- generated:${name}\\b[^\\n]*-->\\n`));
  const closeTag = `<!-- /generated:${name} -->`;
  const close = doc.indexOf(closeTag);
  if (open?.index === undefined || close < open.index + open[0].length) {
    throw new Error(`doc has no generated:${name} region (open and close markers)`);
  }
  return doc.slice(0, open.index + open[0].length) + "\n" + body + "\n" + doc.slice(close);
}

// ---------------------------------------------------------------------------
// Edge: the only code that touches the filesystem. Everything above is pure.
// ---------------------------------------------------------------------------

const REPO_ROOT = new URL("../", import.meta.url).pathname;

/** Where an output lands under an output root: the repo itself, or a directory a caller owns. */
function outPath(root: string, rel: string): string {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

/**
 * Writes every generated output under `root` (the repo by default). A test passes a temp directory
 * so regenerating never rewrites the tracked files other processes may be reading. The formatter
 * runs ONCE over the files that need it, from the repo root so it finds the repo's formatter
 * config.
 */
function writeGeneratedOutputs(rootArg: string = REPO_ROOT) {
  const root = resolve(rootArg);
  const formatted: string[] = [];
  const schemaOut = outPath(root, GENERATED_OUTPUTS[0]!);
  writeFileSync(schemaOut, renderSchemaJson());
  formatted.push(schemaOut);
  process.stdout.write("wrote " + schemaOut + "\n");

  const spliceInto = (index: number, regions: Record<string, string>) => {
    const out = outPath(root, GENERATED_OUTPUTS[index]!);
    let doc = readFileSync(REPO_ROOT + GENERATED_OUTPUTS[index]!, "utf8");
    for (const [name, body] of Object.entries(regions)) doc = spliceGenerated(doc, name, body);
    writeFileSync(out, doc);
    formatted.push(out);
    process.stdout.write("wrote " + out + "\n");
  };
  const byName = (name: string) => allSpecs.find((spec) => spec.name === name);
  spliceInto(1, { "fixer-table": renderFixerTable(collectFixerMessages(allSpecs)) });
  spliceInto(2, {
    "rule-schema": renderRuleSchemaBlock(extractRuleSchemaProps()),
    "config-example": renderSpecBlock({
      $schema: "./jint.schema.json",
      rules: { use: [byName("is_greppable"), byName("is_cognitively_complex")] },
    }),
    "run-address": renderRunAddress(),
  });
  spliceInto(3, {
    "noul-example": renderSpecBlock(byName("is_greppable")),
    "score-example": renderSpecBlock(byName("is_cognitively_complex")),
  });

  const targetsOut = outPath(root, GENERATED_OUTPUTS[4]!);
  writeFileSync(
    targetsOut,
    spliceGenerated(
      readFileSync(REPO_ROOT + GENERATED_OUTPUTS[4]!, "utf8"),
      "targets",
      renderTargetsTable(),
    ),
  );
  formatted.push(targetsOut);
  process.stdout.write("wrote " + targetsOut + "\n");

  const directivesOut = outPath(root, GENERATED_OUTPUTS[5]!);
  writeFileSync(
    directivesOut,
    spliceGenerated(
      readFileSync(REPO_ROOT + GENERATED_OUTPUTS[5]!, "utf8"),
      "directives",
      renderDirectivesTable(directiveVocabulary()),
    ),
  );
  formatted.push(directivesOut);
  const configOut = outPath(root, GENERATED_OUTPUTS[6]!);
  writeFileSync(
    configOut,
    spliceGenerated(
      readFileSync(REPO_ROOT + GENERATED_OUTPUTS[6]!, "utf8"),
      "config",
      renderConfigExample(),
    ),
  );
  writeFileSync(
    configOut,
    ["run-settings", "rule-fields"].reduce(
      (doc, name) =>
        spliceGenerated(
          doc,
          name,
          name === "run-settings" ? renderRunSettingsTable() : renderRuleFieldsTable(),
        ),
      readFileSync(configOut, "utf8"),
    ),
  );
  formatted.push(configOut);
  process.stdout.write("wrote " + configOut + "\n");
  // Match the repo formatter so `bun run schema` output is stable under `bun run lint`.
  Bun.spawnSync([join(REPO_ROOT, "node_modules/.bin/oxfmt"), ...formatted], { cwd: REPO_ROOT });
  process.stdout.write("wrote " + directivesOut + "\n");

  const reference: [number, () => string][] = [
    [9, renderConfigReference],
    [10, renderEnvTable],
    [11, renderCliReference],
  ];
  for (const [index, render] of reference) {
    const out = outPath(root, GENERATED_OUTPUTS[index]!);
    writeFileSync(
      out,
      spliceGenerated(
        readFileSync(REPO_ROOT + GENERATED_OUTPUTS[index]!, "utf8"),
        "reference",
        render(),
      ),
    );
    Bun.spawnSync([join(REPO_ROOT, "node_modules/.bin/oxfmt"), out], { cwd: REPO_ROOT });
    process.stdout.write("wrote " + out + "\n");
  }

  const grammarsOut = outPath(root, GENERATED_OUTPUTS[7]!);
  writeFileSync(
    grammarsOut,
    spliceGenerated(
      readFileSync(REPO_ROOT + GENERATED_OUTPUTS[7]!, "utf8"),
      "grammars",
      renderGrammarsTable(),
    ),
  );
  process.stdout.write("wrote " + grammarsOut + "\n");

  const sourcesOut = outPath(root, GENERATED_OUTPUTS[8]!);
  writeFileSync(sourcesOut, renderGrammarSources());
  Bun.spawnSync([join(REPO_ROOT, "node_modules/.bin/oxfmt"), grammarsOut, sourcesOut], {
    cwd: REPO_ROOT,
  });
  process.stdout.write("wrote " + sourcesOut + "\n");
}

if (import.meta.main) writeGeneratedOutputs(process.argv[2]);
