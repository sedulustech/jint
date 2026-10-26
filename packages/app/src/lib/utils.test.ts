import { describe, expect, test } from "bun:test";
import { cn } from "./utils";

describe("cn", () => {
  test("a type-scale size survives beside a text color", () => {
    expect(cn("text-body text-secondary-foreground")).toBe("text-body text-secondary-foreground");
  });

  test("a later type-scale size replaces an earlier size", () => {
    expect(cn("text-sm text-popover-foreground", "text-body")).toBe(
      "text-popover-foreground text-body",
    );
  });
});
