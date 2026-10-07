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
  Type.Object({ kind: Type.Literal("type"), ...ELEMENT_BASE, name: Type.Optional(Type.String()) }),
  Type.Object({
    kind: Type.Literal("binding"),
    ...ELEMENT_BASE,
    name: Type.Optional(Type.String()),
  }),
  Type.Object({ kind: Type.Literal("import"), ...ELEMENT_BASE }),
  Type.Object({
    kind: Type.Literal("comment"),
    ...ELEMENT_BASE,
    docstringOf: Type.Optional(
      Type.Object({
        kind: Type.Union([Type.Literal("module"), Type.Literal("function"), Type.Literal("class")]),
        name: Type.String(),
      }),
    ),
  }),
]);

export const MEASUREMENT_SCHEMA = Type.Object({
  rule: Type.String(),
  input: Type.String(),
  value: Type.Number(),
  // v1.2, additive (score rules): the distribution the value summarizes. Optional — pre-v1.2
  // dumps without the fields still parse.
  probabilities: Type.Optional(Type.Record(Type.String(), Type.Number())),
  confidence: Type.Optional(Type.Number()),
  // v1.1: the measured subject, fully typed (tmp/designs/element.md); replaces the v1 stage/span
  // proxies. Additive: v1 reports without it still parse.
  element: Type.Optional(ELEMENT_SCHEMA),
});

export const FINDING_SCHEMA = Type.Object({
  rule: Type.String(),
  input: Type.String(),
  value: Type.Number(),
  severity: Type.Union([Type.Literal("error"), Type.Literal("warn")]),
  // Additive (v1.3, score rules): the chosen rubric level's legend text — the report displays
  // self-contained, no criteria or request reach-ins.
  note: Type.Optional(Type.String()),
  // Additive (element-scoped findings): the element's exact span; files-target findings lack it.
  location: Type.Optional(Type.Object({ input: Type.String(), span: SPAN_SCHEMA })),
  // Additive (custom tier): a policy callback's extra structured data. finding.message dropped
  // (consumers join by rule id).
  data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

/**
 * The CLI's default stdout projection: one line per finding, whitespace-separated columns,
 * regex-parseable. All columns optional except rule/level/score; note keeps its brackets.
 */
export const LINE_SCHEMA = Type.String({
  // path(@L<line>)  rule  level  score  [note]  run=<id> — two-space separators, parseable. The
  // element id never prints (run-scoped internal); files-target findings have no anchor.
  pattern: "^(\\S+)(@L\\d+)?  (\\S+)  (error|warn)  \\d+\\.\\d{2}(  \\[[^\\]]+\\])?(  run=\\S+)?$",
});

export const CLASSIFY_ERROR_SCHEMA = Type.Object({
  input: Type.String(),
  code: Type.String(),
  message: Type.String(),
});

export const REPORT_SCHEMA = Type.Object({
  tool: Type.Literal("jint"),
  version: Type.String(),
  measurements: Type.Array(MEASUREMENT_SCHEMA),
  findings: Type.Array(FINDING_SCHEMA),
  errors: Type.Array(CLASSIFY_ERROR_SCHEMA),
  notes: Type.Array(Type.String()),
});

export type Report = Static<typeof REPORT_SCHEMA>;

// Type-level pin: the contract's plain interfaces and the wire schemas cannot drift.
const _pinMeasurement: readonly Measurement[] = [] as Static<typeof MEASUREMENT_SCHEMA>[];
const _pinFinding: readonly Finding[] = [] as Static<typeof FINDING_SCHEMA>[];
const _pinError: readonly ClassifyErrorInfo[] = [] as Static<typeof CLASSIFY_ERROR_SCHEMA>[];
const _pinReport: ContractReport = {} as Static<typeof REPORT_SCHEMA>;
void [_pinMeasurement, _pinFinding, _pinError, _pinReport];
