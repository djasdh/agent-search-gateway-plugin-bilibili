import test from "node:test";
import assert from "node:assert/strict";

/** 构建产物冒烟测试：确认 index.mjs 可加载且运行期契约的命名导出存在。 */
test("bundle 可加载并导出 fetch", async () => {
  const mod = await import("../index.mjs");
  assert.equal(typeof mod.fetch, "object");
  assert.equal(mod.fetch.id, "bilibili");
  assert.equal(typeof mod.fetch.match, "function");
  assert.equal(typeof mod.fetch.fetch, "function");
  assert.equal(mod.fetch.match(new URL("https://www.bilibili.com/video/BV1xx411c7mD")), true);
  assert.equal(mod.fetch.match(new URL("https://example.com/")), false);
});
