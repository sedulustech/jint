/**
 * The sidebar: web/sidebar.json lists groups, each a label and the doc ids under it, in reading
 * order. The list is the only authority on order and grouping, so a doc the list forgets, a listed
 * doc that does not exist, an id listed twice, and an empty group each fail the build - the order
 * is always a decision, never a default.
 */
export interface SidebarGroup {
  readonly label: string;
  readonly items: readonly string[];
}

export interface DocGroup<T> {
  readonly label: string;
  readonly docs: T[];
}

export function groupBySidebar<T extends { id: string }>(
  docs: readonly T[],
  groups: readonly SidebarGroup[],
): DocGroup<T>[] {
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const seen = new Set<string>();
  const grouped = groups.map((group) => {
    if (group.items.length === 0) throw new Error(`sidebar.json group "${group.label}" is empty`);
    const members = group.items.map((id) => {
      const doc = byId.get(id);
      if (doc === undefined) {
        throw new Error(`sidebar.json lists "${id}", but docs/ has no such doc`);
      }
      if (seen.has(id)) throw new Error(`sidebar.json lists "${id}" twice`);
      seen.add(id);
      return doc;
    });
    return { label: group.label, docs: members };
  });
  const missing = docs.filter((doc) => !seen.has(doc.id)).map((doc) => doc.id);
  if (missing.length > 0) {
    throw new Error(`sidebar.json does not list: ${missing.join(", ")} - add each to a group`);
  }
  return grouped;
}
