/**
 * Structured JSON logger to stderr — implementation B from typescript/logging.md. This is the only
 * file in src/ allowed to touch console.*.
 *
 * Stdout carries the report; stderr carries logs. Default level is silent (design §6); --debug or
 * LOG_LEVEL=debug|info|warn|error turns it on.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "off";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, off: 99 };

function isLevel(value: string | undefined): value is LogLevel {
  return (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error" ||
    value === "off"
  );
}

function initialThreshold(): number {
  const raw = process.env.LOG_LEVEL;
  return ORDER[isLevel(raw) ? raw : "off"];
}

let threshold = initialThreshold();

export function setLogLevel(level: LogLevel): void {
  threshold = ORDER[level];
}

export function log(
  level: Exclude<LogLevel, "off">,
  msg: string,
  fields?: Record<string, unknown>,
): void {
  if (ORDER[level] < threshold) return;
  // the single console.* exemption
  const entry = fields ? { level, msg, ...fields } : { level, msg };
  console.error(JSON.stringify(entry));
}
