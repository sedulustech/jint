/**
 * A run's id: a UUIDv7 (RFC 9562), so it is unique across machines and still sorts by when the run
 * started. Runs recorded before it are named by the Unix milliseconds they started at; both forms
 * carry their start, so a store that holds both still lists newest first.
 */

/**
 * A UUIDv7 for a run that starts at `startMs`: 48 bits of the time, then version, variant and
 * random bits.
 */
export function newRunId(startMs: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 6; i++) bytes[i] = Math.floor(startMs / 2 ** (8 * (5 - i))) & 0xff;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** The Unix milliseconds a run started at, read from its id; null for an id that carries none. */
export function runIdStartMs(id: string): number | null {
  const uuidV7 = id.match(/^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-/i);
  if (uuidV7 !== null) return parseInt(uuidV7[1]! + uuidV7[2]!, 16);
  const unixMs = id.match(/^(\d{13})(?!\d)/);
  return unixMs === null ? null : Number(unixMs[1]);
}

/** Sort order for run ids: the newest start first, then the id, so equal starts stay stable. */
export function newestRunFirst(a: { id: string }, b: { id: string }): number {
  return (runIdStartMs(b.id) ?? 0) - (runIdStartMs(a.id) ?? 0) || b.id.localeCompare(a.id);
}
