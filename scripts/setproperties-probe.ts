import { capture } from "/home/crjm/dev/sedulus/worktrees/jint/grouping-experiment/packages/sdk/src/core/grammars/capture.ts";
/**
 * DATA-CHANNEL TEST (experiment B): can per-language grouping corrections ride web-tree-sitter's
 * NATIVE #set! channel (QueryCapture.setProperties) all the way to the walker's JS? 1. direct
 * engine: does a (#set! "name" "value") inside a pattern arrive on the capture in JS? 2. project
 * gate: does capture()'s compileQuery accept such a directive, or reject the name?
 */
import {
  loadLanguage,
  parserFor,
} from "/home/crjm/dev/sedulus/worktrees/jint/grouping-experiment/packages/sdk/src/core/grammars/grammars.ts";
import { decompose } from "/home/crjm/dev/sedulus/worktrees/jint/grouping-experiment/packages/sdk/src/core/grammars/walk.ts";
// direct file import: scripts/ is outside the packages that depend on web-tree-sitter
import { Query } from "../node_modules/.bun/web-tree-sitter@0.27.0/node_modules/web-tree-sitter/web-tree-sitter.js";

const py = `
# header comment
def f():
    """doc of f"""
    return 1


def g():
    return 2
`;

// --- 1. direct engine: the native channel ---
const lang = await loadLanguage("python");
const parser = await parserFor("python");
const tree = parser.parse(py);
const scm = `
((function_definition) @function
  (#set! "grouping.gap" "0"))
((comment) @comment)
((expression_statement (string) @docstring) (#set! "docstring.owner" "module"))
`;
const q = new Query(lang, scm);
for (const m of q.matches(tree.rootNode)) {
  if (m.setProperties && Object.keys(m.setProperties).length > 0) {
    console.log(
      `ENGINE pattern=${m.patternIndex} MATCH setProperties=${JSON.stringify(m.setProperties)}`,
    );
  }
  for (const cap of m.captures) {
    if (cap.setProperties && Object.keys(cap.setProperties).length > 0) {
      console.log(
        `ENGINE pattern=${m.patternIndex} capture=@${cap.name} setProperties=${JSON.stringify(cap.setProperties)}`,
      );
    }
  }
}
console.log(
  "query-level setProperties (per pattern):",
  JSON.stringify(q.setProperties.filter((p) => Object.keys(p).length > 0)),
);

// --- 2. project gate: capture() with the same .scm via queryPath ---
await Bun.write(
  "/tmp/channel-fixture.py",
  '# header comment\ndef f():\n    """doc of f"""\n    return 1\n\n\ndef g():\n    return 2\n',
);
await Bun.write("/tmp/channel.scm", scm);
try {
  const els = await capture("/tmp/channel-fixture.py", "/tmp/channel.scm");
  console.log("CAPTURE-GATE accepted the directive file; elements:", els.length);
} catch (e) {
  console.log("CAPTURE-GATE rejected:", e instanceof Error ? e.message.split("\n")[0] : String(e));
}

// --- 3. does any directive value reach walk.ts? (Candidate carries no properties) ---
const inv = await decompose(py, "python");
console.log(
  "walk Candidate fields reachable from decompose:",
  Object.keys(inv.definitions[0] ?? {}).join(","),
);
