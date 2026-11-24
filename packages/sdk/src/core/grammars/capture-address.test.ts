import { describe, expect, test } from "bun:test";
import { CAPTURE_ADDRESS } from "./capture-address.ts";
import { EMBEDDED } from "./grammars.ts";
import { assertCaptureAddress, scmCaptureDeclarations, scmEmittedNames } from "./query.ts";

const SCM = '(section) @h2.section (#set! "capture.h2.section.definition" "true")';

describe("a capture name with a dot", () => {
  test("is one name in a pattern and in a directive", () => {
    expect([...scmEmittedNames(SCM)]).toEqual(["h2.section"]);
    expect([...scmCaptureDeclarations(SCM).definitions]).toEqual(["h2.section"]);
  });

  test.each(["markdown:h2.section", "markdown:h2"])("%p is an address", (to) => {
    expect(() => assertCaptureAddress(to, EMBEDDED)).not.toThrow();
  });

  test.each(["markdown:h7.section", "markdown:section", "markdown:h2."])("%p is none", (to) => {
    expect(() => assertCaptureAddress(to, EMBEDDED)).toThrow();
  });

  test.each(["markdown:.h2", "markdown:h2..section", "mark.down:h2"])("%p has no shape", (to) => {
    expect(CAPTURE_ADDRESS.test(to)).toBe(false);
  });
});
