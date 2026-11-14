import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { fetch as plugin } from "../src/index.js";
import type { BilibiliSettings } from "../src/sdk/settings.js";
import { makeContext, makeSettings, tmpDir } from "./helpers.js";

describe("enabled=false", () => {
  it("明确报 BILI_UNAVAILABLE", async () => {
    const ctx = makeContext({ enabled: false });
    const r = await plugin.fetch(new URL("https://www.bilibili.com/video/BV1xx411c7mD"), ctx);
    expect(r).toMatchObject({ ok: false, errorCode: "BILI_UNAVAILABLE" });
    expect(ctx.settings.bilibili.enabled).toBe(false);
  });
});

describe("http 端到端", () => {
  it("摘要、评论、检索走通", async () => {
    const server = createServer((req, res) => {
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
    const dir = tmpDir();
    const bilibili = makeSettings(dir, {
      httpBaseUrl: `http://127.0.0.1:${port}`,
      routes: { detail: ["http"], comments: ["http"], audio: ["http"], article: ["http"] },
    });
    const ctx = makeContext({ httpBaseUrl: bilibili.http.base_url, commentDb: bilibili.comment_db });

    try {
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
    } finally {
      server.close();
    }
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
