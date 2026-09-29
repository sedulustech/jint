import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { apiPlugin } from "./src/api/vite-plugin.ts";

// The API route module is shared with server.ts (Bun.serve) via one mount surface:
// handleApi(Request, { root }) -> Response | null. The vite dev plugin and the
// prod server cannot drift because both are thin callers of src/api/handler.ts.
export default defineConfig({
  plugins: [tailwindcss(), apiPlugin()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
