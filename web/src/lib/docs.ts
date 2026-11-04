import { getCollection, type CollectionEntry } from "astro:content";
import sidebar from "../../sidebar.json";
import { groupBySidebar, type DocGroup } from "./sidebar";

export type Doc = CollectionEntry<"docs">;

/** The sidebar entry: front matter `sidebar.label`, else the title. */
export const labelOf = (doc: Doc): string => doc.data.sidebar.label ?? doc.data.title;

/** The docs under their sidebar groups, in the order web/sidebar.json lists them. */
export async function docGroups(): Promise<DocGroup<Doc>[]> {
  return groupBySidebar(await getCollection("docs"), sidebar);
}

/** Every doc in reading order: the groups, flattened. */
export async function allDocs(): Promise<Doc[]> {
  return (await docGroups()).flatMap((group) => group.docs);
}
