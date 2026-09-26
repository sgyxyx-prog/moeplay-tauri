import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { createDiscoverySearch, discoverySearch, type DiscoveryOutcome, type DiscoverySearchers } from "./search.svelte";
import Discovery from "./Discovery.svelte";
import type { ContentKind } from "./types";

const stores = vi.hoisted(() => ({
  anime: { search: vi.fn(), openDetail: vi.fn(), searchResults: [] as [string, { name: string; url: string }[]][], searchSourceStatus: {} as Record<string, { status: string; count: number; error?: string }>, error: null as string | null },
  comic: { searchOrdinary: vi.fn(), openOrdinaryComic: vi.fn(), ordinarySourceSections: [] as { source: string; label: string; docs: { id: string; title: string }[]; error: string | null }[] },
  novel: { search: vi.fn(), openBook: vi.fn(), books: [], error: "" },
  games: { allGames: [] as { id: string; name: string }[], selectGame: vi.fn() },
  navigateTo: vi.fn(),
}));
vi.mock("../../stores/anime.svelte", () => ({ animeStore: stores.anime }));
vi.mock("../../stores/comic.svelte", () => ({ comicStore: stores.comic }));
vi.mock("../../stores/games.svelte", () => ({ gameStore: stores.games }));
vi.mock("../novel/store.svelte", () => ({ novelStore: stores.novel }));
vi.mock("../../stores/router.svelte", () => ({ navigateTo: stores.navigateTo, routerStore: { topOverlay: null } }));

function outcome(kind: ContentKind, title = kind): DiscoveryOutcome {
  return { results: [{ id: `${kind}:${title}`, kind, title, source: "source", open: vi.fn() }], errors: [] };
}
function providers(): DiscoverySearchers {
  return { game: vi.fn(() => outcome("game")), anime: vi.fn(() => outcome("anime")), comic: vi.fn(() => outcome("comic")), novel: vi.fn(() => outcome("novel")) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  stores.anime.searchResults = [];
  stores.anime.searchSourceStatus = {};
  stores.anime.error = null;
  stores.comic.ordinarySourceSections = [];
  stores.novel.books = [];
  stores.novel.error = "";
  stores.games.allGames = [];
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("discovery search session", () => {
  it("joins a pending request and retains results, source errors, selection and scroll on return", async () => {
    const sources = providers();
    const response = deferred<DiscoveryOutcome>();
    sources.anime = vi.fn(() => response.promise);
    const session = createDiscoverySearch(sources);
    const first = session.ensure(" 星之梦 ", "anime", 1);
    expect(session.pending).toEqual(["anime"]);
    expect(session.ensure("星之梦", "anime", 1)).toBe(first);
    response.resolve({ ...outcome("anime"), errors: [{ kind: "anime", source: "unknown-rule", message: "source missing" }] });
    await first;
    session.select("anime:anime");
    session.scroll(840);
    const saved = session.results;
    await session.ensure("星之梦", "anime", 1);
    expect(sources.anime).toHaveBeenCalledOnce();
    expect(session.results).toBe(saved);
    expect(session.errors[0].source).toBe("unknown-rule");
    expect(session.focusId).toBe("anime:anime");
    expect(session.scrollOffset).toBe(840);
    expect(session.pending).toEqual([]);
  });

  it("searches a changed type with the current keyword without requiring a new request number", async () => {
    const sources = providers();
    const session = createDiscoverySearch(sources);
    await session.ensure("星之梦", "anime", 1);
    const previous = session.requestKey;
    await session.ensure("星之梦", "comic", 1);
    expect(sources.comic).toHaveBeenCalledExactlyOnceWith("星之梦");
    expect(sources.anime).toHaveBeenCalledOnce();
    expect(session.results.map(item => item.kind)).toEqual(["comic"]);
    expect(session.requestKey).not.toBe(previous);
    await session.ensure("星之梦", "comic", 2);
    expect(sources.comic).toHaveBeenCalledTimes(2);
  });

  it("keeps independent successful categories when a source rejects and never retries it", async () => {
    const sources = providers();
    const novel = deferred<DiscoveryOutcome>();
    sources.novel = vi.fn(() => novel.promise);
    sources.comic = vi.fn(() => Promise.reject(new Error("unknown source")));
    const session = createDiscoverySearch(sources);
    const work = session.ensure("星之梦", "all", 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(session.results.map(item => item.kind)).toEqual(["game", "anime"]);
    expect(session.pending).toEqual(["novel"]);
    expect(session.errors).toEqual([{ kind: "comic", source: "", message: "Error: unknown source" }]);
    novel.resolve(outcome("novel"));
    await work;
    expect(session.results.map(item => item.kind)).toEqual(["game", "anime", "novel"]);
    expect(sources.comic).toHaveBeenCalledOnce();
  });

  it("ignores stale responses and stale errors after a newer query or type takes over", async () => {
    const sources = providers();
    const old = deferred<DiscoveryOutcome>();
    sources.anime = vi.fn(() => old.promise);
    const session = createDiscoverySearch(sources);
    const previous = session.ensure("old", "anime", 1);
    await session.ensure("new", "comic", 1);
    old.reject(new Error("old failure"));
    await previous;
    expect(session.query).toBe("new");
    expect(session.results.map(item => item.kind)).toEqual(["comic"]);
    expect(session.errors).toEqual([]);
    expect(session.pending).toEqual([]);
  });

  it("clearing a query invalidates unfinished work without querying an empty keyword", async () => {
    const sources = providers();
    const response = deferred<DiscoveryOutcome>();
    sources.anime = vi.fn(() => response.promise);
    const session = createDiscoverySearch(sources);
    const work = session.ensure("old", "anime", 1);
    await session.ensure("  ", "anime", 1);
    response.resolve(outcome("anime"));
    await work;
    expect(session.results).toEqual([]);
    expect(session.pending).toEqual([]);
    expect(sources.anime).toHaveBeenCalledOnce();
  });

  it("snapshots the real store adapters without saving or opening results, including unknown source errors", async () => {
    const searchItem = { name: "星之梦", url: "https://source.test/one" };
    stores.anime.search.mockImplementationOnce(async () => {
      stores.anime.searchResults = [["available-rule", [searchItem]]];
      stores.anime.searchSourceStatus = { "unknown-rule": { status: "error", count: 0, error: "rule unavailable" } };
    });
    stores.comic.searchOrdinary.mockImplementationOnce(async () => {
      stores.comic.ordinarySourceSections = [
        { source: "baozi", label: "包子漫画", docs: [{ id: "baozi:1", title: "星之梦漫画" }], error: null },
        { source: "missing", label: "失效来源", docs: [], error: "unknown source" },
      ];
    });
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const session = createDiscoverySearch();
    await session.ensure("星之梦", "all", 1);
    expect(session.results).toHaveLength(2);
    expect(session.errors.map(item => item.source)).toEqual(["unknown-rule", "失效来源"]);
    expect(stores.navigateTo).not.toHaveBeenCalled();
    expect(stores.anime.openDetail).not.toHaveBeenCalled();
    expect(stores.comic.openOrdinaryComic).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
    searchItem.name = "detail changed shared data";
    stores.anime.searchResults = [];
    stores.anime.searchSourceStatus = {};
    stores.comic.ordinarySourceSections = [];
    await session.ensure("星之梦", "all", 1);
    expect(session.results[0].title).toBe("星之梦");
    await session.results[0].open();
    expect(stores.anime.openDetail).toHaveBeenCalledWith("available-rule", { name: "星之梦", url: "https://source.test/one" });
  });
});

describe("Discovery route lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(480);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(640);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (this: HTMLElement, options: number | ScrollToOptions) {
      if (typeof options === "object") this.scrollTop = options.top ?? this.scrollTop;
      this.dispatchEvent(new Event("scroll"));
    });
  });

  it("opens a result and remounts with the same result and focus without searching again", async () => {
    stores.anime.search.mockImplementationOnce(async () => {
      stores.anime.searchResults = [["rule", [{ name: "返回保留作品", url: "one" }]]];
    });
    const props = { query: "返回保留作品", kind: "anime" as const, request: 101 };
    const first = render(Discovery, props);
    const button = await first.findByRole("button", { name: /返回保留作品/ });
    await fireEvent.click(button);
    expect(stores.anime.openDetail).toHaveBeenCalledOnce();
    expect(discoverySearch.focusId).toBe("anime:rule:one");
    first.unmount();
    stores.anime.searchResults = [];
    const returned = render(Discovery, props);
    const saved = await returned.findByRole("button", { name: /返回保留作品/ });
    await waitFor(() => expect(document.activeElement).toBe(saved));
    expect(stores.anime.search).toHaveBeenCalledOnce();
  });

  it("rerenders the category with the same request and displays new results", async () => {
    stores.anime.search.mockImplementationOnce(async () => {
      stores.anime.searchResults = [["rule", [{ name: "原番剧", url: "one" }]]];
    });
    stores.comic.searchOrdinary.mockImplementationOnce(async () => {
      stores.comic.ordinarySourceSections = [{ source: "baozi", label: "漫画源", docs: [{ id: "baozi:1", title: "新漫画" }], error: null }];
    });
    const view = render(Discovery, { query: "切换分类", kind: "anime", request: 102 });
    await view.findByRole("button", { name: /原番剧/ });
    await view.rerender({ query: "切换分类", kind: "comic", request: 102 });
    await view.findByRole("button", { name: /新漫画/ });
    expect(view.queryByRole("button", { name: /原番剧/ })).toBeNull();
    expect(stores.comic.searchOrdinary).toHaveBeenCalledExactlyOnceWith("切换分类");
  });
});
