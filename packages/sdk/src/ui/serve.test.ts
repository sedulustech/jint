import { describe, test, expect } from "bun:test";
import { hostAllowed, normalizeUiHost } from "./serve.ts";

describe("hostAllowed", () => {
  test("localhost variants pass, port suffix optional", () => {
    for (const host of [
      "127.0.0.1:5178",
      "localhost",
      "localhost:4222",
      "[::1]",
      "[::1]:5178",
      "LOCALHOST:80",
    ]) {
      expect(hostAllowed(host, "127.0.0.1")).toBe(true);
    }
  });

  test("foreign hosts and a missing header are rejected", () => {
    for (const host of [
      "evil.example",
      "evil.example:80",
      "127.0.0.1.evil.example",
      "internal.lan:5178",
      null,
    ]) {
      expect(hostAllowed(host, "127.0.0.1")).toBe(false);
    }
  });

  test("the bound host is allowed when a custom host is set", () => {
    expect(hostAllowed("0.0.0.0:5178", "0.0.0.0")).toBe(true);
    expect(hostAllowed("evil.example:80", "0.0.0.0")).toBe(false);
  });

  test("a bound host matches case-insensitively", () => {
    expect(hostAllowed("mybox.local:5178", "MyBox.local")).toBe(true);
  });

  test("a bare IPv6 bound host matches its bracketed Host header", () => {
    expect(hostAllowed("[fe80::1]:5178", "fe80::1")).toBe(true);
    expect(hostAllowed("[FE80::1]", "fe80::1")).toBe(true);
    expect(hostAllowed("[fe80::2]:5178", "fe80::1")).toBe(false);
  });
});

describe("normalizeUiHost", () => {
  test("hosts pass through; bracketed IPv6 is a host, not host:port", () => {
    for (const host of ["127.0.0.1", "localhost", "0.0.0.0", "[::1]", "::1"]) {
      expect(normalizeUiHost(host)).toBe(host);
    }
  });

  test("a :port suffix is rejected, naming the right var", () => {
    for (const host of ["0.0.0.0:5178", "localhost:4222", "[::1]:5178"]) {
      expect(() => normalizeUiHost(host)).toThrow("JINT_UI_PORT");
    }
  });
});
