/**
 * The answer cache: one stored answer per question, on disk, keyed by the request that question
 * would be sent alone (see questionKey in decisions.ts). A hit skips the network for that question;
 * the questions of one element that miss go out together in one request.
 *
 * It holds the endpoint's own answer for the question, unread: a hit goes through the same reading
 * a fresh reply does. An entry that no longer reads (a changed format) is a miss, never an error,
 * and a store that cannot be read or written costs only the cache, never the run.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { DecisionsAnswer } from "./reading.ts";

/** What one cache entry holds: the endpoint's answer without its positional name, and when. */
export interface StoredAnswer {
  /** When the endpoint answered (ISO): luna has no snapshot, so an entry says how old it is. */
  readonly at: string;
  readonly model: string;
  readonly answer: Omit<DecisionsAnswer, "name">;
}

export interface AnswerStore {
  get(key: string): StoredAnswer | undefined;
  put(key: string, entry: StoredAnswer): void;
}

/** The store's directory: $JINT_CACHE_DIR, else <homedir>/.jint/cache. */
export function cacheDir(env: Record<string, string | undefined> = process.env): string {
  const dir = env.JINT_CACHE_DIR;
  return dir !== undefined && dir !== "" ? resolve(dir) : join(homedir(), ".jint", "cache");
}

/** The hex digest of `text`: a cache key is the hash of what was asked. */
export const hashOf = (text: string): string => createHash("sha256").update(text).digest("hex");

const isEntry = (value: unknown): value is StoredAnswer =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as StoredAnswer).at === "string" &&
  typeof (value as StoredAnswer).model === "string" &&
  typeof (value as StoredAnswer).answer === "object" &&
  (value as StoredAnswer).answer !== null;

/** A store of <dir>/<first two hex>/<key>.json files, written whole and renamed into place. */
export function fileStore(dir: string): AnswerStore {
  const path = (key: string) => join(dir, key.slice(0, 2), `${key}.json`);
  return {
    get(key) {
      try {
        const entry: unknown = JSON.parse(readFileSync(path(key), "utf8"));
        return isEntry(entry) ? entry : undefined;
      } catch {
        // absent, unreadable or not JSON: all the same as never asked
        return undefined;
      }
    },
    put(key, entry) {
      const file = path(key);
      const scratch = `${file}.${process.pid}.tmp`;
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(scratch, JSON.stringify(entry));
        renameSync(scratch, file);
      } catch (err) {
        // The cache never breaks the run it speeds up: the answer is already in hand.
        process.emitWarning(
          `jint: could not write the answer cache in ${dir}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
