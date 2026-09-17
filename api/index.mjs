export const config = { maxDuration: 60 };

// Thin router: every request is GET /api?action=.. (Vercel) or any path
// handled by server.mjs (Railway/Node). Site logic lives in sites/*.mjs;
// this file only answers OPTIONS/CORS, ?action=status, and dispatches.
import { json } from "../lib/respond.mjs";
import { resolveAction, statusPayload } from "../sites/index.mjs";

export default async function handler(req, resp) {
  if (req.method === "OPTIONS") {
    resp.status(200);
    resp.setHeader("access-control-allow-origin", "*");
    resp.setHeader("access-control-allow-methods", "GET,OPTIONS");
    resp.setHeader("access-control-allow-headers", "*");
    resp.end();
    return;
  }
  const requestUrl = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const base = (() => {
    const proto = req.headers["x-forwarded-proto"] || "https";
    return `${proto}://${req.headers.host}`;
  })();
  try {
    if ((requestUrl.searchParams.get("action") || "") === "status") {
      return json(resp, statusPayload());
    }
    const resolved = resolveAction(requestUrl);
    if (resolved.error) {
      return json(resp, { message: resolved.error, supported: resolved.supported || [] }, 400);
    }
    try {
      return await resolved.fn({ req, resp, requestUrl, base });
    } catch (e) {
      // keep the historic error shape ({message, provider}) for old clients
      return json(resp, { message: e?.message || "upstream request failed", provider: resolved.site }, 502);
    }
  } catch (e) {
    return json(resp, { message: e?.message || "upstream request failed" }, 502);
  }
}
