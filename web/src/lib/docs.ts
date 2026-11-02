import { getCollection, type CollectionEntry } from "astro:content";

export type Doc = CollectionEntry<"docs">;

/** The sidebar entry: front matter `sidebar.label`, else the title. */
export const labelOf = (doc: Doc): string => doc.data.sidebar.label ?? doc.data.title;

/** Every doc in reading order: `sidebar.order` first (ascending), then alphabetical by label. */
export async function allDocs(): Promise<Doc[]> {
  const order = (doc: Doc) => doc.data.sidebar.order ?? Number.POSITIVE_INFINITY;
  return (await getCollection("docs")).sort(
    (a, b) => Math.sign(order(a) - order(b)) || labelOf(a).localeCompare(labelOf(b), "en"),
  );
}
