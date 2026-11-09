import { expect, test } from "bun:test";
import { inline } from "./inline";

test("code spans and links come out as parts, the rest as text", () => {
  expect(inline("Set `JINT_API_URL`. See [models](../endpoints.md).", "reference")).toEqual([
    { kind: "text", text: "Set " },
    { kind: "code", text: "JINT_API_URL" },
    { kind: "text", text: ". See " },
    { kind: "link", text: "models", href: "/docs/endpoints/" },
    { kind: "text", text: "." },
  ]);
});

test("text with no markup is one part", () => {
  expect(inline("the file to measure")).toEqual([{ kind: "text", text: "the file to measure" }]);
});
