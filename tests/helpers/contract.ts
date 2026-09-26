/**
 * One assertion for the three surfaces a CLI run owns: exit code, stderr, stdout. Every failure
 * message names all three surfaces so a red test reads as a full contract diff, not one symptom.
 *
 * Testing doctrine: mocked tests assert CONTRACT (exit codes, messages, wire shapes) and run
 * everywhere; live tests assert MODEL BEHAVIOR and run opt-in — see tests/README.md.
 */

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
   * 'empty' - stdout must be the empty string. 'json' - stdout parses and carries format
   * "jint-report/v1". string / { contains } - substring that must appear on stdout.
   */
  stdout?: "empty" | "json" | string | { contains: string };
}

/** The parsed stdout report when spec.stdout === 'json'; null otherwise. */
export function expectContract<Stdout extends ContractSpec["stdout"]>(
  r: RunResult,
  spec: Stdout extends "json" ? ContractSpec & { stdout: "json" } : ContractSpec,
): Stdout extends "json" ? Record<string, any> : null {
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
      if (parsed?.format !== "jint-report/v1") {
        failures.push(
          `stdout: JSON lacks format jint-report/v1 (got ${JSON.stringify(parsed?.format)})`,
        );
      }
    } catch {
      failures.push(`stdout: expected jint-report/v1 JSON, got: ${truncate(r.stdout)}`);
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
