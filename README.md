# agent-search-gateway-plugin-bilibili

[agent-search-gateway](https://github.com/djasdh/agent_search_gateway) 的 **Bilibili 取件插件**（asg plugin）。

- 仓库 topic：**`asg-plugin`**（用户可通过 `asg extensions search bilibili` 找到）
- 插件 id：`bilibili`
- 能力：`fetch`（提供 `video` / `article` / `comments`）

## 安装

```bash
asg extensions install djasdh/agent-search-gateway-plugin-bilibili@0.1.0
asg extensions list
```

安装后按插件文档在 `gateway.yaml` 中启用：

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

后端通过 `bilibili.routes` 路由：

- `cli-kukemc`：`bili` CLI（详情、评论、登录态探测）
- `cli-ytdlp`：`yt-dlp`（详情、音频直链）
- `http`：自建 HTTP 后端（`bilibili.http.base_url`；可选由插件托管拉起 `bilibili.http.command`）

## 开发

```bash
npm install
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
asg-plugin.json          # 插件 manifest
esbuild.config.mjs       # 单文件打包
src/index.ts             # 导出 fetch
src/plugin.ts            # 插件实现
src/backends/            # CLI / HTTP 后端
src/sdk/                 # 复制自网关的契约类型与工具（runCliProcess 等）
test/                    # 单测 + 构建产物冒烟测试
.github/workflows/release.yml
```

## 发版

1. 同步修改 `asg-plugin.json` 与 `package.json` 的版本号（例如 `0.1.0`）。
2. 提交后打 tag 并推送：`git tag v0.1.0 && git push origin v0.1.0`。
3. GitHub Actions 会执行 `npm ci` / `npm run typecheck` / `npm test` / `npm run build`，
   生成 `SHA256SUMS` 并创建 Release（资产：`index.mjs`、`asg-plugin.json`、`SHA256SUMS`）。

安装器会校验 `SHA256SUMS`，因此 **不要手工上传或替换 Release 资产**。

## 发现

请确保 GitHub 仓库带有 topic **`asg-plugin`**，否则 `asg extensions search` 搜不到。

## License

MIT
