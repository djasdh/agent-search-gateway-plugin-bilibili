import { describe, expect, it } from "vitest";
import { isBiliContentUrl, parseBiliRequest } from "../src/parse.js";

describe("parse", () => {
  it("视频按路径识别，p 保留", () => {
    const p = parseBiliRequest(new URL("https://www.bilibili.com/video/BV1xx411c7mD?p=3&spm_id_from=x"));
    expect(p.action).toBe("video");
    expect(p.ref.bvid).toBe("BV1xx411c7mD");
    expect(p.ref.page).toBe(3);
    expect(p.ref.raw).toBe("https://www.bilibili.com/video/BV1xx411c7mD?p=3");
  });

  it("av 视频识别 aid", () => {
    const p = parseBiliRequest(new URL("https://www.bilibili.com/video/av123"));
    expect(p.action).toBe("video");
    expect(p.ref.aid).toBe(123);
    expect(p.ref.raw).toBe("https://www.bilibili.com/video/av123");
  });

  it("旧 bili 参数被忽略", () => {
    const p = parseBiliRequest(new URL("https://www.bilibili.com/video/BV1xx411c7mD?bili=audio"));
    expect(p.action).toBe("video");
  });

  it("专栏按路径识别", () => {
    const p = parseBiliRequest(new URL("https://www.bilibili.com/read/cv123456"));
    expect(p.action).toBe("article");
    expect(p.ref.cv).toBe("123456");
    expect(p.ref.raw).toBe("https://www.bilibili.com/read/cv123456");
  });

  it("#reply / #comment 进入评论", () => {
    expect(parseBiliRequest(new URL("https://www.bilibili.com/video/BV1xx411c7mD#reply")).action).toBe("comments");
    expect(parseBiliRequest(new URL("https://www.bilibili.com/read/cv123#comment")).action).toBe("comments");
  });

  it("hash 内的 q 与 sort", () => {
    const p = parseBiliRequest(new URL("https://www.bilibili.com/video/BV1xx411c7mD#reply?q=世界&sort=time"));
    expect(p.action).toBe("comments_search");
    expect(p.query).toBe("世界");
    expect(p.sort).toBe("time");
  });

  it("不支持的路径报 BILI_INVALID_URL", () => {
    expect(() => parseBiliRequest(new URL("https://www.bilibili.com/bangumi/play/ep1"))).toThrow();
  });

  it("路径判定只认视频和专栏", () => {
    expect(isBiliContentUrl(new URL("https://www.bilibili.com/video/av123"))).toBe(true);
    expect(isBiliContentUrl(new URL("https://www.bilibili.com/opus/123"))).toBe(false);
  });
});
