/** 插件可见的设置/密钥切片（与网关 `src/settings/*` 的 schema 结构一致）。
 *
 * 只声明插件真正读到的字段：宿主传进来的对象结构上满足这里即可。
 */

export interface FetchSettings {
  timeout_ms: number;
  max_bytes: number;
  user_agent: string;
}

export interface BilibiliRoutesSettings {
  detail: string[];
  comments: string[];
  audio: string[];
  article: string[];
}

export interface BilibiliKukemcSettings {
  command: string;
  timeout_ms: number;
}

export interface BilibiliYtdlpSettings {
  command: string;
  cookies_file: string;
  probe_command: string;
  timeout_ms: number;
}

export interface BilibiliHttpSettings {
  base_url: string;
  /** 非空时由插件负责拉起/回收。 */
  command: string[];
  startup_timeout_ms: number;
  request_timeout_ms: number;
}

export interface BilibiliCommentsSettings {
  page_size: number;
  search_limit: number;
  max_pages_per_fetch: number;
}

export interface BilibiliSettings {
  enabled: boolean;
  routes: BilibiliRoutesSettings;
  cli_kukemc: BilibiliKukemcSettings;
  cli_ytdlp: BilibiliYtdlpSettings;
  http: BilibiliHttpSettings;
  auth_probe_ttl_ms: number;
  comment_db: string;
  comments: BilibiliCommentsSettings;
}

export interface FetchPluginSettings {
  fetch: FetchSettings;
  /** V1 宿主注入的平台切片；V2（0.3.9+ / 0.4.x）宿主只给 `pluginConfig`。 */
  bilibili?: BilibiliSettings;
}

export interface FetchPluginSecrets {
  bilibili: { http: { token: string } };
}
