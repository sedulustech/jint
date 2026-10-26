# jint test suite

End-to-end/integration tests (process-spawning the CLI). Unit tests live next to their source
under `src/`; shared fixtures live in `tests/fixtures/`. Run: `bun test --parallel`.

## Testing doctrine

**Mocked tests assert CONTRACT and run everywhere.** A contract is what the CLI owes its callers:
exit codes, stderr messages, and the stdout document shape — plus the wire shape
on the provider boundary (state content, compiled instructions and criteria). Every mocked test runs
against `tests/helpers/mock-provider.ts` (`startMockProvider()`), which serves canned vendor-shaped answers
on port 0; point a spawned CLI at it with `TYPESAFE_BASE_URL`. Assertions go through
`tests/helpers/contract.ts` (`expectContract(r, { exit, stderr, stdout })`), which names all three
surfaces on failure. The mocked suite must be fully green with **no** `TYPESAFE_API_KEY`.

**Live tests assert MODEL BEHAVIOR and run opt-in.** Calibration, real reading distributions, real
model failure modes. These verify what a mock cannot: the model. They run only when BOTH
`RUN_LIVE_TESTS=1` and `TYPESAFE_API_KEY` are set. Requesting live tests without a key must fail
loud, never skip silently — a silent `if (!key) return;` once hid a regression.

## Rules

- **No env-gated test may silently return early.** Either the gate is an explicit opt-in
  (`RUN_LIVE_TESTS=1`) whose absence means the test does not exist for this run, or a violated
  gate throws. If a structural claim is gated behind a key, convert it to a mocked twin — the
  claim was contract, not model behavior.
- **Undocumented CLI input forms need a spec or a rejection error.** If the CLI accepts an input
  form, a test pins it (or the help text documents it); if it does not accept it, it must exit 2
  with guidance — never guess.
