import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function readJson(name) {
  return JSON.parse(await readFile(new URL(name, root), "utf8"));
}

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

test("asg-extension.json 是合法 V2 manifest", async () => {
  const manifest = await readJson("asg-extension.json");
  const pkg = await readJson("package.json");

  assert.equal(manifest.api_version, 2);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.id, "bilibili");
  assert.equal(manifest.entry, "index.mjs");
  assert.deepEqual(manifest.provides, ["fetch"]);

  const channels = manifest.fetch_channels ?? [];
  assert.ok(channels.length > 0, "fetch_channels 不能为空");
  for (const channel of channels) {
    assert.match(channel.id, /^bilibili:/);
    const index = channel.id.indexOf(":");
    assert.equal(channel.id.slice(0, index), "bilibili");
  }
});

test("V1 manifest 过渡保留且版本一致", async () => {
  const legacy = await readJson("asg-plugin.json");
  const pkg = await readJson("package.json");
  assert.equal(legacy.api_version, 1);
  assert.equal(legacy.id, "bilibili");
  assert.equal(legacy.version, pkg.version);
});
