// Positive-control corpus #2: deliberately defective file for the probe5/6 rule family.
// jint should FIRE here on is_type_escape_defect, does_function_mutate_silently,
// is_comment_stale, is_error_message_actionable.

// is_type_escape_defect: any leaks into a signature where a generic is knowable.
export function total(items: any[]): number {
  return items.reduce((a: any, b: any) => a + b, 0);
}

// is_type_escape_defect: cast asserting a shape the code does not establish.
export function asNumber(input: unknown): number {
  return (input as number) + 1; // input may be a string; cast papers over it
}

// is_type_escape_defect: non-null assertion papering over an unchecked case.
export function firstToken(line: string): string {
  return line.split(" ").shift()!.trim();
}

// does_function_mutate_silently: mutates a caller-owned parameter's properties.
export function normalize(opts: { name: string; tags: string[] }): string[] {
  opts.name = opts.name.trim().toLowerCase();
  opts.tags.push("normalized");
  return opts.tags;
}

// does_function_mutate_silently: mutates module state without declaring it.
let lastCall: Date | null = null;
export function stampNow(): string {
  lastCall = new Date();
  return "stamped";
}

// is_comment_stale: comment contradicts the code.
export function fetchUser(id: string): User {
  // Returns ALL users for the admin dashboard listing.
  return db.get(id);
}

// is_error_message_actionable: generic boilerplate throws.
export function loadThing(path: string): string {
  try {
    return readFileSync(path);
  } catch {
    throw new Error("It failed");
  }
}

// is_error_message_actionable: misleading message.
export function saveThing(path: string, data: string): void {
  try {
    writeFileSync(path, data);
  } catch {
    throw new Error("Permission denied"); // the real cause is an invalid path
  }
}
