// Bundled grammar wasm assets (import ... with { type: "file" }): the default export is the
// asset's file path at runtime — a node_modules path from source, an embedded path when compiled.
declare module "*.wasm" {
  const path: string;
  export default path;
}
