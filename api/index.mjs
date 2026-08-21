export const config = { maxDuration: 60 };

const PH_ORIGIN = "https://www.pornhub.com";
const PH_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};
const EP_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "application/json,text/html,application/xhtml+xml,*/*;q=0.8",
};
const PH_MEDIA_HEADERS = { ...PH_HEADERS, referer: "https://www.pornhub.com/view_video.php" };
const PH_MEDIA_HOST = /^(iv-h|hv-h|ei|ev-h|ev|pix-fl|pix-cdn77)\.phncdn\.com$/i;

function json(res, data, status = 200) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.status(status).end(JSON.stringify(data));
}

function decodeHtml(value = "") {
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

function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  return [hours || null, String(minutes).padStart(hours ? 2 : 1, "0"), String(secs).padStart(2, "0")]
    .filter((part) => part !== null)
    .join(":");
}

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

async function phList(resp, requestUrl, base) {
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

async function phDetail(resp, id, base) {
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

const toBase36Hash = (h) => (h && h.length === 32) ? [0, 8, 16, 24].map((o) => parseInt(h.slice(o, o + 8), 16).toString(36)).join("") : h;

async function epPlay(resp, requestUrl) {
  const id = requestUrl.searchParams.get("id") || "";
  if (!/^[a-z0-9_-]+$/i.test(id)) return json(resp, { message: "invalid ep id" }, 400);
  const ts = Date.now();
  let data = null;
  let note = "";
  const fullParams = (u) => {
    u.searchParams.set("domain", "www.eporner.com");
    u.searchParams.set("pixelRatio", "2");
    u.searchParams.set("playerWidth", "0");
    u.searchParams.set("playerHeight", "0");
    u.searchParams.set("fallback", "false");
    u.searchParams.set("embed", "false");
    u.searchParams.set("supportedFormats", "hls,dash,h265,vp9,av1,mp4");
    u.searchParams.set("_", String(ts));
    return u;
  };
  const richyParams = (u) => {
    u.searchParams.set("device", "generic");
    u.searchParams.set("domain", "www.eporner.com");
    u.searchParams.set("fallback", "false");
    return u;
  };
  const callXhr = async (hash, { cookies = "", richy = false, referer = "", noCookies = false } = {}) => {
    const u = new URL(`https://www.eporner.com/xhr/video/${encodeURIComponent(id)}`);
    if (hash) u.searchParams.set("hash", hash);
    (richy ? richyParams : fullParams)(u);
    const headers = { ...EP_HEADERS };
    if (noCookies) {
      headers.cookie = "EPRNS=deleted";
    } else if (cookies) {
      headers.cookie = cookies;
    }
    if (referer) headers.referer = referer;
    if (referer) {
      headers.origin = "https://www.eporner.com";
      headers["sec-fetch-site"] = "same-origin";
      headers["sec-fetch-mode"] = "cors";
      headers["sec-fetch-dest"] = "empty";
      headers["x-requested-with"] = "XMLHttpRequest";
    }
    const r = await fetch(u, { headers, signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    if (!text.trim().startsWith("{")) throw new Error("non-json xhr response");
    return JSON.parse(text);
  };
  const validData = (j) => j && j.available === true && j.sources && Object.keys(j.sources.mp4 || {}).some((k) => !/^auto$/.test(k) && j.sources.mp4[k]?.src);
  const variants = [];
  const tryVariant = async (label, fn) => {
    if (data) return;
    try {
      const j = await fn();
      if (validData(j)) { data = j; note = label + " ok"; }
      else { variants.push(`${label}: code ${j.code}`); }
    } catch (e) {
      variants.push(`${label}: ${(e?.message || String(e)).slice(0, 60)}`);
    }
  };
  await tryVariant("xhr-nohash", () => callXhr(""));
  let hash = "", cookie = "", watchUrl = "", watchDebug = null;
  const fetchWithHash = async (url) => {
    const headers = {
      ...EP_HEADERS,
      "accept-language": "en-US,en;q=0.9",
      "accept-encoding": "gzip, deflate, br",
      "upgrade-insecure-requests": "1",
      "sec-fetch-site": "none",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    };
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    const setC = r.headers.getSetCookie?.() || [];
    const c = setC.map((x) => x.split(";")[0]).join("; ");
    const html = await r.text();
    const m = html.match(/EP\.video\.player\.hash\s*=\s*['"]([a-zA-Z0-9_-]+)['"]/) || html.match(/hash\s*=\s*['"]([a-z0-9]+)['"]/i) || html.match(/xhr\/video\/[^"']*?[?&]hash=([a-zA-Z0-9_-]+)/i);
    return { html, cookie: c, status: r.status, hash: toBase36Hash(m ? m[1] : ""), hasHash: /EP\.video\.player\.hash/.test(html) };
  };
  try {
    const api = new URL("https://www.eporner.com/api/v2/video/id/");
    api.searchParams.set("id", id);
    api.searchParams.set("thumbsize", "medium");
    api.searchParams.set("format", "json");
    const ar = await fetch(api, { headers: EP_HEADERS, signal: AbortSignal.timeout(20_000) });
    const aj = await ar.json();
    watchUrl = aj?.url || `https://www.eporner.com/video-${id}/`;
    // Try embed first (no age gate), then watch page
    const embedUrl = `https://www.eporner.com/embed/${encodeURIComponent(id)}/`;
    const embed = await fetchWithHash(embedUrl);
    watchDebug = { embed: { status: embed.status, len: embed.html.length, hasHash: embed.hasHash, preview: embed.html.slice(0, 400).replace(/\s+/g, " ").slice(0, 400) } };
    if (embed.hash) {
      hash = embed.hash;
      cookie = embed.cookie;
      watchUrl = embedUrl; // use embed as referer for xhr
    } else {
      const watch = await fetchWithHash(watchUrl);
      watchDebug.watch = { status: watch.status, len: watch.html.length, hasHash: watch.hasHash, preview: watch.html.slice(0, 400).replace(/\s+/g, " ").slice(0, 400) };
      watchDebug.status = watch.status;
      watchDebug.len = watch.html.length;
      watchDebug.hasHash = watch.hasHash;
      watchDebug.hasBot = /Just a moment|challenge|cf-challenge/i.test(watch.html);
      watchDebug.preview = watch.html.slice(0, 400).replace(/\s+/g, " ").slice(0, 400);
      if (watch.hash) {
        hash = watch.hash;
        cookie = watch.cookie;
      } else {
        // age gate hit — keep debug for fallback diagnosis
        watchDebug.ageGate = /Age Verification/i.test(watch.html);
      }
    }
  } catch (e) {
    variants.push("watch: " + (e?.message || String(e)).slice(0, 60));
  }
  if (hash) {
    await tryVariant("xhr-cookie-full", () => callXhr(hash, { cookies: cookie, referer: watchUrl }));
    await tryVariant("xhr-nocookie-richy", () => callXhr(hash, { noCookies: true, richy: true, referer: watchUrl }));
    await tryVariant("xhr-cookie-richy", () => callXhr(hash, { cookies: cookie, richy: true, referer: watchUrl }));
    await tryVariant("xhr-cookie-richy-noreferer", () => callXhr(hash, { cookies: cookie, richy: true }));
  } else {
    variants.push("no hash on watch page");
  }
  if (!data) return json(resp, { message: "ep play unavailable", attempts: variants, watchDebug, watchUrl, provider: "eporner" }, 502);
  const streams = [];
  const hls = data.sources.hls?.auto?.src || "";
  if (hls) streams.push({ label: "HLS · 自动 · 推荐", url: hls, type: "application/x-mpegURL" });
  for (const [label, v] of Object.entries(data.sources.mp4 || {})) {
    if (v && v.src && !/\.na\.mp4/i.test(v.src)) streams.push({ label: `${label} MP4`, url: v.src, type: v.type || "video/mp4" });
  }
  return json(resp, {
    vod_id: id,
    videoFID: data.videoFID,
    streams,
    play_notice: "eporner 官方源直链 · 自建播放器",
    provider: "eporner",
  });
}

async function phMedia(resp, requestUrl, base) {
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

function res(resp, body, contentType) {
  resp.setHeader("content-type", contentType);
  resp.setHeader("access-control-allow-origin", "*");
  resp.setHeader("cache-control", "public, max-age=300");
  resp.status(200).end(body);
}

async function hmRelay(resp, requestUrl) {
  // Extract raw path param handling encoded & unencoded queries (spec: /search?query=AI&page=1)
  const rawUrl = requestUrl.toString();
  let path = requestUrl.searchParams.get("path") || "";
  const rawMatch = rawUrl.match(/[?&]path=([^&]*)/);
  if (rawMatch) {
    try { path = decodeURIComponent(rawMatch[1]); } catch { path = rawMatch[1]; }
    // If original path contained unencoded &page=, searchParams split it; reconstruct
    // Collect extra hanime1 query params that were split out (query, page, genre, sort, v, etc.)
    const extraKeys = ["query", "page", "genre", "sort", "v", "type"];
    for (const key of extraKeys) {
      const val = requestUrl.searchParams.get(key);
      // Only append if path doesn't already contain this key and val exists and path is search/watch
      if (val !== null && !path.includes(`${key}=`)) {
        path += (path.includes("?") ? "&" : "?") + `${key}=${encodeURIComponent(val)}`;
      }
    }
  }
  if (!path) path = "/";
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.includes("..")) return json(resp, { message: "invalid path" }, 400);
  // Allow only hanime1 directory/detail paths
  if (!/^(\/|\/search|\/watch|\/browse)/.test(path)) return json(resp, { message: "invalid path" }, 400);

  const HM_HEADERS = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    accept: "text/html,application/xhtml+xml",
    "accept-language": "en-US,en;q=0.8",
    "x-return-format": "html",
  };
  const targets = [
    `https://hanime1.com${path}`,
    `https://r.jina.ai/http://hanime1.com${path}`,
    `https://r.jina.ai/https://hanime1.com${path}`,
  ];
  let lastError;
  for (const target of targets) {
    try {
      const r = await fetch(target, { headers: HM_HEADERS, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`hanime1 ${r.status}`);
      const html = await r.text();
      if (!/<html\b|video-item-container|skip-page-form|og:title/i.test(html)) throw new Error("invalid HTML");
      resp.setHeader("content-type", "text/html; charset=utf-8");
      resp.setHeader("access-control-allow-origin", "*");
      resp.setHeader("cache-control", "public, max-age=60");
      resp.status(200).end(html);
      return;
    } catch (e) {
      lastError = e;
    }
  }
  return json(resp, { message: lastError?.message || "hanime1 relay unavailable", provider: "hm" }, 502);
}

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
  const base = selfBase(req);
  try {
    const action = requestUrl.searchParams.get("action") || "list";
    if (action === "hm") return await hmRelay(resp, requestUrl);
    if (action === "ep") return await epPlay(resp, requestUrl);
    if (action === "media") return await phMedia(resp, requestUrl, base);
    if (action === "detail") return await phDetail(resp, requestUrl.searchParams.get("id"), base);
    return await phList(resp, requestUrl, base);
  } catch (e) {
    return json(resp, { message: e?.message || "upstream request failed", provider: "ph" }, 502);
  }
}
