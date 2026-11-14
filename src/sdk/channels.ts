/** 抓取通道契约（与网关的 `src/fetch/channels/types.ts` 保持结构一致）。 */

import type { Logger } from "./logger.js";
import type { FetchPluginSecrets, FetchPluginSettings } from "./settings.js";

export type FetchChannelKind = "cli" | "http" | "session";

export interface ChannelProbe {
  ok: boolean;
  version?: string;
  authenticated?: boolean;
  message?: string;
}

export interface ChannelContext {
  settings: FetchPluginSettings;
  secrets: FetchPluginSecrets;
  getSecret(path: string): string | undefined;
  logger?: Logger;
}

export interface FetchChannel {
  /** 规范 ID：`${platform}:${channel}` */
  id: string;
  platform: string;
  channel: string;
  displayName: string;
  kind: FetchChannelKind;
  capabilities: readonly string[];
  aliases?: readonly string[];
  probe?(ctx: ChannelContext): Promise<ChannelProbe>;
  dispose?(): Promise<void>;
}

export interface CliRunOptions {
  timeoutMs: number;
  maxBuffer?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface CliResult {
  failed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  spawnError?: string;
  stdout: string;
  stderr: string;
}

export interface CliChannel extends FetchChannel {
  kind: "cli";
  readonly command: string;
  run(args: readonly string[], opts: CliRunOptions): Promise<CliResult>;
}

export interface HttpChannel extends FetchChannel {
  kind: "http" | "session";
  request(input: string | URL, init?: RequestInit): Promise<Response>;
}

/** Bilibili 可用的三个通道（静态元数据，与网关内置定义一致）。 */
export const BILIBILI_KUKEMC: FetchChannel = {
  id: "bilibili:kukemc",
  platform: "bilibili",
  channel: "kukemc",
  displayName: "kukemc",
  kind: "cli",
  capabilities: ["detail", "comments"],
  aliases: ["bili", "cli-kukemc"],
};

export const BILIBILI_YTDLP: FetchChannel = {
  id: "bilibili:ytdlp",
  platform: "bilibili",
  channel: "ytdlp",
  displayName: "yt-dlp",
  kind: "cli",
  capabilities: ["detail", "audio"],
  aliases: ["ytdlp", "cli-ytdlp"],
};

export const BILIBILI_ARTICLE: FetchChannel = {
  id: "bilibili:article",
  platform: "bilibili",
  channel: "article",
  displayName: "article",
  kind: "http",
  capabilities: ["detail", "comments", "audio", "article"],
  aliases: ["article", "bilibili:http"],
};
