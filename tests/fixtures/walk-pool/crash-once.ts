// A walk worker whose first walk of the run crashes it and whose later walks are real: the marker
// file records that the crash happened (tests/walk-pool-failure.test.ts).
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

declare const self: Worker;

await import("../../../packages/sdk/src/core/walk-worker.ts");
const marker = join(tmpdir(), "jint-walk-pool-crash-once");
const real = self.onmessage!;
self.onmessage = (event: MessageEvent) => {
  if (event.data.t === "walk" && !existsSync(marker)) {
    writeFileSync(marker, "crashed");
    process.exit(1);
  }
  return real.call(self, event);
};
