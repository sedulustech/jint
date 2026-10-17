import { Type, type Static } from "@sinclair/typebox";
import type {
  ClassifyErrorInfo,
  Finding,
  Measurement,
  Report as ContractReport,
} from "@jint/contract";

const SPAN_SCHEMA = Type.Object({
  start: Type.Object({ line: Type.Number(), column: Type.Number() }),
  end: Type.Object({ line: Type.Number(), column: Type.Number() }),
  startByte: Type.Number(),
  endByte: Type.Number(),
});

const ELEMENT_BASE = {
  span: SPAN_SCHEMA,
  label: Type.String(),
  parent: Type.Optional(Type.String()),
};

export const ELEMENT_SCHEMA = Type.Union([
  Type.Object({ kind: Type.Literal("file"), ...ELEMENT_BASE }),
  Type.Object({
    kind: Type.Literal("function"),
    ...ELEMENT_BASE,
    name: Type.Optional(Type.String()),
  }),
  Type.Object({ kind: Type.Literal("class"), ...ELEMENT_BASE, name: Type.Optional(Type.String()) }),
  Type.Object({
    kind: Type.Literal("method"),
    ...ELEMENT_BASE,
    name: Type.Optional(Type.String()),
  }),
  Type.Object({ kind: Type.Literal("type"), ...ELEMENT_BASE, name: Type.Optional(Type.String()) }),
  Type.Object({
    kind: Type.Literal("binding"),
    ...ELEMENT_BASE,
    name: Type.Optional(Type.String()),
  }),
  Type.Object({ kind: Type.Literal("import"), ...ELEMENT_BASE }),
  Type.Object({
    kind: Type.Literal("section"),
    ...ELEMENT_BASE,
    name: Type.Optional(Type.String()),
  }),
  Type.Object({ kind: Type.Literal("paragraph"), ...ELEMENT_BASE }),
  Type.Object({
    kind: Type.Literal("comment"),
    ...ELEMENT_BASE,
    docstringOf: Type.Optional(
      Type.Object({
        // derived from the DocstringOwner vocabulary (the owner's capture, losslessly)
        kind: Type.Union([
          Type.Literal("module"),
          Type.Literal("function"),
          Type.Literal("class"),
          Type.Literal("method"),
          Type.Literal("type"),
          Type.Literal("binding"),
        ]),
        name: Type.String(),
      }),
    ),
  }),
]);

export const MEASUREMENT_SCHEMA = Type.Object({
  rule: Type.String(),
  input: Type.String(),
  value: Type.Number(),
  // Score rules only: the distribution the value summarizes. Noul's probability IS the value —
  // no separate distribution field.
  probabilities: Type.Optional(Type.Record(Type.String(), Type.Number())),
  confidence: Type.Optional(Type.Number()),
  // The measured subject, fully typed (tmp/designs/element.md). Absent only from the bare
  // classifyUnit generator (no source, no span); every report path attaches it.
  element: Type.Optional(ELEMENT_SCHEMA),
});

// The severity vocabulary has one home: contract's Severity (handlers.ts). The schema spells the
// same union for the wire; the identity pin below makes any drift a typecheck failure.
const SEVERITY_SCHEMA = Type.Union([Type.Literal("error"), Type.Literal("warn")]);

export const FINDING_SCHEMA = Type.Object({
  rule: Type.String(),
  input: Type.String(),
  value: Type.Number(),
  severity: SEVERITY_SCHEMA,
  // Custom tier only: the callback's remediation instruction to the caller — severity says
  // whether, message says how. Absent for noul and score (threshold-derived) findings.
  message: Type.Optional(Type.String()),
  // Element-scoped findings: the element's exact span; files-target findings lack it.
  location: Type.Optional(Type.Object({ input: Type.String(), span: SPAN_SCHEMA })),
  // The rule author's message attached at the fired handle tier; absent = a bare finding. The
  // criteria legend echo is gone: rubric prose never reaches findings.
  note: Type.Optional(Type.String()),
});

/**
 * The CLI's default stdout projection: one line per finding, whitespace-separated columns,
 * regex-parseable. All columns optional except rule/level/score.
 */
export const LINE_SCHEMA = Type.String({
  // path(@L<start>) or path(@L<start>-L<end>)  rule  level  score — two-space separators,
  // parseable. The element id never prints (run-scoped internal); files-target findings have no
  // anchor. The run id stays stderr-side: it prints once per run.
  pattern: "^\\s*\\S+(@L\\d+(-L\\d+)?)?\\s{2,}\\S+\\s{2,}(error|warn)\\s{2,}\\d+\\.\\d{2}$",
});

export const CLASSIFY_ERROR_SCHEMA = Type.Object({
  input: Type.String(),
  code: Type.String(),
  message: Type.String(),
});

export const REPORT_SCHEMA = Type.Object({
  tool: Type.Literal("jint"),
  version: Type.String(),
  // Additive: the run pointer into the run store (captures live in run.dir; the findings ->
  // judged-text join is finding.input == capture state.id). Optional: pre-pointer reports and
  // capture-less runs (no classifier call started) still parse.
  run: Type.Optional(Type.Object({ id: Type.String(), dir: Type.String() })),
  measurements: Type.Array(MEASUREMENT_SCHEMA),
  findings: Type.Array(FINDING_SCHEMA),
  errors: Type.Array(CLASSIFY_ERROR_SCHEMA),
  notes: Type.Array(Type.String()),
  // The run's self-description: one digest per rule that ran (name, criteria, compiled handle
  // tiers incl. the author message). Absent from pre-rules reports. NOT instructions - criteria
  // plus tiers suffice to read a finding.
  rules: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        criteria: Type.Union([
          Type.Array(Type.String()),
          Type.Object({ true: Type.String(), false: Type.String() }),
          Type.Null(),
        ]),
        handle: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
      }),
    ),
  ),
});

export type Report = Static<typeof REPORT_SCHEMA>;

// Type-level pin: the contract's plain interfaces and the wire schemas cannot drift — in EITHER
// direction. Assignability both ways, so a field added on one side alone (e.g. wire-only
// location, or a contract-only note) fails `bun run typecheck` here, where the schemas live —
// not at the consumer boundary. (Assignability, not the Same<T> identity trick: the contract
// interfaces are readonly, TypeBox Static is not, and identity treats that as drift.)
const _pinMeasurement: readonly Measurement[] = [] as Static<typeof MEASUREMENT_SCHEMA>[];
const _pinMeasurementWire: readonly Static<typeof MEASUREMENT_SCHEMA>[] = [] as Measurement[];
const _pinFinding: readonly Finding[] = [] as Static<typeof FINDING_SCHEMA>[];
const _pinFindingWire: readonly Static<typeof FINDING_SCHEMA>[] = [] as Finding[];
const _pinError: readonly ClassifyErrorInfo[] = [] as Static<typeof CLASSIFY_ERROR_SCHEMA>[];
const _pinErrorWire: readonly Static<typeof CLASSIFY_ERROR_SCHEMA>[] = [] as ClassifyErrorInfo[];
const _pinReport: ContractReport = {} as Static<typeof REPORT_SCHEMA>;
// Report itself pins one direction only — its contract arrays are readonly while Type.Array is
// mutable — but every element type above is pinned both ways, which is where the fields live.
void [
  _pinMeasurement,
  _pinMeasurementWire,
  _pinFinding,
  _pinFindingWire,
  _pinError,
  _pinErrorWire,
  _pinReport,
];
