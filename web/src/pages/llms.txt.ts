import { allDocs } from "../lib/docs";
import type { APIRoute } from "astro";

/** Llms.txt (llmstxt.org): what jint is, then every doc as a link to its markdown source. */
export const GET: APIRoute = async ({ site }) => {
  const url = (path: string) => new URL(path, site).href;
  const lines = (await allDocs()).map(
    ({ id, data }) => `- [${data.title}](${url(`/docs/${id}.md`)}): ${data.description}`,
  );
  const body = [
    "# jint",
    "",
    "> jint is an extensible semantic linter: it measures code with AI-classifier judgments and turns the readings into findings through rules you configure.",
    "",
    "## Docs",
    "",
    ...lines,
    "",
    "## Optional",
    "",
    `- [All docs in one file](${url("/llms-full.txt")}): every doc above, concatenated`,
    `- [Download](${url("/download/")}): beta binaries for Linux and macOS, with checksums`,
    "- [Source and releases](https://github.com/sedulustech/jint): the repository",
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
