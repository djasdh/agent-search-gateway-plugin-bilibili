import { describe, expect, it } from "vitest";
import { fetch as plugin } from "../src/index.js";

describe("导出形状", () => {
  it("index.ts 导出 fetch 插件对象", () => {
    expect(plugin).toBeTypeOf("object");
    expect(plugin.id).toBe("bilibili");
    expect(plugin.platform).toBe("bilibili");
    expect(typeof plugin.match).toBe("function");
    expect(typeof plugin.fetch).toBe("function");
    expect(typeof plugin.enabled).toBe("function");
    expect(typeof plugin.available).toBe("function");
    expect(plugin.capabilities).toEqual(["video", "article", "comments"]);
  });
});

describe("match", () => {
  it("视频、专栏、短链命中；空间页不命中", () => {
    expect(plugin.match(new URL("https://www.bilibili.com/video/BV1xx411c7mD"))).toBe(true);
    expect(plugin.match(new URL("https://www.bilibili.com/video/BV1xx411c7mD?bili=video"))).toBe(true);
    expect(plugin.match(new URL("https://www.bilibili.com/read/cv123"))).toBe(true);
    expect(plugin.match(new URL("https://b23.tv/abc"))).toBe(true);
    expect(plugin.match(new URL("https://space.bilibili.com/1"))).toBe(false);
    expect(plugin.match(new URL("https://example.com/video/BV1xx411c7mD"))).toBe(false);
  });
});
