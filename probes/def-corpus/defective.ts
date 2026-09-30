// Positive-control corpus: deliberately defective file. jint should FIRE here.
export const SWALLOW: Record<string, string> = {
  // fails_loudly: empty catch hides a real bug
  a: "1",
};

export function loadConfig(path: string): Record<string, unknown> {
  // fails_loudly FALSE: catch swallows a parse error and returns {} as if fine
  try {
    return JSON.parse(readFileSync(path));
  } catch {
    return {};
  }
}

// name_matches_behavior FALSE: name says validate, body mutates and writes
export function validateUser(user: User): boolean {
  user.name = user.name.trim().toLowerCase();
  db.write("users", user);
  return true;
}

// single_job FALSE: parses + fetches + formats in one function
export function getReport(id: string): string {
  const raw = JSON.parse(readFileSync("/tmp/" + id));
  const rows = fetch("http://api/x?id=" + id).then((r) => r.json());
  return "REPORT:\n" + JSON.stringify({ raw, rows }, null, 2);
}
