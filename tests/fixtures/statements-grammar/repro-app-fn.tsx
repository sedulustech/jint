export function App({ runId }: { runId: string | null }) {
  const { theme, choose } = useTheme();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as RunSearch;
  // the detail pane is addressed by a rule-target pair, never by request identity;
  // its identity lives in the URL (search params) so a pane deep-links + survives reload
  const selectedPair =
    search.rule !== undefined
      ? { rule: search.rule, input: search.input ?? "", requestFile: search.file }
      : null;
  const [mode, setMode] = useState<Mode>("rule");
  // one-shot: a report-panel click expands + scrolls to the rule's group in rule mode
  const [focusRule, setFocusRule] = useState<string | null>(null);
  // null = follow the run's default (open when a report.json exists); toggle sets an override.
  const reportOverride = search.report === undefined ? null : search.report === 1;
  const runs = useQuery({ queryKey: ["runs"], queryFn: fetchRuns });
  const reportQ = useQuery({
    queryKey: ["report", runId],
    queryFn: () => fetchReport(runId ?? ""),
    enabled: runId !== null,
  });
  const reportData =
    reportQ.data && !("absent" in reportQ.data) ? (reportQ.data as Report) : undefined;
  // Only runs with an actual report.json can open the panel; the override never overrides absence.
  const reportOpen = reportData !== undefined && (reportOverride ?? true);
  // Shape guard: the endpoint must answer { runs }. A contract slip degrades to an empty list
  // + hint, never a white screen.
  const payload =
    runs.data && Array.isArray(runs.data.runs) ? runs.data : { runs: [] as RunSummary[] };
  const list = payload.runs;
  const selectedRun = list.find((r) => r.id === runId) ?? null;

  // a new run resets the user's overrides so the default-open rule applies fresh
  useEffect(() => {
    setMode("rule");
    setFocusRule(null);
  }, [runId]);

  const pick = (id: string) => {
    // picking (or clearing) a run resets the panel state with it
    navigate({
      to: id === "" ? "/" : "/runs/$runId",
      ...(id === "" ? {} : { params: { runId: id } }),
