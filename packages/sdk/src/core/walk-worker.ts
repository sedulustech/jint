/**
 * The walk worker: one thread with its own wasm memory, serving walkUnit for a WalkPool. It takes a
 * registry once, then one unit at a time, and answers each with the walked inventory.
 *
 * The message handler is installed synchronously, before any await: a message that arrives while
 * the handler is missing is dropped. The grammar side loads lazily inside the handler, so the
 * classifier stack never loads here.
 */

import type { GrammarRegistry } from "./grammars/grammars.ts";
import type { WalkUnitOptions } from "./rules/walk-unit.ts";
import type { Unit } from "./types.ts";

/** Pool to worker. The first message is `init`; every later one is a `walk` job. */
export type WalkRequest =
  | { readonly t: "init"; readonly registry: GrammarRegistry }
  | {
      readonly t: "walk";
      readonly id: number;
      readonly unit: Unit;
      readonly options: Omit<WalkUnitOptions, "registry">;
    };

declare const self: Worker;

let registry: GrammarRegistry | undefined;

self.onmessage = async (event: MessageEvent<WalkRequest>) => {
  const request = event.data;
  if (request.t === "init") {
    registry = request.registry;
    return;
  }
  const { walkUnit } = await import("./rules/walk-unit.ts");
  const walked = await walkUnit(request.unit, { ...request.options, registry });
  self.postMessage({ t: "walked", id: request.id, walked });
};

self.postMessage({ t: "ready" });
