/**
 * Classifications of edited questions, filed under the run they edit:
 * `<run>/classifications/<seq>.json`. One is an edited question and state with the answer it
 * earned, so a reader can step through an address's classifications in the run view and the agent
 * can read what changed the reading. The original run itself is untouched.
 */
import { link, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClassifyRequest, Wire } from "./classify.ts";

const CLASSIFICATIONS_DIR = "classifications";
const SEQ_WIDTH = 4;

/** One filed iteration: the address it edits, the edit, and what it answered. */
export interface ClassificationRecord extends ClassifyRequest {
  seq: number;
  /** The address's own number: #1 is its first classification after the original. */
  n: number;
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

/** What a filed record is about: enough to find an address's records without reading them all. */
interface Filed {
  seq: number;
  rule: string;
  input: string;
}

/**
 * Each run's filed records by file name. A record never changes once written, so a poll reads only
 * the files it has not seen: its cost follows the new files, not the run's whole history.
 */
const seen = new Map<string, Map<string, Filed>>();

const JSON_SUFFIX = ".json";

/** The run's filed records, indexing any new file; one still being written is read next time. */
async function filedIn(runDir: string): Promise<Map<string, Filed>> {
  const dir = classificationsDir(runDir);
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) =>
    name.endsWith(JSON_SUFFIX),
  );
  const known = seen.get(runDir) ?? new Map<string, Filed>();
  seen.set(runDir, known);
  await Promise.all(
    names
      .filter((name) => !known.has(name))
      .map(async (name) => {
        const record = await readRecord(join(dir, name));
        if (record !== undefined)
          known.set(name, { seq: record.seq, rule: record.rule, input: record.input });
      }),
  );
  return new Map(names.flatMap((name) => (known.has(name) ? [[name, known.get(name)!]] : [])));
}

async function readRecord(path: string): Promise<ClassificationRecord | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ClassificationRecord;
  } catch {
    return undefined;
  }
}

/** The classifications filed for one address - one rule at one input - oldest first. */
export async function listClassifications(
  runDir: string,
  rule: string,
  input: string,
): Promise<ClassificationRecord[]> {
  const dir = classificationsDir(runDir);
  const mine = [...(await filedIn(runDir))].filter(([, f]) => f.rule === rule && f.input === input);
  const records = await Promise.all(mine.map(([name]) => readRecord(join(dir, name))));
  return records
    .filter((record): record is ClassificationRecord => record !== undefined)
    .sort((x, y) => x.seq - y.seq);
}

/**
 * File a classification under its run; the sequence is run-wide, so filenames never collide across
 * addresses.
 */
export async function recordClassification(
  runDir: string,
  entry: Omit<ClassificationRecord, "seq" | "ts" | "n">,
): Promise<ClassificationRecord> {
  await mkdir(classificationsDir(runDir), { recursive: true });
  // Written whole, then linked under its name: a poll never reads half a file, and two actors
  // filing at once cannot take the same number (the loser's link fails and it takes the next).
  const at = classificationsDir(runDir);
  for (;;) {
    const filed = [...(await filedIn(runDir)).values()];
    const seq = filed.reduce((max, t) => Math.max(max, t.seq), 0) + 1;
    const n = filed.filter((t) => t.rule === entry.rule && t.input === entry.input).length + 1;
    const record: ClassificationRecord = { seq, n, ts: new Date().toISOString(), ...entry };
    const name = `${String(seq).padStart(SEQ_WIDTH, "0")}${JSON_SUFFIX}`;
    const staged = join(at, `.${name}.${crypto.randomUUID()}.tmp`);
    await writeFile(staged, JSON.stringify(record));
    try {
      await link(staged, join(at, name));
      return record;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    } finally {
      await unlink(staged);
    }
  }
}
