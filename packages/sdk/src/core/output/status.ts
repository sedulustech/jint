/**
 * The verdict of a report: pass, warn or fail, for the run and for each input file. It follows the
 * exit code, so a script reads the same answer from either: an error finding or a unit the model
 * never judged fails, a warning warns, and nothing else passes.
 */

import type { LintReport } from "../lint.ts";

export type Status = "pass" | "warn" | "fail";

export interface InputStatus {
  readonly input: string;
  readonly status: Status;
}

/** The file of an input: an element's input carries a `#id` after the path. */
const fileOf = (input: string): string => input.split("#")[0]!;

const worst = (a: Status, b: Status): Status =>
  a === "fail" || b === "fail" ? "fail" : a === "warn" || b === "warn" ? "warn" : "pass";

type Verdict = Pick<LintReport, "classifications" | "findings" | "errors">;

export function reportStatus(report: Verdict): { status: Status; inputs: InputStatus[] } {
  const byInput = new Map<string, Status>();
  const note = (input: string, status: Status) => {
    const file = fileOf(input);
    byInput.set(file, worst(byInput.get(file) ?? "pass", status));
  };
  for (const c of report.classifications) note(c.input, "pass");
  for (const f of report.findings) note(f.input, f.severity === "error" ? "fail" : "warn");
  for (const e of report.errors) note(e.input, "fail");
  const inputs = [...byInput].map(([input, status]) => ({ input, status }));
  // a run that judged nothing has no verdict to pass: it fails, as its exit code does
  const status =
    report.classifications.length === 0
      ? "fail"
      : inputs.reduce<Status>((s, i) => worst(s, i.status), "pass");
  return { status, inputs };
}
