// hanime1 raw-HTML relay: fetch upstream (or jina.ai fallbacks) and return
// the original HTML with CORS headers. No catalog snapshot is created.
import { json, BROWSER_UA } from "../lib/respond.mjs";

const HM_HEADERS = {
  "user-agent": BROWSER_UA,
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US,en;q=0.8",
  "x-return-format": "html",
};

// Path allowlist: only directory/detail pages may be relayed.
const PATH_ALLOW = /^(\/|\/search|\/watch|\/browse)/;

function buildPath(requestUrl) {
  const rawUrl = requestUrl.toString();
  let path = requestUrl.searchParams.get("path") || "";
  const rawMatch = rawUrl.match(/[?&]path=([^&]*)/);
  if (rawMatch) {
    try { path = decodeURIComponent(rawMatch[1]); } catch { path = rawMatch[1]; }
    const extraKeys = ["query", "page", "genre", "sort", "v", "type"];
    for (const key of extraKeys) {
      const val = requestUrl.searchParams.get(key);
      if (val !== null && !path.includes(`${key}=`)) {
        path += (path.includes("?") ? "&" : "?") + `${key}=${encodeURIComponent(val)}`;
      }
    }
  }
  if (!path) path = "/";
  if (!path.startsWith("/")) path = `/${path}`;
  return path;
}

function upstreamTargets(path) {
  return [
    `https://hanime1.com${path}`,
    `https://r.jina.ai/http://hanime1.com${path}`,
    `https://r.jina.ai/https://hanime1.com${path}`,
    `https://hanime1.me${path}`,
    `https://r.jina.ai/http://hanime1.me${path}`,
  ];
}

function looksLikeHtml(html) {
  return /<html\b|video-item-container|skip-page-form|og:title/i.test(html);
}

export async function handle(ctx) {
  const { resp, requestUrl } = ctx;
  const path = buildPath(requestUrl);
  if (path.includes("..")) return json(resp, { message: "invalid path" }, 400);
  if (!PATH_ALLOW.test(path)) return json(resp, { message: "invalid path" }, 400);
  const attempts = [];
  for (const target of upstreamTargets(path)) {
    try {
      const r = await fetch(target, { headers: HM_HEADERS, signal: AbortSignal.timeout(20_000) });
      const html = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status} len=${html.length} preview=${html.slice(0, 120).replace(/\s+/g, " ").slice(0, 120)}`);
      if (!looksLikeHtml(html)) throw new Error(`invalid HTML len=${html.length} preview=${html.slice(0, 120).replace(/\s+/g, " ").slice(0, 120)}`);
      resp.setHeader("content-type", "text/html; charset=utf-8");
      resp.setHeader("access-control-allow-origin", "*");
      resp.setHeader("cache-control", "public, max-age=60");
      resp.status(200).end(html);
      return;
    } catch (e) {
      attempts.push(`${target} => ${(e?.message || String(e)).slice(0, 200)}`);
    }
  }
  return json(resp, { message: attempts.join(" | ") || "hanime1 relay unavailable", provider: "hm" }, 502);
}

export const config = {
  site: "hm",
  upstream: "https://hanime1.com",
  timeoutMs: 20000,
};
