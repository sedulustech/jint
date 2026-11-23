// jint over a commit: measure the staged files with the repo's own config and report every finding in
// them, changed lines or not, because a change to one part of a file can affect the rest of it.
// Unchanged elements answer from the answer cache, so the cost is the changed elements. Blocks on
// error-tier findings and on a broken run; reports warnings and never blocks on them.
//
// Limit: jint reads the working tree, so a file with unstaged edits is measured with them.

const run = (cmd: string[], input?: string, env?: Record<string, string>) =>
  Bun.spawnSync(cmd, {
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    env: { ...process.env, ...env },
  });
const text = (b: Uint8Array) => new TextDecoder().decode(b);

// a renamed file is measured at its new path, so renames are read as additions
const staged = text(
  run(["git", "diff", "--cached", "--name-only", "--no-renames", "--diff-filter=ACM", "-z"]).stdout,
)
  .split("\0")
  .filter((path) => path !== "");
if (staged.length === 0) process.exit(0);

type Finding = {
  rule: string;
  value: number;
  severity: "warn" | "error";
  note?: string;
  message?: string;
  location: { input: string; span: { start: { line: number }; end: { line: number } } };
};
// One run over the staged paths, piped as a path list: each is scope-checked by the repo's config,
// so tests and prose it leaves out are skipped, not judged. A path no grammar claims is a note, not
// a failure. Exit 0 clean, 1 error findings: the verdict. Exit 3 is a run that could not finish
// (a dead or refusing endpoint): the report is partial, so the commit blocks. Exit 2 is a run
// that did nothing useful: with a report whose only error is SCOPE_EMPTY it passes, else it blocks.
const result = run(
  ["bun", "packages/cli/dist/cli.js", "run", "paths", "-", "--json"],
  staged.join("\n"),
);
// the run lands in the default store with every other run: say where to read it
const where = text(result.stderr)
  .split("\n")
  .find((line) => line.includes("ui ->"));
if (where !== undefined) process.stderr.write(where + "\n");
// exit 2 may carry a report (SCOPE_EMPTY), so it is read below; with no report it blocks there
const reportBytes = text(result.stdout);
if (![0, 1, 2, 3].includes(result.exitCode) || (result.exitCode === 2 && reportBytes === "")) {
  process.stderr.write(text(result.stderr));
  process.stderr.write(`jint: the run failed (exit ${result.exitCode}); blocking the commit\n`);
  process.exit(1);
}
const report = JSON.parse(reportBytes) as {
  findings: Finding[];
  errors: { input: string; code: string; message: string }[];
};
// a run whose only errors are SCOPE_EMPTY found no staged file in any rule's scope: nothing to check
if (report.errors.length > 0 && report.errors.every((e) => e.code === "SCOPE_EMPTY"))
  process.exit(0);
if (report.errors.length > 0 || result.exitCode === 2) {
  for (const e of report.errors) process.stderr.write(`jint: ${e.input}: ${e.code} ${e.message}\n`);
  process.stderr.write("jint: classification failed; blocking the commit\n");
  process.exit(1);
}
for (const f of report.findings) {
  const path = f.location.input.split("#")[0]!;
  const { start, end } = f.location.span;
  process.stderr.write(
    `jint: ${f.severity} ${path}:${start.line}-${end.line} ${f.rule} ${f.value}${(f.note ?? f.message) ? " - " + (f.note ?? f.message) : ""}\n`,
  );
}
const errors = report.findings.filter((f) => f.severity === "error").length;
const total = report.findings.length;
process.stderr.write(
  `jint: ${total} finding${total === 1 ? "" : "s"} in the staged files (${errors} error${errors === 1 ? "" : "s"})\n`,
);
if (errors > 0) process.exit(1);
