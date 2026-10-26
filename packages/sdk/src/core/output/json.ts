/**
 * The canonical serializer: these bytes are report.json AND stdout under --json — byte-identical,
 * one truth. Stream discipline (clig): the document is data — errors ride in it; human-facing
 * operational messages are the raw-line renderer's stderr concern, never embedded here.
 */

import pkg from "../../../package.json";
import type { LintReport } from "../lint.ts";
import type { Finding } from "@jint/contract";

export function renderJson(report: LintReport): string {
  return (
    JSON.stringify(
      {
        tool: "jint",
        version: pkg.version,
        // The run pointer: the same recordSummary the stderr notice names. Absent only when no
        // classifier call started a run (a report without captures). Direct optional properties:
        // this object feeds JSON.stringify only, which drops undefined - absent and
        // present-undefined serialize to the same bytes.
        run: report.run,
        // The element-scoped selection (path@L): WHICH element each selector captured, so a
        // consumer never trusts a score against the wrong unit. Absent when unscoped.
        selected: report.selected?.map((s) => ({
          id: s.id,
          path: s.path,
          kind: s.kind,
          name: s.name,
          span: { start: s.spanStart, end: s.spanEnd },
          content: s.content,
        })),
        measurements: report.measurements.map((m) => ({
          rule: m.rule,
          input: m.input,
          value: m.value,
          // score and choice rules only: the distribution the value summarizes
          probabilities: m.probabilities,
          choice: m.choice,
          element: m.element,
        })),
        // Literal ternary branches, NOT conditional spreads: the annotation makes this a typed
        // return position, so excess-property checking fires — a field the wire shape does not
        // declare is a COMPILE error here, not a silently dropped key. (undefined properties
        // drop under JSON.stringify, so the bytes match the old spreads.)
        findings: report.findings.map(
          (s): Finding => ({
            rule: s.rule,
            input: s.input,
            value: s.value,
            severity: s.severity,
            probabilities: s.probabilities !== undefined ? s.probabilities : undefined,
            choice: s.choice !== undefined ? s.choice : undefined,
            undecided: s.undecided !== undefined ? s.undecided : undefined,
            message: s.message !== undefined ? s.message : undefined,
            location:
              s.location !== undefined
                ? { input: s.location.input, span: s.location.span }
                : undefined,
            note: s.note !== undefined ? s.note : undefined,
          }),
        ),
        errors: report.errors.map((e) => ({
          input: e.input,
          code: e.code,
          message: e.message,
          rule: e.rule,
        })),
        // In-band degradation (oversized skips, scope exclusions): the same array the raw-line
        // renderer prints on stderr — a machine consumer gets the identical signal, never less
        // (review 396888e finding 1: visibility that stops at the human renderer is not
        // visibility). Deterministic order is established by collectReport.
        notes: report.notes,
        // The self-description of every rule that ran: a report reads without the config (the
        // criteria text and the compiled tiers ride along; instructions stay config provenance).
        rules: report.rules,
      },
      null,
      2,
    ) + "\n"
  );
}
