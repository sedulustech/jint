// Bundled assets (import ... with { type }): the default export is the asset's content carrier —
// a file path for type "file" (node_modules path from source, embedded $bunfs path when
// compiled), the decoded text / parsed JSON for the data types.
declare module "*.wasm" {
  const path: string;
  export default path;
}
declare module "*.scm" {
  const source: string;
  export default source;
}
declare module "*.extensions.json" {
  const extensions: string[];
  export default extensions;
}
