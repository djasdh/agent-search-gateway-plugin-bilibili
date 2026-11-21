# agent-search-gateway-plugin-bilibili

[agent-search-gateway](https://github.com/djasdh/agent_search_gateway) 的 **Bilibili 取件插件**（asg extension）。

- 仓库 topic：**`asg-plugin`**（用户可通过 `asg extensions search bilibili` 找到）
- 插件 id：`bilibili`
- 能力：`fetch`（提供 `video` / `article` / `comments`）
- 插件版本：`0.2.1`（V2 manifest，同时保留 V1 manifest）

## 安装

```bash
asg extensions install djasdh/agent-search-gateway-plugin-bilibili@0.2.1
asg extensions list
```

0.3.9 及更新版本的安装器优先读取 `asg-extension.json`；0.3.8 及更早版本只认
`asg-plugin.json`，因此 Release 同时提供两个 manifest。

## 配置

### 0.3.9+（V2 宿主）

配置与密钥写在 `extensions.bilibili` 下，不再使用 `gateway.yaml` 顶层的 `bilibili`：

```bash
asg extensions config bilibili --set enabled=true
asg extensions config bilibili --set routes.detail='["http"]'
asg extensions config bilibili --set http.base_url=http://127.0.0.1:8010
asg extensions config bilibili --get
asg extensions secret bilibili --name token --stdin
```

对应文件：

```yaml
# gateway.yaml
extensions:
  bilibili:
    config:
      enabled: true
      routes:
        detail: [cli-kukemc, cli-ytdlp, http]
        comments: [cli-kukemc, http]
        audio: [cli-ytdlp, http]
        article: [http]
      http:
        base_url: http://127.0.0.1:8010
```

```yaml
# secrets.yaml
extensions:
  bilibili:
    token: env:BILI_HTTP_TOKEN
```

`extensions.bilibili.config` 由 `asg-extension.json` 的 `config_schema` 校验并补齐默认值；
`extensions.bilibili.token` 是 HTTP 后端的 Bearer token（可选）。

从旧版本升级时，0.3.9 的迁移脚本会把顶层 `bilibili` 搬到 `extensions.bilibili.config`，
把 `secrets.bilibili.http.token` 搬到 `extensions.bilibili.token`。插件运行期优先读
`pluginConfig` / `pluginSecrets`，并保留读取旧切片的回退（兼容 0.3.8 及更早宿主）。

### 0.3.8 及更早（V1 宿主）

仍按顶层 `bilibili` 配置（与旧版一致）：

```yaml
bilibili:
  enabled: true
  routes:
    detail: [cli-kukemc, cli-ytdlp, http]
    comments: [cli-kukemc, http]
    audio: [cli-ytdlp, http]
    article: [http]
```

## 能力

插件接管以下 URL（`match` 只做纯 URL 判断）：

| URL | 行为 |
| --- | --- |
| `https://www.bilibili.com/video/BV...`、`/video/av...` | 返回视频摘要 JSON（标题/简介/UP/分P/音频直链） |
| `https://www.bilibili.com/read/cv...` | 返回专栏摘要 JSON |
| 上述 URL 加 `#reply` / `#comment` | 抓取评论区（本地 sqlite 落库、断点续抓） |
| `.../#reply?q=关键词` | 在已抓取的评论里做 LIKE 检索 |
| `https://b23.tv/...` | 先展开短链，再按落点处理 |

后端在 manifest 中声明为三个通道，运行期通过 `routes` 配置路由：

- `bilibili:kukemc`（`cli-kukemc`）：`bili` CLI（详情、评论、登录态探测）
- `bilibili:ytdlp`（`cli-ytdlp`）：`yt-dlp`（详情、音频直链）
- `bilibili:article`（`http`）：自建 HTTP 后端（`http.base_url`；可选由插件托管拉起 `http.command`）

这三个后端依赖用户自己安装的 `bili` / `yt-dlp` 或外部 HTTP 服务，插件不声明
`backends`，也不提供 `setup` 安装流程。

## 错误码与诊断

插件保留网关的 5 个错误码；后端返回的上游 code（如 `BILI_ARTICLE_FAIL`）和 B 站
业务码（如 `-352`）会出现在错误文本里，便于判断重试策略。

| 错误码 | 典型原因 | 建议动作 |
| --- | --- | --- |
| `BILI_AUTH_REQUIRED` | 未登录、Cookie 过期、B 站 `-101` | 运行 `bili auth login`，或给 article 后端配置 `BILI_COOKIE` / `BILI_COOKIE_FILE` |
| `BILI_RISK_CONTROL` | B 站风控 `-352` / `-412`、限流 `-509` / `-799`、HTTP 412 / 429 | `-352` / `-412` 换出口或补登录态；`-509` / `-799` 退避后重试 |
| `BILI_UNAVAILABLE` | 后端未启动、不可达、返回未知错误 | 检查 `http.base_url` / 后端进程；错误文本会保留上游 code 与 message |
| `BILI_CAPABILITY_UNSUPPORTED` | 当前路由的后端不支持该动作 | 调整 `routes`，例如专栏只能走 `http` |
| `BILI_INVALID_URL` | 非视频 / 专栏地址 | 改用 `/video/BV...`、`/read/cv...` 或 b23.tv 短链 |

### 专栏后端的登录态 Cookie

`bilibili-article-server` 需要登录态时：

1. 运行 `bili auth login` 扫码登录；
2. 从 `~/.config/bili-cli/credential.json` 取 `SESSDATA` / `bili_jct` / `buvid3` /
   `buvid4` / `DedeUserID`；
3. 拼成一行 `SESSDATA=...; bili_jct=...; buvid3=...; buvid4=...; DedeUserID=...`，
   写入权限 `0600` 的文件；
4. 在网关进程环境里设置 `BILI_COOKIE_FILE=/path/to/cookie`（或直接 `BILI_COOKIE`），
   重启网关。

## 开发

```bash
npm ci
npm run build      # esbuild → 单文件 ESM index.mjs
npm test           # 构建 + vitest + node --test 冒烟测试
npm run typecheck  # tsc --noEmit
```

约束：

- 运行期只依赖 Node 内置模块（`node:*` 保留为 external），其余代码全部 bundle 进 `index.mjs`；
- 不 import `agent-search-gateway` 内部模块，也不依赖宿主 `node_modules`；
- `src/index.ts` 必须导出命名 `fetch`。

目录：

```text
asg-extension.json       # V2 manifest（0.3.9+）
asg-plugin.json          # V1 manifest（兼容 0.3.8 及更早）
esbuild.config.mjs       # 单文件打包
src/index.ts             # 导出 fetch
src/plugin.ts            # 插件实现与 V1/V2 配置解析
src/backends/            # CLI / HTTP 后端
src/sdk/                 # 复制自网关的契约类型与工具（runCliProcess 等）
test/                    # 单测 + 构建产物冒烟测试
.github/workflows/release.yml
```

## 发版

1. 同步修改 `asg-extension.json`、`asg-plugin.json` 与 `package.json` 的版本号（例如 `0.2.0`）。
2. 提交后打 tag 并推送：`git tag v0.2.0 && git push origin v0.2.0`。
3. GitHub Actions 会执行 `npm ci` / `npm run typecheck` / `npm test` / `npm run build`，
   生成 `SHA256SUMS` 并创建 Release（资产：`index.mjs`、`asg-extension.json`、
   `asg-plugin.json`、`SHA256SUMS`）。

安装器会校验 `SHA256SUMS`，因此 **不要手工上传或替换 Release 资产**。

## 发现

请确保 GitHub 仓库带有 topic **`asg-plugin`**，否则 `asg extensions search` 搜不到。

## License

MIT
