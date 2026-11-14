// A walk worker that spins forever inside WebAssembly on its first walk (tests/walk-pool-failure.test.ts).
// A parser stuck in a wasm loop is the failure the pool is built for: Bun's terminate() cannot stop it.
declare const self: Worker;

// (module (func (export "spin") (loop br 0)))
const SPIN = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 8, 1, 4, 115, 112, 105, 110, 0, 0,
  10, 9, 1, 7, 0, 3, 64, 12, 0, 11, 11,
]);

self.onmessage = (event: MessageEvent) => {
  if (event.data.t === "walk") {
    (new WebAssembly.Instance(new WebAssembly.Module(SPIN)).exports.spin as () => void)();
  }
};
self.postMessage({ t: "ready" });
