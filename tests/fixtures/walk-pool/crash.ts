// A walk worker that exits on its first walk (tests/walk-pool-failure.test.ts).
declare const self: Worker;
self.onmessage = (event: MessageEvent) => {
  if (event.data.t === "walk") process.exit(1);
};
self.postMessage({ t: "ready" });
