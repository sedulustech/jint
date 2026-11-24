import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

const inert = '(block_continuation) @marker (#set! "capture.marker.definition" "false")';

const quotes = (knobs: string): string =>
  `(block_quote) @quote (#set! "capture.quote.definition" "true") ${knobs}\n${inert}\n`;

const elementsOf = async (source: string, queries: string) =>
  (await decompose(source, "markdown", { queries })).definitions;

describe("omit", () => {
  test("leaves another capture's nodes out of the text, and the span alone", async () => {
    const source = "> one\n> two\n";
    const [quote] = await elementsOf(source, quotes('(#set! "capture.quote.omit" "marker")'));
    expect(quote!.content).toBe("> one\ntwo\n");
    expect(quote!.span.endByte).toBe(source.length);
  });

  test("without it the text is the source", async () => {
    const [quote] = await elementsOf("> one\n> two\n", quotes(""));
    expect(quote!.content).toBe("> one\n> two\n");
  });

  test("a capture no pattern emits fails the load", async () => {
    const scm = quotes('(#set! "capture.quote.omit" "nothing")');
    expect(elementsOf("x\n", scm)).rejects.toThrow(
      'line 1: directive "capture.quote.omit" wants a capture the queries emit (got "nothing")',
    );
  });
});

describe("nameOmit", () => {
  const named = (pattern: string): string =>
    `(atx_heading (inline) @name) @title (#set! "capture.title.definition" "true") (#set! "capture.title.nameOmit" "${pattern}")\n`;

  test("leaves what the pattern matches out of the name", async () => {
    const [title] = await elementsOf("# draft: A\n", named("^draft:\\\\s+"));
    expect(title!.name).toBe("A");
  });

  test("a name it empties is no name", async () => {
    const [title] = await elementsOf("# A\n", named(".*"));
    expect(title!.name).toBeUndefined();
  });

  test("a pattern that does not compile fails the load, with the cause", async () => {
    const thrown = await elementsOf("x\n", named("(")).catch((error: Error) => error);
    expect((thrown as Error).message).toContain('wants a regular expression (got "(")');
    expect((thrown as Error).cause).toBeInstanceOf(SyntaxError);
  });
});
