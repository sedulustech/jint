import { allDocs, type Doc } from "../../lib/docs";
import type { APIRoute } from "astro";

export async function getStaticPaths() {
  return (await allDocs()).map((doc) => ({ params: { id: doc.id }, props: { doc } }));
}

export const GET: APIRoute = ({ props }) =>
  new Response((props as { doc: Doc }).doc.body ?? "", {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
