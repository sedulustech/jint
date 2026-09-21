import { Type, type Static } from "@sinclair/typebox";

export const MEASUREMENT_SCHEMA = Type.Object({
  sensor: Type.String(),
  input: Type.String(),
  value: Type.Number(),
});

export const SIGNAL_SCHEMA = Type.Object({
  sensor: Type.String(),
  input: Type.String(),
  value: Type.Number(),
  severity: Type.Union([Type.Literal("error"), Type.Literal("warn")]),
});

export const DIAGNOSTIC_SCHEMA = Type.Object({
  input: Type.String(),
  code: Type.String(),
  message: Type.String(),
});

export const REPORT_SCHEMA = Type.Object({
  tool: Type.Literal("jint"),
  format: Type.String(),
  version: Type.String(),
  measurements: Type.Array(MEASUREMENT_SCHEMA),
  signals: Type.Array(SIGNAL_SCHEMA),
  diagnostics: Type.Array(DIAGNOSTIC_SCHEMA),
});

export type Report = Static<typeof REPORT_SCHEMA>;
