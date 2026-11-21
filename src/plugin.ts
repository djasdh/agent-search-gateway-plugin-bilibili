/** Bilibili fetch 插件：按 URL 类型自动返回视频/专栏摘要，评论区锚点抓评论。 */

import { resolve } from "node:path";
import type { Logger } from "./sdk/logger.js";
import type { FetchPlugin, FetchPluginContext, FetchPluginResult } from "./sdk/fetch-plugin.js";
import {
  BILIBILI_ARTICLE,
  BILIBILI_KUKEMC,
  BILIBILI_YTDLP,
} from "./sdk/channels.js";
import {
  isBiliContentUrl, isBilibiliUrl, isShortLink, parseBiliRequest, resolveShortLink,
} from "./parse.js";
import type { ParsedBili } from "./parse.js";
import { createRouter } from "./router.js";
import type { BilibiliSettings } from "./sdk/settings.js";
import type { BiliRouter } from "./router.js";
import { createCommentStore } from "./store.js";
import { BiliError } from "./types.js";
import type {
  BiliArticle, BiliArticleSummary, BiliComment, BiliCommentStore, BiliDetail,
  BiliVideoSummary,
} from "./types.js";

const BUDGET_MS = 60_000;
const SAMPLE_SIZE = 20;
// 配置每次解析都会产出新对象，因此 router 按配置内容（含 token）缓存，保留后端实例与探测缓存。
const routers = new Map<string, BiliRouter>();
const stores = new Map<string, BiliCommentStore>();

/** 与旧 `bilibiliSchema` / `asg-extension.json` 的默认值保持一致。 */
const DEFAULT_BILIBILI_SETTINGS: BilibiliSettings = {
  enabled: false,
  routes: {
    detail: ["cli-kukemc", "cli-ytdlp", "http"],
    comments: ["cli-kukemc", "http"],
    audio: ["cli-ytdlp", "http"],
    article: ["http"],
  },
  cli_kukemc: { command: "bili", timeout_ms: 30000 },
  cli_ytdlp: { command: "yt-dlp", cookies_file: "", probe_command: "", timeout_ms: 30000 },
  http: {
    base_url: "http://127.0.0.1:8010",
    command: [],
    startup_timeout_ms: 10000,
    request_timeout_ms: 15000,
  },
  auth_probe_ttl_ms: 60000,
  comment_db: "data/bilibili.sqlite",
  comments: { page_size: 20, search_limit: 50, max_pages_per_fetch: 20 },
};

type ConfigContext = Pick<FetchPluginContext, "settings" | "pluginConfig">;
type SecretContext = Pick<FetchPluginContext, "secrets" | "pluginSecrets">;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 递归合并普通对象；数组整体替换，`undefined` 不覆盖已有值。 */
function mergeConfig(
  base: Record<string, unknown>,
  override: unknown,
): Record<string, unknown> {
  if (!isPlainObject(override)) return { ...base };
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const previous = out[key];
    out[key] = isPlainObject(previous) && isPlainObject(value)
      ? mergeConfig(previous, value)
      : value;
  }
  return out;
}

/**
 * 解析插件配置，同时兼容 V1 与 V2 宿主。
 *
 * - 旧宿主（0.3.8 及更早）注入 `settings.bilibili`；
 * - V2 宿主（0.3.9+ / 0.4.x）注入 `pluginConfig`，优先级更高；
 * - 两者都可能是局部对象（0.3.9 迁移出的 `extensions.bilibili.config`），
 *   因此按「默认值 → 旧切片 → pluginConfig」逐层深合并。
 */
export function resolveBilibiliConfig(ctx: ConfigContext): BilibiliSettings {
  const withLegacy = mergeConfig(
    DEFAULT_BILIBILI_SETTINGS as unknown as Record<string, unknown>,
    ctx.settings?.bilibili,
  );
  return mergeConfig(withLegacy, ctx.pluginConfig) as unknown as BilibiliSettings;
}

/** HTTP 后端 token：V2 的 `pluginSecrets.token` 优先于旧 `secrets.bilibili.http.token`。 */
export function resolveHttpToken(ctx: SecretContext): string {
  return ctx.pluginSecrets?.token ?? ctx.secrets?.bilibili?.http?.token ?? "";
}

function routerFor(bilibili: BilibiliSettings, httpToken: string, logger?: Logger): BiliRouter {
  const key = JSON.stringify([bilibili, httpToken]);
  let r = routers.get(key);
  if (!r) routers.set(key, (r = createRouter(bilibili, httpToken, logger)));
  return r;
}

function storeFor(bilibili: BilibiliSettings, logger?: Logger): BiliCommentStore {
  const key = resolve(bilibili.comment_db);
  let s = stores.get(key);
  if (!s) stores.set(key, (s = createCommentStore(bilibili.comment_db, logger)));
  return s;
}

const text = (body: string, contentType: string, finalUrl: string): FetchPluginResult => ({
  ok: true, status: 200, contentType, finalUrl, bytes: Buffer.from(body, "utf8"),
});

const fail = (code: string, message: string, finalUrl?: string): FetchPluginResult => ({
  ok: false, finalUrl, errorCode: code, errorMessage: message,
});

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const ERROR_TEXT_LIMIT = 500;

/** 错误文本里可能带 URL / Cookie 片段；统一压成单行并做最小脱敏。 */
function cleanErrorText(value: string): string {
  const text = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(SESSDATA|bili_jct|buvid3|buvid4|DedeUserID)=[^;\s]+/gi, "$1=***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***");
  return text.length > ERROR_TEXT_LIMIT ? `${text.slice(0, ERROR_TEXT_LIMIT)}…` : text;
}

const stringDetail = (err: BiliError, key: string): string | undefined => {
  const value = err.detail?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

/** 对 agent 暴露错误码含义 + 可诊断的上游原因，但不暴露插件名/尝试链。 */
function publicError(err: BiliError): string {
  if (err.code === "BILI_INVALID_URL") return cleanErrorText(err.message);

  const label = (() => {
    switch (err.code) {
      case "BILI_AUTH_REQUIRED":
        return "需要登录";
      case "BILI_RISK_CONTROL":
        return "B 站风控拦截";
      case "BILI_CAPABILITY_UNSUPPORTED":
        return "当前后端不支持该动作";
      default:
        return "Bilibili 后端不可用";
    }
  })();

  const upstreamCode = stringDetail(err, "upstreamCode");
  const upstreamMessage = stringDetail(err, "upstreamMessage");
  const reason = cleanErrorText(upstreamMessage ?? err.message);

  const notes: string[] = [];
  if (upstreamCode && upstreamCode !== err.code) notes.push(`上游 ${upstreamCode}`);
  if (err.hint && !reason.includes(err.hint)) notes.push(cleanErrorText(err.hint));
  const tail = notes.length > 0 ? `（${notes.join("；")}）` : "";

  // 能力不支持是属于插件内部的提示，不把后端实现细节带给 agent。
  if (err.code === "BILI_CAPABILITY_UNSUPPORTED") return cleanErrorText(`${label}${tail}`);

  const redundant = reason.length === 0
    || reason === label
    || (label === "Bilibili 后端不可用" && reason.startsWith("Bilibili 后端"));
  const body = redundant ? label : `${label}：${reason}`;
  return cleanErrorText(`${body}${tail}`);
}

export function buildVideoSummary(
  detail: BiliDetail,
  ref: { raw: string },
  audioUrl: string | null,
  audioError?: string,
): BiliVideoSummary {
  const summary: BiliVideoSummary = {
    kind: "video",
    title: detail.title,
    url: ref.raw,
    audio_url: audioUrl,
    cover_url: detail.cover,
    detail: {
      desc: detail.desc,
      owner: detail.owner,
      stat: detail.stat ?? {},
      current_page: detail.currentPage,
      page_count: detail.pageCount,
      pages: detail.pages,
    },
    comments_url: `${ref.raw}#reply`,
  };
  if (audioError) summary.audio_error = audioError;
  return summary;
}

export function buildArticleSummary(article: BiliArticle, ref: { raw: string }): BiliArticleSummary {
  const cover = typeof article.meta?.cover === "string" ? article.meta.cover : undefined;
  return {
    kind: "article",
    title: article.title?.trim() || `cv${article.cv}`,
    url: ref.raw,
    audio_url: null,
    cover_url: cover,
    detail: { content: article.content.trim() },
    comments_url: `${ref.raw}#comment`,
  };
}

const targetOf = (parsed: ParsedBili): string =>
  parsed.ref.bvid ?? (parsed.ref.cv ? `cv${parsed.ref.cv}` : parsed.ref.aid ? `av${parsed.ref.aid}` : "");

async function videoSummary(parsed: ParsedBili, bilibili: BilibiliSettings, httpToken: string, logger?: Logger) {
  const router = routerFor(bilibili, httpToken, logger);
  const [detailResult, audioResult] = await Promise.allSettled([
    router.detail(parsed.ref),
    router.audio(parsed.ref),
  ]);
  if (detailResult.status === "rejected") throw detailResult.reason;
  const audioUrl = audioResult.status === "fulfilled" ? audioResult.value.value.url : null;
  const audioError = audioResult.status === "rejected"
    ? (audioResult.reason instanceof BiliError ? publicError(audioResult.reason) : "音频直链获取失败")
    : undefined;
  if (audioResult.status === "rejected") logger?.debug(`bilibili audio failed: ${errorText(audioResult.reason)}`);
  const summary = buildVideoSummary(detailResult.value.value, parsed.ref, audioUrl, audioError);
  return text(JSON.stringify(summary, null, 2), "application/json", parsed.ref.raw);
}

async function articleSummary(parsed: ParsedBili, bilibili: BilibiliSettings, httpToken: string, logger?: Logger) {
  const { value } = await routerFor(bilibili, httpToken, logger).article(parsed.ref);
  return text(JSON.stringify(buildArticleSummary(value, parsed.ref), null, 2), "application/json", parsed.ref.raw);
}

async function comments(parsed: ParsedBili, bilibili: BilibiliSettings, httpToken: string, logger?: Logger) {
  const target = targetOf(parsed);
  const store = storeFor(bilibili, logger);

  if (parsed.action === "comments_search") {
    const items = store.search(target, parsed.query!, { limit: bilibili.comments.search_limit });
    const payload = {
      kind: "comments_search", target, q: parsed.query, count: items.length, items,
      ...(items.length === 0 ? { hint: "本地暂无评论，先 fetch 评论区链接抓取全量" } : {}),
    };
    return text(JSON.stringify(payload, null, 2), "application/json", parsed.ref.raw);
  }

  const router = routerFor(bilibili, httpToken, logger);
  const maxPages = bilibili.comments.max_pages_per_fetch;
  const deadline = Date.now() + BUDGET_MS;
  const state = store.syncState(target);
  let cursor = state.finished ? 1 : state.nextPage;
  let pages = 0;
  let fetched = 0;
  let total: number | undefined;
  let hasMore = true;
  let error: string | undefined;
  const sample: BiliComment[] = [];

  while (pages < maxPages && Date.now() < deadline) {
    try {
      const { value } = await router.comments(parsed.ref, { page: cursor, sort: parsed.sort });
      store.upsertPage({ bvid: target, page: cursor, items: value.items, hasMore: value.hasMore });
      pages++;
      fetched += value.items.length;
      if (sample.length < SAMPLE_SIZE) sample.push(...value.items.slice(0, SAMPLE_SIZE - sample.length));
      total = value.total ?? total;
      hasMore = value.hasMore;
      const next = value.nextPage ?? cursor + 1;
      if (!hasMore || next <= cursor) break;
      cursor = next;
    } catch (err) {
      if (pages === 0) throw err;
      error = err instanceof BiliError ? publicError(err) : "评论抓取中断";
      logger?.debug(`bilibili comments failed: ${errorText(err)}`);
      break;
    }
  }

  const payload = {
    kind: "comments",
    target,
    sort: parsed.sort,
    fetched,
    total: total ?? store.count(target),
    complete: !hasMore,
    ...(error ? { error } : {}),
    sample,
  };
  return text(JSON.stringify(payload, null, 2), "application/json", parsed.ref.raw);
}

async function handle(
  parsed: ParsedBili,
  bilibili: BilibiliSettings,
  httpToken: string,
  logger?: Logger,
) {
  switch (parsed.action) {
    case "video":
      return videoSummary(parsed, bilibili, httpToken, logger);
    case "article":
      return articleSummary(parsed, bilibili, httpToken, logger);
    case "comments":
    case "comments_search":
      return comments(parsed, bilibili, httpToken, logger);
  }
}

async function fetchBilibili(url: URL, ctx: FetchPluginContext): Promise<FetchPluginResult> {
  const { logger } = ctx;
  const bilibili = resolveBilibiliConfig(ctx);
  const httpToken = resolveHttpToken(ctx);
  if (!bilibili.enabled) return fail("BILI_UNAVAILABLE", "B 站抓取未启用（bilibili.enabled=false）。", url.toString());
  try {
    const target = isShortLink(url) ? await resolveShortLink(url) : new URL(url);
    for (const [k, v] of url.searchParams) if (!target.searchParams.has(k)) target.searchParams.set(k, v);
    if (url.hash && !target.hash) target.hash = url.hash;
    return await handle(parseBiliRequest(target), bilibili, httpToken, logger);
  } catch (err) {
    if (err instanceof BiliError) {
      logger?.debug(`bilibili failed: ${err.code} ${err.message}`);
      return fail(err.code, publicError(err), url.toString());
    }
    logger?.debug(`bilibili: 未预期异常 ${errorText(err)}`);
    return fail("BILI_UNAVAILABLE", "Bilibili 抓取失败", url.toString());
  }
}

export const bilibiliPlugin: FetchPlugin = {
  id: "bilibili",
  platform: "bilibili",
  name: "bilibili",
  displayName: "Bilibili",
  aliases: ["bili", "B站", "哔哩哔哩"],
  settingsKey: "bilibili",
  capabilities: ["video", "article", "comments"],
  channels: [BILIBILI_KUKEMC, BILIBILI_YTDLP, BILIBILI_ARTICLE],
  requires: [
    { type: "backend", anyOf: ["bilibili:kukemc", "bilibili:ytdlp", "bilibili:article"] },
    { type: "secret", path: "secrets.bilibili.http.token", optional: true },
  ],
  match: (url) => isBilibiliUrl(url) && (isBiliContentUrl(url) || isShortLink(url)),
  enabled: (ctx) => resolveBilibiliConfig(ctx).enabled,
  // 实际后端可用性由 router 按动作/路由处理；这里只确认配置可解析、插件可被调用。
  available: (ctx) => {
    resolveBilibiliConfig(ctx);
    return true;
  },
  fetch: fetchBilibili,
};
