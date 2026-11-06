import { getCollection, type CollectionEntry } from "astro:content";
import sidebar from "../../sidebar.json";
import { groupBySidebar, type DocGroup } from "./sidebar";

export type Doc = CollectionEntry<"docs">;

export const labelOf = (doc: Doc): string => doc.data.sidebar.label ?? doc.data.title;

/** The docs under their sidebar groups, in the order web/sidebar.json lists them. */
export async function docGroups(): Promise<DocGroup<Doc>[]> {
  return groupBySidebar(await getCollection("docs"), sidebar);
}

export async function allDocs(): Promise<Doc[]> {
  return (await docGroups()).flatMap((group) => group.docs);
}
