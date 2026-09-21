import { Type, type Static } from "@sinclair/typebox";

export const MeasurementSchema = Type.Object({
  sensor: Type.String(),
  input: Type.String(),
  value: Type.Number(),
});

export const SignalSchema = Type.Object({
  sensor: Type.String(),
  input: Type.String(),
  value: Type.Number(),
  severity: Type.Union([Type.Literal("error"), Type.Literal("warn")]),
});

export const DiagnosticSchema = Type.Object({
  input: Type.String(),
  code: Type.String(),
  message: Type.String(),
});

export const ReportSchema = Type.Object({
  tool: Type.Literal("jint"),
  format: Type.String(),
  version: Type.String(),
  measurements: Type.Array(MeasurementSchema),
  signals: Type.Array(SignalSchema),
  diagnostics: Type.Array(DiagnosticSchema),
});

export type Report = Static<typeof ReportSchema>;
