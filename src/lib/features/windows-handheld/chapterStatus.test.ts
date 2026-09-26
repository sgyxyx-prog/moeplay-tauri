import { describe, expect, it } from "vitest";
import type { OfflineChapter } from "../../api/offline";
import type { ReadingPosition } from "../reading-history/repository";
import { chapterStatus } from "./chapterStatus";

describe("chapter status uses measured state", () => {
  const position = { pageIndex: 12 } as ReadingPosition;
  const offline = { readable: true, state: "complete", resourceState: "complete" } as OfflineChapter;
  it("does not infer chapter completion from the last visited comic page", () => {
    expect(chapterStatus(position, offline, true)).toBe("正在阅读 · 读到第 13 页 · 已离线");
  });
  it("distinguishes a completed transfer from a usable offline chapter", () => {
    expect(chapterStatus(undefined, { ...offline, readable: false })).toBe("离线不可用");
    expect(chapterStatus(undefined, { ...offline, state: "failed" })).toBe("下载失败");
  });
  it("marks a novel read only when persisted progress is at its end", () => {
    expect(chapterStatus({ ...position, progress: 0.42 })).toBe("已读 42%");
    expect(chapterStatus({ ...position, progress: 1 })).toBe("已读");
    expect(chapterStatus()).toBe("未读");
  });
});
