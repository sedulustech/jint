import { Type, type Static } from "@sinclair/typebox";

export const MEASUREMENT_SCHEMA = Type.Object({
  sensor: Type.String(),
  input: Type.String(),
  value: Type.Number(),
  stage: Type.Optional(
    Type.Union([Type.Literal("file"), Type.Literal("sweep"), Type.Literal("confirm")]),
  ),
});

export const SIGNAL_SCHEMA = Type.Object({
  sensor: Type.String(),
  input: Type.String(),
  value: Type.Number(),
  severity: Type.Union([Type.Literal("error"), Type.Literal("warn")]),
});

export const REQUEST_ERROR_SCHEMA = Type.Object({
  input: Type.String(),
  code: Type.String(),
  message: Type.String(),
});

export const DEGRADATION_SCHEMA = Type.Object({
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
  errors: Type.Array(REQUEST_ERROR_SCHEMA),
  degradations: Type.Array(DEGRADATION_SCHEMA),
});

export type Report = Static<typeof REPORT_SCHEMA>;
