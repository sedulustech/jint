/**
 * Where a running UI server says it is. `jint ui serve` writes `<store>/.serve.json` with its url
 * and pid, and removes it on close; a run reads it to print the address of its own run. The file
 * lives in the store it serves, so it can only ever name a server for THAT store (run dirs are the
 * directories of the store; a file beside them is not one).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Registration {
  readonly url: string;
  readonly pid: number;
}

const registryFile = (root: string): string => join(root, ".serve.json");

/**
 * Records a server for `root`; the returned function removes the record, but only while it is still
 * this server's (a newer server for the same store keeps its own).
 */
export function registerUi(root: string, url: string): () => void {
  const registration: Registration = { url, pid: process.pid };
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(registryFile(root), JSON.stringify(registration));
  } catch {
    // a store that cannot be written has nothing to find: the server still serves
    return () => {};
  }
  return () => {
    try {
      const held = JSON.parse(readFileSync(registryFile(root), "utf8")) as Registration;
      if (held.pid === registration.pid) rmSync(registryFile(root), { force: true });
    } catch {
      // already gone
    }
  };
}

/**
 * The url of the running server for `root`, or null: no record, a record whose server no longer
 * answers (a crash leaves one behind), or one that is not this store's. Never throws - a run must
 * not fail because it could not find a viewer.
 */
export async function findUi(root: string): Promise<string | null> {
  let held: Registration;
  try {
    held = JSON.parse(readFileSync(registryFile(root), "utf8")) as Registration;
    if (typeof held.url !== "string") return null;
  } catch {
    return null;
  }
  try {
    const answer = await fetch(new URL("/api/runs", held.url), {
      signal: AbortSignal.timeout(500),
    });
    return answer.ok ? held.url : null;
  } catch {
    return null;
  }
}
