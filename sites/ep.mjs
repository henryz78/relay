// Eporner playback resolver: embed hash -> xhr -> direct streams.
import { json, BROWSER_UA } from "../lib/respond.mjs";

const EP_HEADERS = {
  "user-agent": BROWSER_UA,
  accept: "application/json,text/html,application/xhtml+xml,*/*;q=0.8",
};

const toBase36Hash = (h) => (h && h.length === 32) ? [0, 8, 16, 24].map((o) => parseInt(h.slice(o, o + 8), 16).toString(36)).join("") : h;

export async function handle(ctx) {
  const { resp, requestUrl } = ctx;
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

export const config = {
  site: "ep",
  upstream: "https://www.eporner.com",
  timeoutMs: 20000,
};
