import { describe, expect, test } from "bun:test";
import { reportStatus } from "./status.ts";

const classification = (input: string) => ({ rule: "r", input, value: 0.5 }) as never;
const finding = (input: string, severity: "warn" | "error") =>
  ({ rule: "r", input, value: 0.5, severity }) as never;
const failure = (input: string) => ({ input, code: "X", message: "m" }) as never;

describe("reportStatus", () => {
  test("a run with no findings passes, and so does each input", () => {
    const out = reportStatus({
      classifications: [classification("a.ts"), classification("b.ts")],
      findings: [],
      errors: [],
    });
    expect(out.status).toBe("pass");
    expect(out.inputs).toEqual([
      { input: "a.ts", status: "pass" },
      { input: "b.ts", status: "pass" },
    ]);
  });

  test("a warning warns its input and the run, and leaves the other input passing", () => {
    const out = reportStatus({
      classifications: [classification("a.ts"), classification("b.ts")],
      findings: [finding("a.ts#x", "warn")],
      errors: [],
    });
    expect(out.status).toBe("warn");
    expect(out.inputs).toEqual([
      { input: "a.ts", status: "warn" },
      { input: "b.ts", status: "pass" },
    ]);
  });

  test("an error finding fails, and fail wins over warn", () => {
    const out = reportStatus({
      classifications: [classification("a.ts")],
      findings: [finding("a.ts", "warn"), finding("a.ts", "error")],
      errors: [],
    });
    expect(out.status).toBe("fail");
    expect(out.inputs).toEqual([{ input: "a.ts", status: "fail" }]);
  });

  test("a unit the model never judged fails its input, as the exit code does", () => {
    const out = reportStatus({
      classifications: [classification("a.ts")],
      findings: [],
      errors: [failure("b.ts")],
    });
    expect(out.status).toBe("fail");
    expect(out.inputs.find((i) => i.input === "b.ts")?.status).toBe("fail");
  });

  test("a run that judged nothing fails", () => {
    expect(reportStatus({ classifications: [], findings: [], errors: [] }).status).toBe("fail");
  });
});
