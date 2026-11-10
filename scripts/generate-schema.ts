/**
 * Regenerates the checked-in generated artifacts from source:
 *
 * - Jint.schema.json from CONFIG_SCHEMA (packages/sdk/src/config/load.ts)
 * - The run-UI address region in skills/writing-rules/SKILL.md: the prose around it is hand-written
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
import { CONFIG_SCHEMA, ENV_VARS } from "@jint/sdk";
import { validateRunSearch } from "../packages/app/src/router.tsx";
import {
  FLAGS,
  GLOBAL_FLAG_NAMES,
  NOUNS,
  VERBS,
  flagBlurb,
  flagExample,
  flagsOfVerb,
} from "../packages/cli/src/cli.ts";
import { ruleTargets } from "../packages/contract/src/handlers.ts";
import { EMBEDDED } from "../packages/sdk/src/core/grammars/grammars.ts";
import { directiveVocabulary, type DirectiveRow } from "../packages/sdk/src/core/grammars/query.ts";

const GENERATION_NOTE =
  "GENERATED FILE — do not edit. Regenerate with: bun run schema (scripts/generate-schema.ts, from src/config/load.ts CONFIG_SCHEMA).";

export const GENERATED_OUTPUTS = [
  "jint.schema.json",
  "docs/targets.md",
  "docs/directives.md",
  "docs/config.md",
  "docs/grammars.md",
  "packages/sdk/src/core/grammars/embedded/SOURCES.md",
  "docs/reference/config.md",
  "docs/reference/environment.md",
  "docs/reference/cli.md",
  "web/src/data/reference.json",
  "skills/writing-rules/SKILL.md",
];

// ---------------------------------------------------------------------------
// Pure renderers: strings in, strings out. No filesystem, no process access.
// ---------------------------------------------------------------------------

export function renderSchemaJson(): string {
  const schema = { $comment: GENERATION_NOTE, ...CONFIG_SCHEMA };
  return JSON.stringify(schema, null, 2) + "\n";
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
  return `${serve} While it is up, a run prints its own page: \`report.run.url\` in \`--json\`, and a \`ui ->\` line on stderr. A classification's address adds \`?${query}\` to that page, with the classification's \`input\` from \`--json\`. URL-encode \`input\`: it contains \`#\`.`;
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

// --- the reference pages ---------------------------------------------------
/**
 * One reference entry: the name, a few badges, a description and, for the CLI, one example. The
 * pages are data, and two views render it: markdown for the repo and the agent, and the site's own
 * component, which draws the badges. Neither view holds a fact the data lacks.
 */
export interface RefEntry {
  readonly id: string;
  /** 3 for a top-level entry, 4 for one nested under the entry before it. */
  readonly level: 3 | 4;
  readonly name: string;
  /** A badge is text, or a [label, value] pair such as a default. Backticks mark code. */
  readonly pills: readonly (string | readonly [string, string])[];
  readonly body: string;
  readonly example?: string;
}

export interface RefSection {
  readonly title: string;
  readonly intro?: string;
  readonly entries: readonly RefEntry[];
}

export type RefPages = Record<"config" | "environment" | "cli", readonly RefSection[]>;

/** A schema node's type as a reader writes it in a config: `string[]`, not `array`. */
function typeLabel(node: TableNode): string {
  if (node.anyOf !== undefined) return "string | object";
  if (node.type === "array") return node.items?.type === "string" ? "string[]" : "object[]";
  return node.type ?? "value";
}

/**
 * One config field. `within` is the key the section under it is named for: the section title says
 * it, so the entry shows the path below it. The id keeps the whole path, so every anchor is
 * unique.
 */
function fieldEntry(path: string, node: TableNode, required: boolean, within?: string): RefEntry {
  return {
    id: path.replaceAll(".", "-").toLowerCase(),
    level: 3,
    name: within === undefined ? path : path.slice(within.length + 1),
    pills: [
      typeLabel(node),
      ...(node.default === undefined ? [] : [["default", String(node.default)] as const]),
      ...(required ? ["required"] : []),
    ],
    body: (node.description ?? "").replaceAll("\n", " "),
  };
}

/** The config reference: every key and rule field as one entry, all from the schema. */
export function configSections(): RefSection[] {
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
  const entries = (keep: (path: string) => boolean, within?: string) =>
    [...fields]
      .filter(([path]) => keep(path))
      .map(([path, { node, required }]) => fieldEntry(path, node, required, within));
  return [
    {
      title: "Run settings",
      entries: run.map(([key, node]) => fieldEntry(key, node, (root.required ?? []).includes(key))),
    },
    {
      title: "Rule scope",
      entries: scope.map(([key, node]) =>
        fieldEntry(`rules.${key}`, node, (rules.required ?? []).includes(key)),
      ),
    },
    {
      title: "Rule fields",
      intro: "Each entry of `rules.use` is a rule name or a rule object with these fields.",
      entries: entries((path) => !path.startsWith("handle.")),
    },
    {
      title: "Rule handler fields",
      intro:
        "The `handle` of a rule turns its answer into a severity. The fields it takes depend on the rule kind.",
      entries: entries((path) => path.startsWith("handle."), "handle"),
    },
  ];
}

/** The environment variables, from ENV_VARS: the one list a guard test keeps whole. */
export function envSections(): RefSection[] {
  return [
    {
      title: "Variables",
      entries: ENV_VARS.map((v) => ({
        id: v.name.toLowerCase().replaceAll("_", "-"),
        level: 3,
        name: v.name,
        pills: v.default === "none" ? [] : [["default", v.default] as const],
        body: v.meaning,
      })),
    },
  ];
}

/**
 * The verbs of the CLI. Under a verb, indented, come its nouns and the flags it takes, each with
 * one example; the flags every verb takes come last. The tables are the parser's own, and so is the
 * rule for which verb takes which flag.
 */
export function cliSections(): RefSection[] {
  type FlagSpec = { arg?: string; aliases?: readonly string[] };
  const flag = (
    verb: keyof typeof VERBS,
    name: string,
    id: string,
    level: 3 | 4,
    example = flagExample(verb, name),
  ): RefEntry => {
    const spec = (FLAGS as Record<string, FlagSpec>)[name]!;
    return {
      id,
      level,
      name,
      pills: [
        ...(spec.arg === undefined ? [] : [`\`${spec.arg}\``]),
        ...(spec.aliases ?? []).map((alias) => `\`${alias}\``),
      ],
      body: flagBlurb(verb, name),
      example,
    };
  };
  const verbs = (Object.keys(VERBS) as (keyof typeof VERBS)[]).flatMap((name): RefEntry[] => [
    {
      id: `verb-${name}`,
      level: 3,
      name,
      pills: [],
      body: VERBS[name].blurb,
      example: VERBS[name].example,
    },
    ...(name === "run"
      ? Object.entries(NOUNS).map(
          ([noun, spec]): RefEntry => ({
            id: `noun-${noun}`,
            level: 4,
            name: noun,
            pills: [],
            body: spec.blurb,
            example: spec.example,
          }),
        )
      : []),
    ...flagsOfVerb(name).map((flagName) =>
      flag(name, flagName, `flag-${name}-${flagName.replace(/^-+/, "")}`, 4),
    ),
  ]);
  return [
    {
      title: "Verbs",
      intro:
        "The first operand is the verb. There is no default verb. The nouns and flags of a verb are indented under it.",
      entries: verbs,
    },
    {
      title: "Flags for every verb",
      entries: GLOBAL_FLAG_NAMES.map((name) =>
        flag("run", name, `flag-${name.replace(/^-+/, "")}`, 3, `jint ${name}`),
      ),
    },
  ];
}

export function referencePages(): RefPages {
  return { config: configSections(), environment: envSections(), cli: cliSections() };
}

/** The pages as the site's data file: the component draws every badge from it. */
export function renderReferenceJson(): string {
  return JSON.stringify({ $comment: GENERATION_NOTE, ...referencePages() }, null, 2) + "\n";
}

/**
 * One page as markdown, for the repo and the agent: a real heading for every entry, with its
 * description, its badges as one line and its example. A heading is a section to a reader of the
 * file and to jint, so each entry is a unit that carries its own name.
 */
export function renderReferenceMarkdown(sections: readonly RefSection[]): string {
  const pill = (p: string | readonly [string, string]) => (typeof p === "string" ? p : p.join(" "));
  return sections
    .flatMap((section) => [
      `## ${section.title}`,
      "",
      ...(section.intro === undefined ? [] : [section.intro, ""]),
      ...section.entries.flatMap((entry) => [
        `${"#".repeat(entry.level)} \`${entry.name}\``,
        "",
        entry.body,
        "",
        ...(entry.pills.length === 0 ? [] : [`*${entry.pills.map(pill).join(" · ")}*`, ""]),
        ...(entry.example === undefined ? [] : ["```sh", entry.example, "```", ""]),
      ]),
    ])
    .join("\n");
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
  const schemaOut = outPath(root, "jint.schema.json");
  writeFileSync(schemaOut, renderSchemaJson());
  formatted.push(schemaOut);
  process.stdout.write("wrote " + schemaOut + "\n");

  const spliceInto = (rel: string, regions: Record<string, string>) => {
    const out = outPath(root, rel);
    let doc = readFileSync(REPO_ROOT + rel, "utf8");
    for (const [name, body] of Object.entries(regions)) doc = spliceGenerated(doc, name, body);
    writeFileSync(out, doc);
    formatted.push(out);
    process.stdout.write("wrote " + out + "\n");
  };
  spliceInto("skills/writing-rules/SKILL.md", { "run-address": renderRunAddress() });

  const targetsOut = outPath(root, "docs/targets.md");
  writeFileSync(
    targetsOut,
    spliceGenerated(
      readFileSync(REPO_ROOT + "docs/targets.md", "utf8"),
      "targets",
      renderTargetsTable(),
    ),
  );
  formatted.push(targetsOut);
  process.stdout.write("wrote " + targetsOut + "\n");

  const directivesOut = outPath(root, "docs/directives.md");
  writeFileSync(
    directivesOut,
    spliceGenerated(
      readFileSync(REPO_ROOT + "docs/directives.md", "utf8"),
      "directives",
      renderDirectivesTable(directiveVocabulary()),
    ),
  );
  formatted.push(directivesOut);
  const configOut = outPath(root, "docs/config.md");
  writeFileSync(
    configOut,
    spliceGenerated(
      readFileSync(REPO_ROOT + "docs/config.md", "utf8"),
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

  const pages = referencePages();
  const reference: [string, keyof RefPages][] = [
    ["docs/reference/config.md", "config"],
    ["docs/reference/environment.md", "environment"],
    ["docs/reference/cli.md", "cli"],
  ];
  for (const [rel, page] of reference) {
    const out = outPath(root, rel);
    writeFileSync(
      out,
      spliceGenerated(
        readFileSync(REPO_ROOT + rel, "utf8"),
        "reference",
        renderReferenceMarkdown(pages[page]),
      ),
    );
    Bun.spawnSync([join(REPO_ROOT, "node_modules/.bin/oxfmt"), out], { cwd: REPO_ROOT });
    process.stdout.write("wrote " + out + "\n");
  }
  const dataOut = outPath(root, "web/src/data/reference.json");
  writeFileSync(dataOut, renderReferenceJson());
  Bun.spawnSync([join(REPO_ROOT, "node_modules/.bin/oxfmt"), dataOut], { cwd: REPO_ROOT });
  process.stdout.write("wrote " + dataOut + "\n");

  const grammarsOut = outPath(root, "docs/grammars.md");
  writeFileSync(
    grammarsOut,
    spliceGenerated(
      readFileSync(REPO_ROOT + "docs/grammars.md", "utf8"),
      "grammars",
      renderGrammarsTable(),
    ),
  );
  process.stdout.write("wrote " + grammarsOut + "\n");

  const sourcesOut = outPath(root, "packages/sdk/src/core/grammars/embedded/SOURCES.md");
  writeFileSync(sourcesOut, renderGrammarSources());
  Bun.spawnSync([join(REPO_ROOT, "node_modules/.bin/oxfmt"), grammarsOut, sourcesOut], {
    cwd: REPO_ROOT,
  });
  process.stdout.write("wrote " + sourcesOut + "\n");
}

if (import.meta.main) writeGeneratedOutputs(process.argv[2]);
