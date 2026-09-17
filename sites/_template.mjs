// Template for a new site. Copy this file to `<site>.mjs`, fill in the three
// marked sections, register it in index.mjs, redeploy. No other file changes.
import { json, BROWSER_UA } from "../lib/respond.mjs";

// 1) Upstream + headers this site needs.
const UPSTREAM = "https://example.com";
const HEADERS = {
  "user-agent": BROWSER_UA,
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  // referer: "https://example.com/",
};

export async function handle(ctx) {
  // 2) Read params from ctx.requestUrl.searchParams, fetch upstream,
  //    parse what you need, and reply with json(resp, {...}).
  const { resp, requestUrl, base } = ctx;
  const page = Math.max(1, Number(requestUrl.searchParams.get("pg") || 1));
  // 3) Always include provider + a stable vod_* shape; see sites/ph.mjs.
  return json(resp, { list: [], page, provider: "example" });
}

export const config = {
  site: "example",
  upstream: UPSTREAM,
  timeoutMs: 20000,
};
