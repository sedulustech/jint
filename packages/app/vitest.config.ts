import { resolve } from "node:path";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { apiPlugin } from "./src/api/vite-plugin.ts";

// Component tests run in a real browser via @vitest/browser (playwright provider). The SAME
// shared API route module is mounted into vitest's vite server through apiPlugin, so tests
// fetch /api/* from the real handler over the real local dump dir.
process.env.JINT_REQUESTS_DIR = resolve(import.meta.dirname, "tests/fixtures");

export default defineConfig({
  plugins: [tailwindcss(), apiPlugin()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  optimizeDeps: {
    include: ["react", "react-dom", "@testing-library/react", "@tanstack/react-query"],
  },
  test: {
    include: ["src/**/*.test-browser.tsx"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
