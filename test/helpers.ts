/** 测试用配置工厂：直接构造插件可见的设置切片，不依赖宿主 settings loader。 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchPluginContext } from "../src/sdk/fetch-plugin.js";
import type { BilibiliSettings, FetchPluginSettings } from "../src/sdk/settings.js";

export interface ContextOverrides {
  enabled?: boolean;
  httpBaseUrl?: string;
  routes?: BilibiliSettings["routes"];
  commentDb?: string;
  comments?: BilibiliSettings["comments"];
  fetch?: Partial<FetchPluginSettings["fetch"]>;
  /** 是否注入旧宿主的 `settings.bilibili`，默认 true。 */
  legacy?: boolean;
  /** V2 宿主注入的 `pluginConfig`。 */
  pluginConfig?: Readonly<Record<string, unknown>>;
  /** V2 宿主注入的 `pluginSecrets`。 */
  pluginSecrets?: Record<string, string>;
  /** 旧宿主的 `secrets.bilibili.http.token`。 */
  legacyToken?: string;
}

export function tmpDir(prefix = "asg-bilibili-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function makeSettings(dir: string, overrides: ContextOverrides = {}): BilibiliSettings {
  return {
    enabled: overrides.enabled ?? true,
    routes: overrides.routes ?? {
      detail: ["http"],
      comments: ["http"],
      audio: ["http"],
      article: ["http"],
    },
    cli_kukemc: { command: "bili", timeout_ms: 30000 },
    cli_ytdlp: { command: "yt-dlp", cookies_file: "", probe_command: "", timeout_ms: 30000 },
    http: {
      base_url: overrides.httpBaseUrl ?? "http://127.0.0.1:1",
      command: [],
      startup_timeout_ms: 10000,
      request_timeout_ms: 5000,
    },
    auth_probe_ttl_ms: 60000,
    comment_db: overrides.commentDb ?? join(dir, "bilibili.sqlite"),
    comments: overrides.comments ?? { page_size: 20, search_limit: 50, max_pages_per_fetch: 20 },
  };
}

export function makeContext(overrides: ContextOverrides = {}): FetchPluginContext {
  const dir = tmpDir();
  const settings: FetchPluginSettings = {
    fetch: {
      timeout_ms: 15000,
      max_bytes: 5 * 1024 * 1024,
      user_agent: "",
      ...overrides.fetch,
    },
  };
  if (overrides.legacy !== false) settings.bilibili = makeSettings(dir, overrides);

  const ctx: FetchPluginContext = {
    settings,
    secrets: { bilibili: { http: { token: overrides.legacyToken ?? "" } } },
    getSecret: () => undefined,
  };
  if (overrides.pluginConfig) ctx.pluginConfig = overrides.pluginConfig;
  if (overrides.pluginSecrets) ctx.pluginSecrets = overrides.pluginSecrets;
  return ctx;
}
