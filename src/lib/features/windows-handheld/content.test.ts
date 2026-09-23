import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildHandheldContent, createHandheldContentStore, type ContentDependencies } from "./content.svelte";
import type { Game } from "../../api";
import type { AnimeHistory } from "../anime-player/historyStore.svelte";
import type { NovelHistoryEntry } from "../novel/types";
import type { OfflineChapter, OfflineChapterContent } from "../../api/offline";
import type { GameLaunchResult, HandheldContentInput, RunningGame } from "./types";

vi.mock("../../api/core", () => ({ invokeCmd: vi.fn(), isMockEnabled: () => false }));
vi.mock("../../stores/games.svelte", () => ({ gameStore: {} }));
vi.mock("../../stores/anime.svelte", () => ({ animeStore: {} }));
vi.mock("../../stores/comic.svelte", () => ({ comicStore: {} }));
vi.mock("../../stores/ui.svelte", () => ({ uiStore: {} }));
vi.mock("../anime-home/collection.svelte", () => ({ collectionStore: {} }));
vi.mock("../novel/store.svelte", () => ({ novelStore: {} }));
vi.mock("../media-history/open", () => ({ openUnifiedMediaHistory: vi.fn() }));
vi.mock("../reading-history/repository", () => ({ readingRepository: { positions: [] }, bookKey: (p: unknown) => JSON.stringify(p) }));

function game(id = "one"): Game {
  return { id, name: id, exe_path: "C:/game.exe", created_at: "2026-01-01", updated_at: "2026-01-01",
    favorite: false, hidden: false, tags: [], aliases: [], tag_entries: [], screenshots: [],
    metadata: { genres: [], languages: [], voice_languages: [], stores: [] },
    play_tracker: { total_seconds: 120, sessions: [], completion_status: "playing", achievements_total: 0,
      achievements_unlocked: 0, finished: false, completion_count: 0, last_played: "2026-09-20" },
    save_data: { auto_backup: false, backup_interval_minutes: 30, max_backups: 10, backups: [], cloud_sync: false },
    play_time_seconds: 120,
  };
}
function anime(source = "source-a"): AnimeHistory {
  return { key: "title", name: "同名番剧", image: "", ruleName: source, sourceUrl: "https://example.test/series",
    lastRoad: 2, lastEpisode: 3, lastEpisodeName: "第4集", progressMs: 94000, updatedAt: "2026-09-21" };
}
function novel(): NovelHistoryEntry {
  return { key: "novel", book: { id: "book-1", source: "gutenberg", title: "测试小说", subjects: [], publicDomain: true, sourceUrl: "https://example.test/book" },
    chapterId: "chapter-2", chapterTitle: "第二章", progress: 0.45, updatedAt: 1750000000000 };
}
function input(overrides: Partial<HandheldContentInput> = {}): HandheldContentInput {
  return { games: [game()], animeHistory: [], animeCollection: [], comicHistory: [], comicFavorites: [], novelHistory: [], ...overrides };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function dependencies(data = input()): ContentDependencies {
  return { read: vi.fn(() => data), launch: vi.fn(async () => ({ session_id: "session", pid: 101 })), running: vi.fn(async () => []),
    resume: vi.fn(async () => true), details: vi.fn(async () => true), favorite: vi.fn(async () => {}), notify: vi.fn(),
    activateRunning: vi.fn(async () => ({ status: "activated" as const })) };
}

beforeEach(() => vi.clearAllMocks());

describe("handheld content adaptation", () => {
  it("retains all four kinds and exact resume positions without treating history as offline", () => {
    const animeRecord = anime();
    const comic = { id: "baozi:book", title: "漫画", thumb_url: "", author: "", last_order: 6, last_title: "第六话", ts: 1750000000000, pageIndex: 8 };
    const novelRecord = novel();
    const items = buildHandheldContent(input({ animeHistory: [animeRecord], comicHistory: [comic], novelHistory: [novelRecord] }));
    expect(new Set(items.map(item => item.kind))).toEqual(new Set(["game", "anime", "comic", "novel"]));
    expect(items.find(item => item.kind === "game")?.resumeTarget).toEqual({ kind: "game", gameId: "one" });
    expect(items.find(item => item.kind === "anime")?.resumeTarget).toEqual({ kind: "anime", history: animeRecord });
    expect(items.find(item => item.kind === "comic")?.progressLabel).toContain("第 9 页");
    expect(items.find(item => item.kind === "novel")?.progress).toBe(0.45);
    expect(items.filter(item => item.kind !== "game").every(item => !item.installed)).toBe(true);
  });

  it("does not merge same-title anime from different sources and deduplicates a book across chapters", () => {
    const first = novel();
    const next = { ...first, chapterId: "chapter-3", updatedAt: first.updatedAt + 1 };
    const items = buildHandheldContent(input({ animeHistory: [anime(), anime("source-b")], novelHistory: [first, next] }));
    expect(items.filter(item => item.kind === "anime")).toHaveLength(2);
    expect(items.filter(item => item.kind === "novel")).toHaveLength(1);
    expect(items.find(item => item.kind === "novel")?.resumeTarget).toEqual({ kind: "novel", history: next });
    expect(buildHandheldContent(input({ novelHistory: [first] })).find(item => item.kind === "novel")?.id).toBe(items.find(item => item.kind === "novel")?.id);
  });

  it("reads the source snapshot once for a 10,000-game library", () => {
    const deps = dependencies(input({ games: Array.from({ length: 10000 }, (_, i) => game(String(i))) }));
    const store = createHandheldContentStore(deps);
    expect(store.library).toHaveLength(10000);
    expect(deps.read).toHaveBeenCalledTimes(1);
  });
});

describe("game lifecycle", () => {
  it("refreshes history on native exit and disposes a listener that resolves after stop", async () => {
    const deps = dependencies();
    let ended!: () => void;
    const subscription = deferred<() => void>();
    const unlisten = vi.fn();
    deps.subscribeSessionEnded = vi.fn(callback => { ended = callback; return subscription.promise; });
    deps.refreshLibrary = vi.fn(async () => {});
    const store = createHandheldContentStore(deps);
    const stop = store.start();
    await store.activate(store.library[0]);
    ended();
    await vi.waitFor(() => expect(store.gameSession.status).toBe("returned"));
    expect(deps.refreshLibrary).toHaveBeenCalledTimes(2);
    stop();
    subscription.resolve(unlisten);
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
    ended();
    expect(deps.refreshLibrary).toHaveBeenCalledTimes(2);
  });

  it("coalesces duplicate pending launch and then returns to a tracked game instead of launching again", async () => {
    const deps = dependencies();
    const launch = deferred<GameLaunchResult>();
    deps.launch = vi.fn(() => launch.promise);
    const store = createHandheldContentStore(deps);
    const item = store.library[0];
    const first = store.activate(item);
    const second = store.activate(item);
    await Promise.resolve();
    expect(deps.launch).toHaveBeenCalledTimes(1);
    expect(store.gameSession.status).toBe("pending");
    launch.resolve({ session_id: "s", pid: 123 });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(store.library[0].primaryLabel).toBe("返回游戏");
    expect(await store.activate(item)).toBe(true);
    expect(deps.activateRunning).toHaveBeenCalledWith("one");
    expect(deps.launch).toHaveBeenCalledTimes(1);
    expect(deps.resume).not.toHaveBeenCalled();
  });

  it("keeps running status on foreground denial and observation failure", async () => {
    const deps = dependencies();
    deps.activateRunning = vi.fn(async () => ({ status: "denied" as const }));
    deps.running = vi.fn(async () => { throw new Error("native unavailable"); });
    const store = createHandheldContentStore(deps);
    await store.activate(store.library[0]);
    await store.activate(store.library[0]);
    await store.refreshRunningGames();
    expect(store.gameSession.status).toBe("running");
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("Alt+Tab"));
  });

  it("reports URI delegation honestly, offers explicit retry, and restores on application return", async () => {
    const deps = dependencies();
    deps.launch = vi.fn(async () => ({ session_id: "uri", pid: null }));
    const store = createHandheldContentStore(deps);
    await store.activate(store.library[0]);
    expect(store.gameSession.status).toBe("delegated");
    expect(store.runningGames).toEqual([]);
    expect(await store.activate(store.library[0])).toBe(false);
    await store.library[0].actions.find(action => action.id === "launch-again")!.run();
    expect(deps.launch).toHaveBeenCalledTimes(2);
    store.onApplicationBlur();
    await store.onApplicationReturn();
    expect(store.gameSession.status).toBe("returned");
    expect(store.gameSession.message).toContain("未知");
  });

  it("ignores stale observations across a launch and marks exit only after a successful fresh observation", async () => {
    const deps = dependencies();
    const previous = deferred<RunningGame[]>();
    deps.running = vi.fn().mockReturnValueOnce(previous.promise).mockResolvedValue([]);
    const store = createHandheldContentStore(deps);
    const observe = store.refreshRunningGames();
    await store.activate(store.library[0]);
    previous.resolve([]);
    await observe;
    expect(store.gameSession.status).toBe("running");
    await store.refreshRunningGames();
    expect(store.gameSession.status).toBe("returned");
  });

  it("exposes a retry after failure and routes media through their typed payload", async () => {
    const deps = dependencies(input({ animeHistory: [anime()], novelHistory: [novel()] }));
    deps.launch = vi.fn(async () => { throw new Error("missing executable"); });
    const store = createHandheldContentStore(deps);
    expect(await store.activate(store.library.find(item => item.kind === "game")!)).toBe(false);
    expect(store.library.find(item => item.kind === "game")?.primaryLabel).toBe("重试启动");
    for (const item of store.library.filter(item => item.kind !== "game")) await store.activate(item);
    expect(deps.resume).toHaveBeenCalledWith({ kind: "anime", history: anime() });
    expect(deps.resume).toHaveBeenCalledWith({ kind: "novel", history: novel() });
  });
});

describe("chapter offline verification", () => {
  it("requires a readable exact chapter and successful file read, and clears stale availability", async () => {
    const data = input({ novelHistory: [novel()] });
    const deps = dependencies(data);
    const chapter = { offlineChapterKey: "cache-key", contentType: "novel", sourceId: "gutenberg", contentId: "book-1", chapterId: "chapter-2", title: "第二章", state: "complete", readable: true } as OfflineChapter;
    deps.offlineList = vi.fn(async () => [chapter]);
    deps.offlineChapter = vi.fn(async () => ({ chapter, body: "正文", resourcePaths: [] } as OfflineChapterContent));
    const store = createHandheldContentStore(deps);
    await store.refreshOffline();
    expect(store.library.find(item => item.kind === "novel")?.offline?.chapterTitle).toBe("第二章");
    data.novelHistory = [{ ...novel(), chapterId: "chapter-3" }];
    expect(store.library.find(item => item.kind === "novel")?.installed).toBe(false);
    data.novelHistory = [novel()];
    deps.offlineChapter = vi.fn(async () => { throw new Error("file deleted"); });
    await store.refreshOffline();
    expect(store.library.find(item => item.kind === "novel")?.installed).toBe(false);
  });
});
