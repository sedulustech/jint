import { allDocs } from "../lib/docs";
import type { APIRoute } from "astro";

/** Every doc in one file, in reading order, each under a rule and its title. */
export const GET: APIRoute = async () => {
  const sections = (await allDocs()).map(
    (doc) => `# ${doc.data.title}\n\nSource: /docs/${doc.id}.md\n\n${(doc.body ?? "").trim()}\n`,
  );
  return new Response(sections.join("\n---\n\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};
