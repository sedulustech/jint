import { REPORT_SCHEMA, LINE_SCHEMA } from "@jint/sdk";
/**
 * One assertion for the three surfaces a CLI run owns: exit code, stderr, stdout. Every failure
 * message names all three surfaces so a red test reads as a full contract diff, not one symptom.
 *
 * SCHEMA DRIFT CATCHER: 'json' stdout validates against the SDK's ReportSchema and 'lines' stdout
 * parses per LINE_SCHEMA, so a renderer or report change that drifts from the schema fails HERE,
 * not in a client.
 *
 * Testing doctrine: mocked tests assert CONTRACT (exit codes, messages, shapes) and run everywhere;
 * live tests assert MODEL BEHAVIOR and run opt-in — see tests/README.md.
 */
import { Value } from "@sinclair/typebox/value";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ContractSpec {
  exit: number;
  /** Substring(s) and/or regex(es) that must all appear on stderr. */
  stderr?: string | RegExp | Array<string | RegExp>;
  /**
   * 'empty' - stdout must be the empty string. 'json' - stdout parses AND validates against
   * ReportSchema. 'lines' - every stdout line parses per LINE_SCHEMA. string / { contains } -
   * substring that must appear on stdout.
   */
  stdout?: "empty" | "json" | "lines" | string | { contains: string };
}

/** The parsed stdout report when spec.stdout === 'json'; null otherwise. */
export function expectContract(
  r: RunResult,
  spec: ContractSpec & { stdout: "json" },
): Record<string, any>;
export function expectContract(
  r: RunResult,
  spec: ContractSpec & {
    stdout?: "empty" | (string & Record<never, never>) | { contains: string };
  },
): null;
export function expectContract(r: RunResult, spec: ContractSpec): Record<string, any> | null {
  const failures: string[] = [];
  if (r.code !== spec.exit) failures.push(`exit: expected ${spec.exit}, got ${r.code}`);

  const stderrSpecs =
    spec.stderr === undefined ? [] : Array.isArray(spec.stderr) ? spec.stderr : [spec.stderr];
  for (const s of stderrSpecs) {
    const ok = typeof s === "string" ? r.stderr.includes(s) : s.test(r.stderr);
    if (!ok) failures.push(`stderr: missing ${describe(s)}`);
  }

  let parsed: Record<string, any> | null = null;
  if (spec.stdout === "empty") {
    if (r.stdout !== "") failures.push(`stdout: expected empty, got: ${truncate(r.stdout)}`);
  } else if (spec.stdout === "json") {
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      failures.push(`stdout: expected jint report JSON, got: ${truncate(r.stdout)}`);
    }
    if (parsed !== null && !Value.Check(REPORT_SCHEMA, parsed)) {
      failures.push("stdout: report JSON violates ReportSchema (client drifted from the schema)");
    }
  } else if (spec.stdout === "lines") {
    if (r.stdout !== "") {
      for (const line of r.stdout.trimEnd().split("\n")) {
        if (!Value.Check(LINE_SCHEMA, line)) {
          failures.push(`stdout line violates LineSchema: ${truncate(line)}`);
        }
      }
    }
  } else if (typeof spec.stdout === "string") {
    if (!r.stdout.includes(spec.stdout)) failures.push(`stdout: missing "${spec.stdout}"`);
  } else if (typeof spec.stdout === "object" && spec.stdout !== null) {
    if (!r.stdout.includes(spec.stdout.contains)) {
      failures.push(`stdout: missing "${spec.stdout.contains}"`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `contract violated (${failures.join("; ")})\n  exit=${r.code}\n  stderr=${truncate(r.stderr)}\n  stdout=${truncate(r.stdout)}`,
    );
  }
  return parsed as any;
}

function describe(s: string | RegExp): string {
  return typeof s === "string" ? `"${s}"` : String(s);
}

function truncate(s: string): string {
  const oneLine = s.replace(/\n/g, "\\n");
  return oneLine.length > 300 ? oneLine.slice(0, 300) + "…" : oneLine;
}
