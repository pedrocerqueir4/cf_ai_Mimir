// Cloudflare Worker entry point
// This stub will be replaced by Plan 01-01 with the full Hono application
export default {
  async fetch(_request: Request, _env: unknown): Promise<Response> {
    return new Response("Mimir API", { status: 200 });
  },
};
