import { INSTALL_PROMPT } from "../lib/install-prompt";
import type { APIRoute } from "astro";

export const GET: APIRoute = () =>
  new Response(INSTALL_PROMPT + "\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
