import { describe, expect, it } from "vitest";
import { createCommentStore } from "../src/store.js";
import type { BiliComment } from "../src/types.js";
import { tmpDir } from "./helpers.js";

describe("comment store", () => {
  it("落库、展开楼中楼、检索、断点", () => {
    const dir = tmpDir();
    const store = createCommentStore(`${dir}/c.sqlite`);
    const items: BiliComment[] = [
      {
        rpid: 1, mid: 10, uname: "a", content: "hello 世界", like: 7, ctime: 1,
        replies: [{ rpid: 2, root: 1, parent: 1, mid: 11, uname: "b", content: "reply", like: 1, ctime: 2 }],
      },
      { rpid: 3, mid: 12, uname: "c", content: "another 世界", like: 3, ctime: 3 },
    ];
    store.upsertPage({ bvid: "BV1xx411c7mD", page: 1, items, hasMore: true });
    expect(store.count("BV1xx411c7mD")).toBe(3);
    expect(store.syncState("BV1xx411c7mD")).toEqual({ nextPage: 2, finished: false });
    expect(store.search("BV1xx411c7mD", "世界")).toHaveLength(2);
    expect(store.search("BV1xx411c7mD", "reply", { mid: 11 })).toHaveLength(1);
    store.upsertPage({ bvid: "BV1xx411c7mD", page: 2, items: [], hasMore: false });
    expect(store.syncState("BV1xx411c7mD").finished).toBe(true);
    store.close();
  });
});
