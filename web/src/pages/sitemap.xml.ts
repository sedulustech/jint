import { allDocs } from "../lib/docs";
import type { APIRoute } from "astro";

/** Every indexable page: home, download, and one per doc. The 404 and the /dl/ mirror stay out. */
export const GET: APIRoute = async ({ site }) => {
  const paths = ["/", "/download/", ...(await allDocs()).map((doc) => `/docs/${doc.id}/`)];
  const urls = paths.map((path) => `  <url><loc>${new URL(path, site).href}</loc></url>`);
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } });
};
