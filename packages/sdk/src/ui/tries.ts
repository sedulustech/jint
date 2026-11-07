/**
 * Try-it iterations, filed under the run they edit: `<run>/tries/<seq>.json`. A try is one edited
 * question and state with the answer it earned, so a reader can cycle a pair's iterations in the
 * run view and the agent can read what changed the reading. The original run itself is untouched.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClassifyRequest, Wire } from "./classify.ts";

const TRIES_DIR = "tries";
const SEQ_WIDTH = 4;

/** One filed iteration: the pair it edits, the edit, and what it answered. */
export interface TryRecord extends ClassifyRequest {
  seq: number;
  ts: string;
  rule: string;
  input: string;
  answer: unknown;
  wire?: Wire;
  /**
   * Who filed it: the reader in the UI, or the agent. Absent on tries filed before it existed,
   * which the UI filed.
   */
  by?: "agent" | "manual";
}

const triesDir = (runDir: string): string => join(runDir, TRIES_DIR);

/** Every try filed under a run, oldest first. */
async function readTries(runDir: string): Promise<TryRecord[]> {
  const names = await readdir(triesDir(runDir)).catch(() => [] as string[]);
  const records = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => JSON.parse(await readFile(join(triesDir(runDir), name), "utf8"))),
  );
  return (records as TryRecord[]).sort((a, b) => a.seq - b.seq);
}

/** The tries filed for one pair - one rule at one input - oldest first. */
export async function listTries(runDir: string, rule: string, input: string): Promise<TryRecord[]> {
  return (await readTries(runDir)).filter((t) => t.rule === rule && t.input === input);
}

/** File a try under its run; the sequence is run-wide, so filenames never collide across pairs. */
export async function recordTry(
  runDir: string,
  entry: Omit<TryRecord, "seq" | "ts">,
): Promise<TryRecord> {
  await mkdir(triesDir(runDir), { recursive: true });
  const seq = (await readTries(runDir)).reduce((max, t) => Math.max(max, t.seq), 0) + 1;
  const record: TryRecord = { seq, ts: new Date().toISOString(), ...entry };
  await writeFile(
    join(triesDir(runDir), `${String(seq).padStart(SEQ_WIDTH, "0")}.json`),
    JSON.stringify(record),
  );
  return record;
}
