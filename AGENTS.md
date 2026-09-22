# jint

jint (jev lint) measures code with AI-classifier judgments (TypeSafe System One / jev) and turns raw readings into actionable output via user-configurable callbacks. Sensors in, signals out.

## Design

CLI -> SDK -> jev; config is a single small typed file. The CLI is a thin client of the SDK — every CLI capability must exist as an SDK option first; nothing is CLI-only.

## Testing

Unit tests are colocated next to the source they test (src/**/*.test.ts). The root tests/ directory holds only end-to-end/integration tests (process-spawning, e.g. the CLI binary) and shared helpers. Shared fixtures live in tests/fixtures/; single-consumer fixtures live next to their test. Run: bun test --parallel.
