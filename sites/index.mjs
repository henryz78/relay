// Site registry: the "ID card" table. Adding a new site = add one line here
// plus one file under sites/. Nothing else needs to change.
import { handle as phList, handleDetail as phDetail, handleMedia as phMedia } from "./ph.mjs";
import { handle as epPlay } from "./ep.mjs";
import { handle as hmRelay } from "./hm.mjs";

export const SITES = {
  // Pornhub directory
  ph: {
    module: "ph.mjs",
    describe: "Pornhub 列表/详情/媒体代理",
    actions: {
      list: phList,
      detail: (ctx) => phDetail(ctx, ctx.requestUrl.searchParams.get("id")),
      media: phMedia,
    },
    defaultAction: "list",
  },
  // Eporner playback resolver
  ep: {
    module: "ep.mjs",
    describe: "Eporner 播放取流（embed hash → xhr → 直链）",
    actions: {
      play: epPlay,
    },
    defaultAction: "play",
  },
  // hanime1 raw-HTML relay
  hm: {
    module: "hm.mjs",
    describe: "hanime1 原始 HTML 中转（供上游被墙时的目录抓取）",
    actions: {
      relay: hmRelay,
    },
    defaultAction: "relay",
  },
};

// Historic query interface (frozen for backward compat):
//   ?pg=..&wd=..            -> ph.list      (no action param)
//   ?action=detail&id=..    -> ph.detail
//   ?action=media&url=..    -> ph.media
//   ?action=ep&id=..        -> ep.play
//   ?action=hm&path=..      -> hm.relay
// New clients may ALSO pass explicit ?site=xx&action=yy; the table below
// keeps both spellings working.
const LEGACY_ACTION_MAP = {
  "": ["ph", "list"],
  list: ["ph", "list"],
  detail: ["ph", "detail"],
  media: ["ph", "media"],
  ep: ["ep", "play"],
  play: ["ep", "play"],
  hm: ["hm", "relay"],
  relay: ["hm", "relay"],
};

export function resolveAction(requestUrl) {
  const explicitSite = requestUrl.searchParams.get("site") || "";
  if (explicitSite && SITES[explicitSite]) {
    const site = SITES[explicitSite];
    const name = requestUrl.searchParams.get("action") || site.defaultAction;
    const fn = site.actions[name];
    if (fn) return { site: explicitSite, action: name, fn };
    return { error: `unknown action "${name}" for site "${explicitSite}"` };
  }
  const legacy = LEGACY_ACTION_MAP[requestUrl.searchParams.get("action") || ""];
  if (!legacy) {
    return {
      error: `unknown action "${requestUrl.searchParams.get("action")}"`,
      supported: Object.keys(LEGACY_ACTION_MAP).filter(Boolean),
    };
  }
  const [siteKey, actionName] = legacy;
  return { site: siteKey, action: actionName, fn: SITES[siteKey].actions[actionName] };
}

export function statusPayload() {
  const sites = {};
  for (const [key, site] of Object.entries(SITES)) {
    sites[key] = { describe: site.describe, actions: Object.keys(site.actions) };
  }
  return { ok: true, service: "relay", sites };
}
