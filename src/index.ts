/**
 * 插件入口：按 asg 的运行期约定导出命名 `fetch`。
 *
 * 实现放在 `plugin.ts`，避免本模块的 `fetch` 绑定遮蔽全局 `fetch`。
 */
import { bilibiliPlugin } from "./plugin.js";

export const fetch = bilibiliPlugin;

export { bilibiliPlugin };
export { buildArticleSummary, buildVideoSummary } from "./plugin.js";
export { createCommentStore } from "./store.js";
export { isBiliContentUrl, isBilibiliUrl, isShortLink, parseBiliRequest } from "./parse.js";
export type {
  BiliArticle, BiliArticleSummary, BiliComment, BiliDetail, BiliVideoSummary,
} from "./types.js";
