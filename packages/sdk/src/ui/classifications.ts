/**
 * Classifications of edited questions, filed under the run they edit:
 * `<run>/classifications/<seq>.json`. One is an edited question and state with the answer it
 * earned, so a reader can step through a pair's classifications in the run view and the agent can
 * read what changed the reading. The original run itself is untouched.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClassifyRequest, Wire } from "./classify.ts";

const CLASSIFICATIONS_DIR = "classifications";
const SEQ_WIDTH = 4;

/** One filed iteration: the pair it edits, the edit, and what it answered. */
export interface ClassificationRecord extends ClassifyRequest {
  seq: number;
  ts: string;
  rule: string;
  input: string;
  answer: unknown;
  wire?: Wire;
  /**
   * The actor that filed it: the user in the UI, or the agent. Absent on classifications filed
   * before it existed, which the UI filed. The original has no record: its actor is the rule.
   */
  by?: "agent" | "user";
}

const classificationsDir = (runDir: string): string => join(runDir, CLASSIFICATIONS_DIR);

/** Every classification filed under a run, oldest first. */
async function readClassifications(runDir: string): Promise<ClassificationRecord[]> {
  const names = await readdir(classificationsDir(runDir)).catch(() => [] as string[]);
  const records = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) =>
        JSON.parse(await readFile(join(classificationsDir(runDir), name), "utf8")),
      ),
  );
  return (records as ClassificationRecord[]).sort((a, b) => a.seq - b.seq);
}

/** The classifications filed for one pair - one rule at one input - oldest first. */
export async function listClassifications(
  runDir: string,
  rule: string,
  input: string,
): Promise<ClassificationRecord[]> {
  return (await readClassifications(runDir)).filter((t) => t.rule === rule && t.input === input);
}

/**
 * File a classification under its run; the sequence is run-wide, so filenames never collide across
 * pairs.
 */
export async function recordClassification(
  runDir: string,
  entry: Omit<ClassificationRecord, "seq" | "ts">,
): Promise<ClassificationRecord> {
  await mkdir(classificationsDir(runDir), { recursive: true });
  const seq = (await readClassifications(runDir)).reduce((max, t) => Math.max(max, t.seq), 0) + 1;
  const record: ClassificationRecord = { seq, ts: new Date().toISOString(), ...entry };
  await writeFile(
    join(classificationsDir(runDir), `${String(seq).padStart(SEQ_WIDTH, "0")}.json`),
    JSON.stringify(record),
  );
  return record;
}
