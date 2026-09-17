// Shared response + text helpers. No site-specific logic here.
export function json(resp, data, status = 200) {
  resp.setHeader("content-type", "application/json; charset=utf-8");
  resp.setHeader("access-control-allow-origin", "*");
  resp.status(status).end(JSON.stringify(data));
}

export function res(resp, body, contentType, maxAge = 300) {
  resp.setHeader("content-type", contentType);
  resp.setHeader("access-control-allow-origin", "*");
  resp.setHeader("cache-control", `public, max-age=${maxAge}`);
  resp.status(200).end(body);
}

export function decodeHtml(value = "") {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

export function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  return [hours || null, String(minutes).padStart(hours ? 2 : 1, "0"), String(secs).padStart(2, "0")]
    .filter((part) => part !== null)
    .join(":");
}

export function selfBase(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers.host}`;
}

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// fetch with timeout; throws on HTTP error status.
export async function fetchOk(url, { headers = {}, timeoutMs = 20000 } = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const preview = (await response.text().catch(() => "")).slice(0, 120).replace(/\s+/g, " ");
    throw new Error(`HTTP ${response.status} len=${preview.length} preview=${preview.slice(0, 120)}`);
  }
  return response;
}
