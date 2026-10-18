import { languageOf } from "../packages/sdk/src/core/grammars/grammars.ts";
/**
 * EXPERIMENT PROBE (grouping-experiment branch; report-first - no source changes). Dumps the
 * walker's three GROUPERS' decisions per file and flags anomalies:
 *
 * 1. Comment attachment (gap<=1) - mis-attached (owner not adjacent/containing) and missed (adjacent
 *    comment not owned);
 * 2. Import merge - merged span slicing vs joined content (scattered-run over-reach);
 * 3. Docstring ownership - innermost enclosing definition, else module. Run: bun
 *    scripts/grouping-probe.ts [lang=path ...] (defaults below)
 */
import { decompose } from "../packages/sdk/src/core/grammars/walk.ts";

const ROOT = "/home/crjm/dev/sedulus/worktrees/jint/grouping-experiment";
const CK = "/home/crjm/.cache/checkouts/github.com";

const DEFAULT_TARGETS: Array<[string, string]> = [
  ["c", `${ROOT}/tests/fixtures/parity/c/corpus.c`],
  ["c", `${CK}/vercel-labs/quickjs-wasi/c/interface.c`],
  ["cpp", `${ROOT}/tests/fixtures/parity/cpp/corpus.cpp`],
  ["cpp", `${CK}/v8/v8/samples/process.cc`],
  ["css", `${ROOT}/tests/fixtures/parity/css/corpus.css`],
  ["css", `${CK}/electron/electron/default_app/styles.css`],
  ["go", `${ROOT}/tests/fixtures/parity/go/corpus.go`],
  ["go", `${CK}/spf13/cobra/command.go`],
  ["markdown", `${ROOT}/tests/fixtures/parity/markdown/corpus.md`],
  ["markdown", `${CK}/spf13/cobra/README.md`],
  ["php", `${ROOT}/tests/fixtures/parity/php/corpus.php`],
  ["php", `${CK}/laravel/laravel/app/Models/User.php`],
  ["php", `${CK}/laravel/framework/src/Illuminate/Collections/Arr.php`],
  ["python", `${ROOT}/tests/fixtures/parity/python/corpus.py`],
  ["python", `${CK}/nousresearch/hermes-agent/hermes_state.py`],
  ["tsx", `${ROOT}/tests/fixtures/parity/tsx/corpus.tsx`],
  ["tsx", `${CK}/composiohq/composio/docs/mdx-components.tsx`],
  ["typescript", `${ROOT}/tests/fixtures/parity/typescript/corpus.ts`],
  ["typescript", `${ROOT}/packages/sdk/src/core/grammars/walk.ts`],
];

const targets = process.argv.slice(2).length
  ? process.argv.slice(2).map((a) => {
      const [lang, ...rest] = a.split("=");
      return [lang!, rest.join("=")] as [string, string];
    })
  : DEFAULT_TARGETS;

for (const [lang, path] of targets) {
  const source = await Bun.file(path).text();
  if (languageOf(path) !== lang) {
    console.log(`!! ${lang} routing mismatch for ${path}`);
    continue;
  }
  const inv = await decompose(source, lang);
  console.log(
    `\n=== ${lang} ${path.replace(ROOT + "/", "").replace(CK + "/", "")} hasError=${inv.hasError}`,
  );

  // --- definitions: the pair frame ---
  for (const d of inv.definitions) {
    const att = d.attachedComment ? `att=${d.attachedComment.length}` : "att=0";
    console.log(
      `  d ${d.label} ${d.capture}${d.name ? ":" + d.name : ""} L${d.span.start.line} ${att} int=${d.internalCommentCount} doc=${d.docstringCount}${d.parent ? " parent=" + d.parent : ""}${d.oversized ? " OVERSIZED" : ""}`,
    );
  }

  // --- comments: ownership ---
  for (const c of inv.comments) {
    const owner = c.docstringOf ? `${c.docstringOf.kind}:${c.docstringOf.name || "<anon>"}` : "-";
    const isDoc = c.capture === "docstring" ? "DOCSTR" : "commnt";
    console.log(
      `  c ${c.label} ${isDoc} L${c.span.start.line} owner=${owner} ${JSON.stringify(c.content.slice(0, 36))}`,
    );
  }

  // --- imports: the merge ---
  for (const i of inv.imports) {
    const slice = source.slice(i.span.startByte, i.span.endByte);
    const n = i.content.split("\n").length;
    console.log(
      `  i ${i.label} merged=${n} L${i.span.start.line}-${i.span.end.line} spanSlice=${slice === i.content ? "exact" : "DIVERGES (" + slice.length + "B vs " + i.content.length + "B)"}`,
    );
  }

  // --- ANOMALY 1: owner must be the innermost container, else the adjacent run's definition ---
  // adjacency is run-based: a comment is owned by the FIRST definition after it whose attached
  // run includes its text with nothing but run comments in between (each comment of the run).
  for (const c of inv.comments) {
    const containers = inv.definitions.filter(
      (d) => d.span.startByte <= c.span.startByte && d.span.endByte >= c.span.endByte,
    );
    const innermost = containers.at(-1);
    const nextDef = inv.definitions.find((d) => d.span.start.line >= c.span.end.line);
    const adjacent = nextDef && nextDef.attachedComment?.includes(c.content) ? nextDef : undefined;
    const expected = innermost ?? adjacent;
    const actual = c.docstringOf ? `${c.docstringOf.kind}:${c.docstringOf.name}` : undefined;
    if (!expected && actual) {
      console.log(
        `  STEAL? L${c.span.start.line} ${JSON.stringify(c.content.slice(0, 24))}: owner=${actual} but no container and no adjacent run claims it`,
      );
    } else if (expected && actual) {
      const expectedS = `${expected.capture}:${expected.name ?? ""}`;
      if (actual === expectedS) continue;
      // same name, wrong kind -> the owner-kind collapse; different name -> stolen
      console.log(
        actual.split(":")[1] === (expected.name ?? "")
          ? `  KIND-COLLAPSE L${c.span.start.line}: owner=${actual} want kind ${expected.capture} (same def)`
          : `  STEAL L${c.span.start.line} ${JSON.stringify(c.content.slice(0, 24))}: owner=${actual} want ${expectedS}`,
      );
    }
  }

  // --- ANOMALY 2: docstring owner = innermost container, else module ---
  for (const c of inv.comments) {
    if (c.capture !== "docstring") continue;
    const containers = inv.definitions.filter(
      (d) => d.span.startByte <= c.span.startByte && d.span.endByte >= c.span.endByte,
    );
    const innermost = containers.at(-1);
    const expectedS = innermost ? `${innermost.capture}:${innermost.name ?? ""}` : "module:";
    const actual = `${c.docstringOf?.kind}:${c.docstringOf?.name}`;
    if (expectedS !== actual) {
      console.log(
        `  ANOMALY docstring-owner L${c.span.start.line} ${JSON.stringify(c.content.slice(0, 24))}: got ${actual} want ${expectedS}`,
      );
    }
  }

  // --- ANOMALY 3: adjacent topLevel comment not attached anywhere (gap<=1, no owner) ---
  for (const c of inv.comments) {
    if (c.capture === "docstring" || c.docstringOf) continue;
    const next = inv.definitions.find(
      (d) => d.span.start.line >= c.span.end.line && d.span.start.line - c.span.end.line <= 1,
    );
    if (next && !next.attachedComment?.includes(c.content)) {
      console.log(
        `  MISSED-ATTACH L${c.span.start.line} ${JSON.stringify(c.content.slice(0, 24))} precedes ${next.label} (${next.capture}:${next.name ?? ""}) but owns nothing`,
      );
    }
  }
}
