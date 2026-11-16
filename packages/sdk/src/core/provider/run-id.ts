/**
 * A run's id: a UUIDv7 (RFC 9562), so it is unique across machines, and its lowercase hex sorts by
 * when the run started.
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

/** The Unix milliseconds a run started at, read from its UUIDv7 id; null for any other id. */
export function runIdStartMs(id: string): number | null {
  const uuidV7 = id.match(
    /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  return uuidV7 === null ? null : parseInt(uuidV7[1]! + uuidV7[2]!, 16);
}
