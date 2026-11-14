import { describe, expect, it } from "vitest";
import { buildArticleSummary, buildVideoSummary } from "../src/plugin.js";
import type { BiliArticle, BiliDetail } from "../src/types.js";

describe("summary", () => {
  const detail: BiliDetail = {
    bvid: "BV1xx411c7mD",
    title: "标题",
    desc: "简介",
    owner: { mid: 1, name: "UP" },
    stat: { view: 10, like: 2 },
    cover: "https://cover",
    pages: [{ page: 1, title: "P1" }, { page: 2, title: "P2" }],
    currentPage: 2,
    pageCount: 2,
  };
  const ref = { raw: "https://www.bilibili.com/video/BV1xx411c7mD?p=2" };

  it("视频摘要字段齐全", () => {
    const s = buildVideoSummary(detail, ref, "https://audio");
    expect(s).toMatchObject({
      kind: "video",
      audio_url: "https://audio",
      cover_url: "https://cover",
      comments_url: `${ref.raw}#reply`,
    });
    expect(s.detail.current_page).toBe(2);
    expect(s.detail.page_count).toBe(2);
    expect(s.detail.pages).toEqual([{ page: 1, title: "P1" }, { page: 2, title: "P2" }]);
    expect(s.audio_error).toBeUndefined();
  });

  it("音频失败降级为 null + audio_error", () => {
    const s = buildVideoSummary(detail, ref, null, "风控");
    expect(s.audio_url).toBeNull();
    expect(s.audio_error).toBe("风控");
  });

  it("专栏摘要 audio_url 为 null", () => {
    const article: BiliArticle = { cv: "123", title: "专栏", content: "正文", meta: { cover: "https://cover" } };
    const s = buildArticleSummary(article, { raw: "https://www.bilibili.com/read/cv123" });
    expect(s.audio_url).toBeNull();
    expect(s.cover_url).toBe("https://cover");
    expect(s.comments_url).toBe("https://www.bilibili.com/read/cv123#comment");
  });
});
