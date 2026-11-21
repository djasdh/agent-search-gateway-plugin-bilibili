import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { fetch as plugin, resolveBilibiliConfig, resolveHttpToken } from "../src/index.js";
import type { BilibiliSettings } from "../src/sdk/settings.js";
import type { FetchPluginContext } from "../src/sdk/fetch-plugin.js";
import { makeContext, makeSettings, tmpDir } from "./helpers.js";

interface Stub {
  baseUrl: string;
  /** 每次请求的 Authorization 头，用于验证 token 来源。 */
  auth: Array<string | undefined>;
  close(): Promise<void>;
}

async function startStub(): Promise<Stub> {
  const auth: Array<string | undefined> = [];
  const server = createServer((req, res) => {
    auth.push(req.headers.authorization);
    const url = new URL(req.url ?? "/", "http://stub");
    const send = (data: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (url.pathname === "/health") return send({ ok: true, loggedIn: true });
    if (url.pathname === "/detail") {
      return send({
        ok: true,
        data: {
          bvid: "BV1xx411c7mD", title: "标题", desc: "简介",
          owner: { mid: 1, name: "UP" }, stat: { view: 10 }, cover: "https://cover",
          pages: [{ page: 1, title: "P1" }, { page: 2, title: "P2" }],
        },
      });
    }
    if (url.pathname === "/playurl") return send({ ok: true, data: { url: "https://cdn.example/audio.m4s" } });
    if (url.pathname === "/comments") {
      return send({
        ok: true,
        data: {
          bvid: "BV1xx411c7mD", page: 1, total: 1, hasMore: false, nextPage: 2,
          items: [{ rpid: 1, mid: 1, uname: "u", content: "hello world", like: 1, ctime: 1 }],
        },
      });
    }
    if (url.pathname === "/article") {
      return send({ ok: true, data: { cv: "123", title: "专栏", content: "正文", meta: { cover: "https://cover" } } });
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    auth,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function expectHttpFlow(ctx: FetchPluginContext): Promise<void> {
  const video = await plugin.fetch(new URL("https://www.bilibili.com/video/BV1xx411c7mD?p=2"), ctx);
  expect(video.ok).toBe(true);
  const body = JSON.parse(video.bytes!.toString("utf8"));
  expect(body.audio_url).toBe("https://cdn.example/audio.m4s");
  expect(body.detail.current_page).toBe(2);
  expect(body.detail.page_count).toBe(2);
  expect(body.comments_url).toBe("https://www.bilibili.com/video/BV1xx411c7mD?p=2#reply");

  const comments = await plugin.fetch(new URL("https://www.bilibili.com/video/BV1xx411c7mD#reply"), ctx);
  const cbody = JSON.parse(comments.bytes!.toString("utf8"));
  expect(cbody).toMatchObject({ kind: "comments", fetched: 1, complete: true });
  expect(cbody.sample[0].content).toBe("hello world");

  const search = await plugin.fetch(new URL("https://www.bilibili.com/video/BV1xx411c7mD#reply?q=hello"), ctx);
  const sbody = JSON.parse(search.bytes!.toString("utf8"));
  expect(sbody).toMatchObject({ kind: "comments_search", q: "hello", count: 1 });
}

describe("enabled=false", () => {
  it("明确报 BILI_UNAVAILABLE", async () => {
    const ctx = makeContext({ enabled: false });
    const r = await plugin.fetch(new URL("https://www.bilibili.com/video/BV1xx411c7mD"), ctx);
    expect(r).toMatchObject({ ok: false, errorCode: "BILI_UNAVAILABLE" });
    expect(ctx.settings.bilibili?.enabled).toBe(false);
  });
});

describe("旧宿主（settings.bilibili）", () => {
  it("摘要、评论、检索走通", async () => {
    const stub = await startStub();
    const dir = tmpDir();
    const bilibili = makeSettings(dir, {
      httpBaseUrl: stub.baseUrl,
      routes: { detail: ["http"], comments: ["http"], audio: ["http"], article: ["http"] },
    });
    const ctx = makeContext({ httpBaseUrl: stub.baseUrl, commentDb: bilibili.comment_db });
    try {
      await expectHttpFlow(ctx);
      expect(plugin.enabled!(ctx)).toBe(true);
      expect(plugin.available!(ctx)).toBe(true);
    } finally {
      await stub.close();
    }
  });
});

describe("V2 宿主（pluginConfig / pluginSecrets）", () => {
  it("没有 settings.bilibili 时 enabled/available 正常且抓取走通", async () => {
    const stub = await startStub();
    const dir = tmpDir();
    const config = makeSettings(dir, {
      httpBaseUrl: stub.baseUrl,
      routes: { detail: ["http"], comments: ["http"], audio: ["http"], article: ["http"] },
    });
    const ctx = makeContext({
      legacy: false,
      pluginConfig: config as unknown as Record<string, unknown>,
      pluginSecrets: { token: "v2-token" },
    });
    expect(ctx.settings.bilibili).toBeUndefined();
    expect(plugin.enabled!(ctx)).toBe(true);
    expect(plugin.available!(ctx)).toBe(true);
    try {
      await expectHttpFlow(ctx);
      expect(stub.auth.length).toBeGreaterThan(0);
      expect(stub.auth.every((value) => value === "Bearer v2-token")).toBe(true);
    } finally {
      await stub.close();
    }
  });

  it("pluginSecrets.token 优先于旧 secrets.bilibili.http.token", () => {
    expect(resolveHttpToken({
      secrets: { bilibili: { http: { token: "legacy-token" } } },
      pluginSecrets: { token: "v2-token" },
    })).toBe("v2-token");
    expect(resolveHttpToken({
      secrets: { bilibili: { http: { token: "legacy-token" } } },
    })).toBe("legacy-token");
    expect(resolveHttpToken({
      secrets: { bilibili: { http: { token: "legacy-token" } } },
      pluginSecrets: {},
    })).toBe("legacy-token");
  });
});

describe("配置深合并", () => {
  it("局部 pluginConfig 与完整旧配置合并后嵌套字段仍在", () => {
    const dir = tmpDir();
    const ctx = makeContext({
      httpBaseUrl: "http://127.0.0.1:7777",
      routes: { detail: ["http"], comments: ["http"], audio: ["http"], article: ["http"] },
      commentDb: `${dir}/bilibili.sqlite`,
      pluginConfig: { enabled: true, http: { request_timeout_ms: 1234 } },
    });

    const merged: BilibiliSettings = resolveBilibiliConfig(ctx);
    expect(merged.enabled).toBe(true);
    // pluginConfig 覆盖的字段生效，未覆盖的嵌套字段来自旧配置/默认值。
    expect(merged.http.request_timeout_ms).toBe(1234);
    expect(merged.http.base_url).toBe("http://127.0.0.1:7777");
    expect(merged.http.startup_timeout_ms).toBe(10000);
    expect(merged.routes.detail).toEqual(["http"]);
    expect(merged.routes.comments).toEqual(["http"]);
    expect(merged.cli_ytdlp.command).toBe("yt-dlp");
    expect(merged.comments.max_pages_per_fetch).toBe(20);
  });

  it("pluginConfig 的嵌套对象覆盖不会丢掉兄弟键", () => {
    const dir = tmpDir();
    const ctx = makeContext({
      commentDb: `${dir}/bilibili.sqlite`,
      pluginConfig: { routes: { detail: ["cli-kukemc"] } },
    });

    const merged = resolveBilibiliConfig(ctx);
    expect(merged.routes.detail).toEqual(["cli-kukemc"]);
    expect(merged.routes.audio).toEqual(["http"]);
    expect(merged.routes.article).toEqual(["http"]);
  });

  it("完全没有配置时 enabled 为 false，fetch 不抛异常", async () => {
    const ctx = makeContext({ legacy: false });
    expect(plugin.enabled!(ctx)).toBe(false);
    expect(plugin.available!(ctx)).toBe(true);
    await expect(plugin.fetch(new URL("https://www.bilibili.com/video/BV1xx411c7mD"), ctx))
      .resolves.toMatchObject({ ok: false, errorCode: "BILI_UNAVAILABLE" });
  });
});

describe("settings 形状", () => {
  it("测试工厂产出完整 BilibiliSettings", () => {
    const dir = tmpDir();
    const s: BilibiliSettings = makeSettings(dir);
    expect(s.routes.audio).toEqual(["http"]);
    expect(s.comments.max_pages_per_fetch).toBe(20);
  });
});
