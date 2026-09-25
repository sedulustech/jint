import { describe, test, expect, afterEach } from "bun:test";
import { log, setLogLevel } from "./logger.ts";

const originalError = console.error;
let captured: unknown[][] = [];

function capture(): void {
  captured = [];
  console.error = (...args: unknown[]) => {
    captured.push(args);
  };
}

afterEach(() => {
  console.error = originalError;
  setLogLevel("off");
});

describe("logger", () => {
  test("default level is silent (design §6)", () => {
    capture();
    log("error", "should not appear");
    expect(captured).toHaveLength(0);
  });

  test("debug level passes debug entries as one JSON object per line", () => {
    capture();
    setLogLevel("debug");
    log("debug", "unit failed", { file: "a.ts", errorCode: "JEV_UNAVAILABLE" });
    expect(captured).toHaveLength(1);
    const entry = JSON.parse(captured[0]![0] as string);
    expect(entry).toEqual({
      level: "debug",
      msg: "unit failed",
      file: "a.ts",
      errorCode: "JEV_UNAVAILABLE",
    });
  });

  test("threshold filters lower levels", () => {
    capture();
    setLogLevel("warn");
    log("info", "noisy");
    log("warn", "heard");
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0]![0] as string).msg).toBe("heard");
  });

  test("error entries always pass at error level", () => {
    capture();
    setLogLevel("error");
    log("error", "fatal-ish");
    expect(captured).toHaveLength(1);
  });

  test("fields-first structure, message last", () => {
    capture();
    setLogLevel("info");
    log("info", "run complete", { measurements: 5, findings: 0 });
    const entry = JSON.parse(captured[0]![0] as string);
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("run complete");
    expect(entry.measurements).toBe(5);
  });
});
