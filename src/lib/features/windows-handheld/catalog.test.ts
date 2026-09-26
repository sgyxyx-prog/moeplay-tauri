import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogStore, memberOf, moveMember, reorderMember, relationMember, type CollectionAlbum } from "./catalog.svelte";
import type { HandheldContentItem } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));

function album(): CollectionAlbum {
  return { id: "a", title: "作品志", description: "", cover: null, focalX: .5, focalY: .5,
    pinned: false, ignoredSubjects: [], updatedAt: 1, members: [
      { id: "game:1", contentId: "game:1", bangumiId: 10, kind: "game", title: "同名作品", cover: null, group: "", note: "", relation: "" },
      { id: "game:2", contentId: "game:2", bangumiId: 11, kind: "game", title: "同名作品", cover: null, group: "", note: "", relation: "" },
    ] };
}

beforeEach(async () => { localStorage.clear(); await catalogStore.refresh(); });

describe("personal albums", () => {
  it("keeps same-title works distinct and reorders by stable identity", () => {
    const input = album();
    const reordered = moveMember(input, "game:2", -1);
    expect(reordered.members.map(member => member.contentId)).toEqual(["game:2", "game:1"]);
    expect(input.members.map(member => member.contentId)).toEqual(["game:1", "game:2"]);
    expect(reorderMember(input, "game:2", "game:1").members.map(member => member.id)).toEqual(["game:2", "game:1"]);
    expect(reorderMember(input, "missing", "game:1")).toBe(input);
  });

  it("persists personal order, notes and confirmed binding across reload", async () => {
    const id = await catalogStore.create("原作与改编");
    const item = { id: "game:1", kind: "game", title: "同名作品", cover: undefined } as HandheldContentItem;
    await catalogStore.addMember(id, memberOf(item));
    await catalogStore.editMember(id, item.id, { note: "先玩游戏", group: "本篇" });
    await catalogStore.bind(item.id, 42);
    await catalogStore.refresh();
    const saved = catalogStore.albums.find(entry => entry.id === id)!;
    expect(saved.members).toMatchObject([{ contentId: "game:1", note: "先玩游戏", group: "本篇" }]);
    expect(catalogStore.getBinding(item.id)).toBe(42);
  });

  it("keeps Bangumi books as unbound books until a reader is chosen", () => {
    const member = relationMember({ subjectId: 90, title: "原作", subjectType: 1, relation: "改编", cover: null });
    expect(member).toMatchObject({ id: "bgm:90", kind: "book", contentId: null, bangumiId: 90 });
  });

  it("links a metadata-only book without losing its position or personal note", async () => {
    const id = await catalogStore.create("原作篇");
    await catalogStore.addMember(id, { ...relationMember({ subjectId: 90, title: "原作", subjectType: 1, relation: "改编", cover: null }), note: "先读原作" });
    const comic = { id: "comic:9", kind: "comic", title: "原作漫画", cover: undefined } as HandheldContentItem;
    await catalogStore.linkMember(id, "bgm:90", comic, 90);
    expect(catalogStore.albums.find(album => album.id === id)?.members).toMatchObject([{ id: comic.id, contentId: comic.id, bangumiId: 90, note: "先读原作" }]);
    expect(catalogStore.getBinding(comic.id)).toBe(90);
  });
});
