export const EXIT = {
  ok: 0,
  findings: 1,
  unusable: 2,
  incomplete: 3,
  interrupted: 130,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export const EXIT_CODES: readonly { readonly code: ExitCode; readonly meaning: string }[] = [
  { code: EXIT.ok, meaning: "Ran. No error findings; warnings alone exit 0." },
  {
    code: EXIT.findings,
    meaning: "Ran. Error findings. The lint verdict, and the only code a hook should act on.",
  },
  {
    code: EXIT.unusable,
    meaning: "Nothing useful ran: bad command, bad config, or nothing matched the rules' scope.",
  },
  {
    code: EXIT.incomplete,
    meaning:
      "Ran but could not finish: a provider, network or auth failure. Results are partial; a retry may help.",
  },
  { code: EXIT.interrupted, meaning: "Interrupted (SIGINT)." },
];
