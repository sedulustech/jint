import { Type, type Static } from "@sinclair/typebox";
import type {
  ClassifyErrorInfo,
  Finding,
  Measurement,
  Report as ContractReport,
} from "@jint/contract";

export const MEASUREMENT_SCHEMA = Type.Object({
  rule: Type.String(),
  input: Type.String(),
  value: Type.Number(),
  stage: Type.Optional(Type.Union([Type.Literal("file"), Type.Literal("element")])),
});

export const FINDING_SCHEMA = Type.Object({
  rule: Type.String(),
  input: Type.String(),
  value: Type.Number(),
  severity: Type.Union([Type.Literal("error"), Type.Literal("warn")]),
  // Additive (jint-report/v1, TS tier): a policy callback's extra structured data.
  // Schema change (2026-09-28, still jint-report/v1): finding.message DROPPED — the
  // never-promised score criteria line and callback message are gone; consumers join by rule id.
  data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const CLASSIFY_ERROR_SCHEMA = Type.Object({
  input: Type.String(),
  code: Type.String(),
  message: Type.String(),
});

export const REPORT_SCHEMA = Type.Object({
  tool: Type.Literal("jint"),
  format: Type.String(),
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
