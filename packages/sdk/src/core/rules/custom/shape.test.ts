import { expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { FUNCTION_FIELD_SCHEMAS } from "./schema.ts";
import { SHAPE_SCHEMAS } from "./shape.ts";

const described = [
  ...Object.values(FUNCTION_FIELD_SCHEMAS),
  ...Object.values(SHAPE_SCHEMAS).flatMap((shape) => Object.values(shape.properties)),
];

test("every field the reference lists says what it is and means", () => {
  expect(described.length).toBe(4 + 19 + 7 + 2);
  for (const field of described) {
    expect(field.description).toBeTruthy();
    expect(field.display).toBeTruthy();
  }
});

test("a function field accepts a function and nothing else", () => {
  const { state } = FUNCTION_FIELD_SCHEMAS;
  expect(Value.Check(state, () => ({}))).toBe(true);
  expect(Value.Check(state, "state")).toBe(false);
  expect(Value.Check(state, undefined)).toBe(false);
});
