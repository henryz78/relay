// Pornhub directory + media proxy.
import { json, res, decodeHtml, formatDuration, fetchOk, BROWSER_UA } from "../lib/respond.mjs";

const PH_ORIGIN = "https://www.pornhub.com";
const PH_HEADERS = {
  "user-agent": BROWSER_UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};
const PH_MEDIA_HEADERS = { ...PH_HEADERS, referer: "https://www.pornhub.com/view_video.php" };
const PH_MEDIA_HOST = /^(iv-h|hv-h|ei|ev-h|ev|pix-fl|pix-cdn77)\.phncdn\.com$/i;

function selfBase(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers.host}`;
}

function phMediaUrl(base, url) {
  return `${base}/api?action=media&url=${encodeURIComponent(url)}`;
}

function phCoverUrl(base, url) {
  if (!url) return "";
  return /^https:\/\/pix-cdn77\.phncdn\.com\//i.test(url) ? phMediaUrl(base, url) : url;
}

function phResolveRef(reference, base) {
  const resolved = new URL(reference, base);
  if (!resolved.search && base.search) resolved.search = base.search;
  return resolved.toString();
}

function phExtractMediaDefinitions(html) {
  const start = html.indexOf('"mediaDefinitions"');
  if (start === -1) return [];
  const bracketStart = html.indexOf("[", start);
  if (bracketStart === -1) return [];
  let depth = 0, inString = false, escaped = false;
  for (let i = bracketStart; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) return JSON.parse(html.slice(bracketStart, i + 1)); }
  }
  return [];
}

async function phPage(pathname) {
  const response = await fetch(new URL(pathname, PH_ORIGIN), { headers: PH_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`pornhub page ${response.status}`);
  return response.text();
}

function phCard(html, base) {
  const vkey = html.match(/data-video-vkey="([^"]+)"/)?.[1] || "";
  const title = decodeHtml(html.match(/<a[^>]+href="\/view_video\.php\?viewkey=[^"]*"[^>]*title="([^"]*)"/)?.[1] || vkey);
  const cover = phCoverUrl(base, html.match(/<img[^>]+src="(https:\/\/(?:[a-z0-9-]+\.)?phncdn\.com\/[^"]+)"/)?.[1] || "");
  const duration = html.match(/<var class="duration">([^<]+)<\/var>/)?.[1] || "";
  return {
    vod_id: vkey,
    vod_name: title,
    vod_pic: cover,
    vod_remarks: duration || "VIDEO",
    vod_area: "PORNHUB",
    type_name: "PORNHUB",
    media_kind: "video",
    needs_detail: true,
    provider: "ph",
  };
}

export async function handle(ctx) {
  const { resp, requestUrl, base } = ctx;
  const page = Math.max(1, Number(requestUrl.searchParams.get("pg") || 1));
  const keyword = requestUrl.searchParams.get("wd") || requestUrl.searchParams.get("q") || "";
  const preset = requestUrl.searchParams.get("preset") || requestUrl.searchParams.get("category") || "";
  let path;
  if (keyword) path = `/video/search?search=${encodeURIComponent(keyword)}&page=${page}`;
  else if (/^c:\d+$/.test(preset)) path = `/video?c=${preset.slice(2)}&page=${page}`;
  else if (/^slug:/.test(preset)) path = `/categories/${encodeURIComponent(preset.slice(5))}?page=${page}`;
  else path = `/video?page=${page}`;
  const html = await phPage(path);
  const items = (html.match(/<li[^>]*class="[^"]*pcVideoListItem[^"]*"[^>]*>[\s\S]*?<\/li>/g) || [])
    .map((li) => phCard(li, base))
    .filter((card) => card.vod_id);
  const pages = [...html.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1])).filter((n) => n > 0);
  return json(resp, { list: items, totalPages: Math.max(1, ...pages), provider: "ph" });
}

export async function handleDetail(ctx, id) {
  const { resp, base } = ctx;
  const html = await phPage(`/view_video.php?viewkey=${encodeURIComponent(id)}`);
  const title = decodeHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || html.match(/<title>([\s\S]*?)<\/title>/)?.[1] || id);
  const duration = Number(html.match(/"video_duration":(\d+)/)?.[1] || 0);
  const cover = phCoverUrl(base, html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || "");
  const hls = phExtractMediaDefinitions(html)
    .filter((d) => d.format === "hls" && d.videoUrl)
    .sort((a, b) => (Number(b.quality) || 0) - (Number(a.quality) || 0));
  const card = {
    vod_id: id,
    vod_name: title,
    vod_pic: cover,
    vod_remarks: duration ? formatDuration(duration) : "VIDEO",
    vod_area: "PORNHUB",
    type_name: "PORNHUB",
    media_kind: "video",
    provider: "ph",
  };
  if (hls.length) {
    card.vod_play_url = phMediaUrl(base, hls[0].videoUrl);
    card.streams = hls.map((d) => ({ label: `${d.quality}P`, url: phMediaUrl(base, d.videoUrl) }));
    card.play_notice = `公开 ${hls[0].quality}P HLS · 未加密`;
  } else {
    card.play_notice = "此条目无公开 HLS 播放地址";
  }
  return json(resp, card);
}

export async function handleMedia(ctx) {
  const { resp, requestUrl, base } = ctx;
  const raw = requestUrl.searchParams.get("url") || "";
  let target;
  try { target = new URL(raw); } catch { return json(resp, { message: "invalid media url" }, 400); }
  if (!PH_MEDIA_HOST.test(target.hostname)) return json(resp, { message: "invalid media host" }, 400);
  const isPlaylist = /\.m3u8$/i.test(target.pathname);
  const upstream = await fetch(target, { headers: PH_MEDIA_HEADERS, signal: AbortSignal.timeout(isPlaylist ? 15_000 : 30_000) });
  if (!upstream.ok) return json(resp, { message: `ph media ${upstream.status}` }, 502);
  if (isPlaylist) {
    const text = await upstream.text();
    const rewritten = text.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      return phMediaUrl(base, phResolveRef(trimmed, target));
    }).join("\n");
    res(resp, rewritten, "application/vnd.apple.mpegurl; charset=utf-8");
    return;
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  res(resp, buf, upstream.headers.get("content-type") || "application/octet-stream");
}

export const config = {
  site: "ph",
  upstream: PH_ORIGIN,
  timeoutMs: 20000,
};
