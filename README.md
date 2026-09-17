# relay — 通用站点中转服务

一句话：给"浏览器够不着、Cloudflare 够不着"的上游当**代购**。
抓页面、调接口、搬视频，顺手补上浏览器要的 CORS 头。

## 接口一览

所有请求都是 `GET /api?...`。返回一律带 `access-control-allow-origin: *`。

| 调用 | 干什么 | 给谁用 |
|---|---|---|
| `?pg=1&wd=关键词&preset=分类` | Pornhub 列表 | ph |
| `?action=detail&id=xxx` | Pornhub 详情（含播放地址） | ph |
| `?action=media&url=xxx` | phncdn 媒体代理（仅白名单域名） | ph |
| `?action=ep&id=xxx` | Eporner 播放取流 | ep |
| `?action=hm&path=/search?...` | hanime1 原始 HTML 中转 | hm |
| `?action=status` | 健康检查：返回 `{ok, sites}` | 运维/自检 |

也支持显式写法 `?site=hm&action=relay&path=...`，效果一样。

## 一键部署（不需要改任何东西）

### Railway

1. Railway 里 New Project → Deploy from GitHub repo → 选这个仓库
2. 不用加配置文件：`package.json` 的 `start` 会跑 `server.mjs`，端口自动读 `PORT`
3. 部署完把域名（`xxx.up.railway.app`）记下来，回填到主项目的调用地址里

### Vercel

1. Vercel 里 Import Git Repository → 选这个仓库，直接 Deploy
2. 不用改配置：`api/index.mjs` 会被当成 Serverless Function
3. 部署完把域名记下来，回填到主项目的调用地址里

## 加一个新站点（三步，不碰别人的代码）

1. 复制 `sites/_template.mjs` 为 `sites/xxx.mjs`，填好上游地址、请求头、解析逻辑
2. 在 `sites/index.mjs` 的 `SITES` 表里加一行，把新 action 名字登记进去
3. 重新部署。完事。

老接口的查询参数是冻结的（主项目线上在用），不要改已有 action 的参数名；
要加参数只能新增可选参数。

## 本地跑

```bash
node server.mjs
# curl "http://localhost:3000/api?action=status"
```
