// jint over a commit's changes: measure the staged files with the repo's own config, then keep only
// the findings whose element overlaps a line the commit changed. Unchanged elements answer from the
// answer cache, so the cost is the changed elements. A finding on the whole file (a file-level rule)
// overlaps every change, so it is reported whenever the file is in the commit. Blocks on error-tier
// findings in changed code and on a broken run; reports warnings and never blocks on them.
//
// Limit: the diff lines are the staged version; jint reads the working tree, so a file with
// unstaged edits on top of the staged ones can misplace a span.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (cmd: string[], input?: string, env?: Record<string, string>) =>
  Bun.spawnSync(cmd, {
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    env: { ...process.env, ...env },
  });
const text = (b: Uint8Array) => new TextDecoder().decode(b);

const diff = text(run(["git", "diff", "--cached", "-U0", "--diff-filter=ACM"]).stdout);
const changed = new Map<string, [number, number][]>();
let file: string | undefined;
for (const line of diff.split("\n")) {
  const header = line.match(/^\+\+\+ b\/(.+)$/);
  if (header) {
    file = header[1];
    changed.set(file!, []);
    continue;
  }
  const hunk = line.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
  if (hunk && file !== undefined) {
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (count > 0) changed.get(file)!.push([start, start + count - 1]);
  }
}
if (changed.size === 0) process.exit(0);

const runs = mkdtempSync(join(tmpdir(), "jint-hook-"));
type Finding = {
  rule: string;
  value: number;
  severity: "warn" | "error";
  message?: string;
  location: { input: string; span: { start: { line: number }; end: { line: number } } };
};
// One run over the staged paths, piped as a path list: each is scope-checked by the repo's config,
// so tests and prose it leaves out are skipped, not judged. A path no grammar claims is a note, not
// a failure. Exit 0 clean, 1 error findings, 4 nothing measured: all carry a
// report. 2 and 3 do not.
const result = run(
  ["bun", "packages/cli/dist/cli.js", "run", "paths", "-", "--json"],
  [...changed.keys()].join("\n"),
  {
    JINT_RUNS_DIR: runs,
  },
);
if (![0, 1, 4].includes(result.exitCode)) {
  process.stderr.write(text(result.stderr));
  process.stderr.write(`jint: the run failed (exit ${result.exitCode}); blocking the commit\n`);
  process.exit(1);
}
const report = JSON.parse(text(result.stdout)) as { findings: Finding[] };
const touched = report.findings.filter((f) => {
  const path = f.location.input.split("#")[0]!;
  const ranges = changed.get(path);
  if (ranges === undefined) return false;
  const { start, end } = f.location.span;
  return ranges.some(([from, to]) => start.line <= to && end.line >= from);
});

for (const f of touched) {
  const path = f.location.input.split("#")[0]!;
  const { start, end } = f.location.span;
  process.stderr.write(
    `jint: ${f.severity} ${path}:${start.line}-${end.line} ${f.rule} ${f.value}${f.message ? " - " + f.message : ""}\n`,
  );
}
const errors = touched.filter((f) => f.severity === "error").length;
process.stderr.write(
  `jint: ${touched.length} finding${touched.length === 1 ? "" : "s"} in the changed code (${errors} error${errors === 1 ? "" : "s"}), ` +
    `${report.findings.length - touched.length} elsewhere in the staged files not shown\n`,
);
if (errors > 0) process.exit(1);
