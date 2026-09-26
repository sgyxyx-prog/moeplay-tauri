import { animeStore } from "../../stores/anime.svelte";
import { comicStore } from "../../stores/comic.svelte";
import { gameStore } from "../../stores/games.svelte";
import { navigateTo } from "../../stores/router.svelte";
import { novelStore } from "../novel/store.svelte";
import type { ContentKind } from "./types";

export type DiscoveryKind = ContentKind | "all";
export interface DiscoveryResult {
  id: string;
  kind: ContentKind;
  title: string;
  source: string;
  open: () => Promise<unknown> | void;
}
export interface DiscoveryError {
  kind: ContentKind;
  source: string;
  message: string;
}
export interface DiscoveryOutcome {
  results: DiscoveryResult[];
  errors: DiscoveryError[];
}
export type DiscoverySearchers = Record<ContentKind, (query: string) => Promise<DiscoveryOutcome> | DiscoveryOutcome>;
const allKinds: ContentKind[] = ["game", "anime", "comic", "novel"];

/** Call each existing guarded search once; keep discovery separate from saved content. */
const searchers: DiscoverySearchers = {
  game(query) {
    return {
      results: gameStore.allGames.filter(game => game.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(game => ({
        id: `game:${game.id}`, kind: "game", title: game.name, source: "本机游戏库",
        open() { gameStore.selectGame(game.id); navigateTo("game-detail"); },
      })),
      errors: [],
    };
  },
  async anime(query) {
    await animeStore.search(query);
    const errors: DiscoveryError[] = Object.entries(animeStore.searchSourceStatus)
      .filter(([, status]) => status.status === "error")
      .map(([source, status]) => ({ kind: "anime", source, message: status.error || "检索失败" }));
    if (animeStore.error && errors.length === 0 && animeStore.error !== "未找到结果") {
      errors.push({ kind: "anime", source: "番剧来源", message: animeStore.error });
    }
    return {
      results: animeStore.searchResults.flatMap(([source, items]) => items.map(result => {
        const item = { ...result };
        return {
          id: `anime:${source}:${item.url}`, kind: "anime" as const, title: item.name, source,
          async open() { navigateTo("anime", { focus: "none" }); await animeStore.openDetail(source, item); },
        };
      })), errors,
    };
  },
  async comic(query) {
    await comicStore.searchOrdinary(query);
    return {
      results: comicStore.ordinarySourceSections.flatMap(section => section.docs.map(item => ({
        id: `comic:${section.source}:${item.id}`, kind: "comic" as const, title: item.title, source: section.label,
        async open() { navigateTo("comic", { focus: "none" }); await comicStore.openOrdinaryComic(item.id); },
      }))),
      errors: comicStore.ordinarySourceSections.filter(section => section.error)
        .map(section => ({ kind: "comic", source: section.label, message: section.error! })),
    };
  },
  async novel(query) {
    await novelStore.search(query);
    return {
      results: novelStore.books.map(result => {
        const book = { ...result, subjects: [...result.subjects] };
        return {
          id: `novel:${book.source}:${book.id}`, kind: "novel" as const, title: book.title, source: book.source,
          async open() { navigateTo("novel", { focus: "none" }); await novelStore.openBook(book); },
        };
      }),
      // The novel store exposes an aggregate error, not individual source failures.
      errors: novelStore.error ? [{ kind: "novel", source: "小说来源", message: novelStore.error }] : [],
    };
  },
};

export function createDiscoverySearch(providers: DiscoverySearchers = searchers) {
  let query = $state("");
  let kind = $state<DiscoveryKind>("anime");
  let request = $state(0);
  let requestKey = $state("");
  let results = $state.raw<DiscoveryResult[]>([]);
  let errors = $state.raw<DiscoveryError[]>([]);
  let pending = $state.raw<ContentKind[]>([]);
  let focusId = $state<string | null>(null);
  let scrollOffset = $state(0);
  let generation = 0;
  let work: Promise<void> = Promise.resolve();

  return {
    get query() { return query; },
    get kind() { return kind; },
    get request() { return request; },
    get requestKey() { return requestKey; },
    get results() { return results; },
    get errors() { return errors; },
    get pending() { return pending; },
    get focusId() { return focusId; },
    get scrollOffset() { return scrollOffset; },
    select(id: string) { if (results.some(result => result.id === id)) focusId = id; },
    scroll(offset: number) { scrollOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0; },

    /** Remounting a discovery view joins the same request, including an in-flight one. */
    ensure(nextQuery: string, nextKind: DiscoveryKind, nextRequest = request): Promise<void> {
      const normalized = nextQuery.trim();
      const key = JSON.stringify([normalized, nextKind, nextRequest]);
      if (key === requestKey) return work;
      requestKey = key;
      query = normalized;
      kind = nextKind;
      request = nextRequest;
      const token = ++generation;
      const requested = normalized ? (nextKind === "all" ? allKinds : [nextKind]) : [];
      results = [];
      errors = [];
      pending = [...requested];
      focusId = null;
      scrollOffset = 0;
      const outcomes = new Map<ContentKind, DiscoveryOutcome>();
      work = Promise.all(requested.map(async current => {
        try {
          const outcome = await providers[current](normalized);
          if (token !== generation) return;
          outcomes.set(current, outcome);
        } catch (error) {
          if (token !== generation) return;
          outcomes.set(current, { results: [], errors: [{ kind: current, source: "", message: String(error) }] });
        } finally {
          if (token === generation) {
            // Stable category order even when independent searches finish out of order.
            results = requested.flatMap(item => outcomes.get(item)?.results ?? []);
            errors = requested.flatMap(item => outcomes.get(item)?.errors ?? []);
            pending = pending.filter(item => item !== current);
          }
        }
      })).then(() => {});
      return work;
    },
  };
}

/** Kept outside route components so detail/reader navigation does not repeat searches. */
export const discoverySearch = createDiscoverySearch();
