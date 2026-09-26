import { invokeCmd } from "../../api/core";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { offlineApi, type OfflineChapter, type OfflineChapterContent } from "../../api/offline";
import { gameStore } from "../../stores/games.svelte";
import { animeStore } from "../../stores/anime.svelte";
import { comicStore } from "../../stores/comic.svelte";
import { navigateTo } from "../../stores/router.svelte";
import { uiStore } from "../../stores/ui.svelte";
import { gameLastPlayed, gameTotalSeconds } from "../../utils/game";
import { collectionStore } from "../anime-home/collection.svelte";
import type { AnimeCollect } from "../anime-home/collection.svelte";
import type { AnimeHistory } from "../anime-player/historyStore.svelte";
import { openUnifiedMediaHistory } from "../media-history/open";
import { adaptGameToPresentation } from "../media-workspace/model/gamePresentation";
import type { PresentationAsset } from "../media-workspace/model/types";
import { novelStore } from "../novel/store.svelte";
import { bookKey, readingRepository } from "../reading-history/repository";
import { activateRunningGame, type WindowsGameActivationResult } from "./native";
import type {
  ContentAction, ContentKind, GameLaunchResult, GameSession, HandheldContentInput,
  HandheldContentItem, ResumeTarget, RunningGame,
} from "./types";

export type { ContentKind, ContentAction, HandheldContentItem, ResumeTarget } from "./types";

const KIND_MODULE = { game: "games", anime: "anime", comic: "comics", novel: "novels" } as const;
export const CONTENT_KIND_LABELS: Record<ContentKind, string> = { game: "游戏", anime: "番剧", comic: "漫画", novel: "小说" };

function timestamp(value: string | number | undefined): number {
  const result = typeof value === "number" ? value : Date.parse(value ?? "");
  return Number.isFinite(result) && result > 0 ? result : 0;
}

function animeIdentity(entry: Pick<AnimeHistory, "key" | "sourceUrl" | "ruleName">): string {
  return entry.sourceUrl ? JSON.stringify([entry.ruleName, entry.sourceUrl]) : entry.key;
}

function collectionHistory(collection: AnimeCollect, histories: readonly AnimeHistory[]) {
  if (collection.ruleSource && collection.sourceUrl) {
    return histories.find((history) => history.ruleName === collection.ruleSource && history.sourceUrl === collection.sourceUrl);
  }
  // Old collections lack source identity. Only merge an unambiguous title match.
  const matches = histories.filter((history) => history.name === collection.name);
  return matches.length === 1 ? matches[0] : undefined;
}

function mediaItem(kind: Exclude<ContentKind, "game">, id: string, title: string, coverUrl: string | undefined,
  resumeTarget: ResumeTarget, updatedAt: number, progressLabel: string, inProgress: boolean, favorite = false,
  progress: number | null = null): HandheldContentItem {
  const cover: PresentationAsset | undefined = coverUrl ? { id: `${id}:cover`, src: coverUrl, role: "cover", alt: `${title} 封面`, aspect: "portrait" } : undefined;
  return {
    id, kind, module: KIND_MODULE[kind], title, subtitle: progressLabel, resumeTarget, updatedAt,
    progress, progressLabel, inProgress, favorite,
    primaryLabel: inProgress ? kind === "anime" ? "继续观看" : "继续阅读" : "打开作品",
    cover, screenshots: [], media: cover ? [cover] : [], mediaQuality: cover ? "c" : "d",
    // A history position is not proof that its files have been cached offline.
    installed: false, metadata: { tags: [] }, actions: [],
  };
}

/** The library uses owned/history/collection data only, never current search results. */
export function buildHandheldContent(input: HandheldContentInput): HandheldContentItem[] {
  const items = new Map<string, HandheldContentItem>();
  for (const game of input.games) {
    if (game.hidden) continue;
    const item = adaptGameToPresentation(game);
    const updatedAt = timestamp(gameLastPlayed(game) ?? undefined);
    const seconds = gameTotalSeconds(game);
    const id = `game:${game.id}`;
    items.set(id, {
      ...item, id, kind: "game", resumeTarget: { kind: "game", gameId: game.id },
      updatedAt, progress: null, progressLabel: seconds > 0 ? `已游玩 ${Math.max(1, Math.round(seconds / 60))} 分钟` : "尚未游玩",
      primaryLabel: updatedAt ? "继续游玩" : "开始游戏", inProgress: updatedAt > 0, actions: [],
    });
  }

  const animeHistory = [...input.animeHistory].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
  for (const history of animeHistory) {
    if (!history.key || !history.name?.trim()) continue;
    const id = `anime:${animeIdentity(history)}`;
    if (items.has(id)) continue;
    const minutes = Math.floor(Math.max(0, history.progressMs) / 60_000);
    const seconds = Math.floor(Math.max(0, history.progressMs) / 1000) % 60;
    const chapter = history.lastEpisodeName || `第 ${history.lastEpisode + 1} 集`;
    const position = history.progressMs > 0 ? `${chapter} · ${minutes}:${String(seconds).padStart(2, "0")}` : chapter;
    items.set(id, mediaItem("anime", id, history.name, history.image,
      { kind: "anime", history }, timestamp(history.updatedAt), position, true));
  }
  for (const collection of input.animeCollection) {
    if (!collection.name?.trim()) continue;
    const history = collectionHistory(collection, animeHistory);
    const id = `anime:${history ? animeIdentity(history) : collection.sourceUrl ? JSON.stringify([collection.ruleSource ?? "", collection.sourceUrl]) : collection.key}`;
    const previous = items.get(id);
    if (previous) {
      previous.favorite = true;
      if (previous.resumeTarget.kind === "anime") previous.resumeTarget = { ...previous.resumeTarget, collection };
    } else {
      items.set(id, mediaItem("anime", id, collection.name, collection.image,
        { kind: "anime", collection }, timestamp(collection.updatedAt), "已收藏", false, true));
    }
  }

  for (const history of [...input.comicHistory].sort((a, b) => b.ts - a.ts)) {
    if (!history.id || !history.title?.trim()) continue;
    const id = `comic:${history.id}`;
    if (items.has(id)) continue;
    const position = `${history.last_title || `第 ${history.last_order} 话`}${history.pageIndex === undefined ? "" : ` · 第 ${history.pageIndex + 1} 页`}`;
    items.set(id, mediaItem("comic", id, history.title, history.thumb_url,
      { kind: "comic", history }, timestamp(history.ts), position, true));
  }
  for (const favorite of input.comicFavorites) {
    if (!favorite.id || !favorite.title?.trim()) continue;
    const id = `comic:${favorite.id}`;
    const previous = items.get(id);
    if (previous) {
      previous.favorite = true;
      if (previous.resumeTarget.kind === "comic") previous.resumeTarget = { ...previous.resumeTarget, favorite };
    } else {
      items.set(id, mediaItem("comic", id, favorite.title, favorite.thumb_url,
        { kind: "comic", favorite }, 0, "已收藏", false, true));
    }
  }

  for (const history of [...input.novelHistory].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (!history.book?.id || !history.book.title?.trim()) continue;
    // Book identity stays stable when its chapter/progress changes.
    const id = `novel:${JSON.stringify([history.book.source, history.book.id])}`;
    if (items.has(id)) continue;
    const progress = Math.max(0, Math.min(1, Number.isFinite(history.progress) ? history.progress : 0));
    items.set(id, mediaItem("novel", id, history.book.title, history.book.coverUrl,
      { kind: "novel", history }, timestamp(history.updatedAt), `${history.chapterTitle} · ${Math.round(progress * 100)}%`, true, false, progress));
  }
  return [...items.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

const emptySession = (): GameSession => ({ gameId: null, title: "", status: "idle", pid: null, message: "", error: null });

export interface ContentDependencies {
  read: () => HandheldContentInput;
  launch: (gameId: string) => Promise<GameLaunchResult>;
  running: () => Promise<RunningGame[]>;
  resume: (target: Exclude<ResumeTarget, { kind: "game" }>) => Promise<boolean>;
  details: (target: ResumeTarget) => Promise<boolean>;
  favorite: (target: ResumeTarget) => Promise<void>;
  notify: (message: string) => void;
  activateRunning?: (gameId: string) => Promise<WindowsGameActivationResult>;
  offlineList?: () => Promise<OfflineChapter[]>;
  offlineChapter?: (key: string) => Promise<OfflineChapterContent>;
  refreshLibrary?: () => Promise<void>;
  subscribeSessionEnded?: (callback: () => void) => Promise<() => void>;
}

function resumeVersion(target: ResumeTarget): string {
  if (target.kind === "novel") return JSON.stringify([target.history.book.source, target.history.book.id, target.history.chapterId]);
  if (target.kind === "comic" && target.history) return JSON.stringify([target.history.id, target.history.last_order, target.history.providerResume?.chapterId, target.history.ts]);
  return "";
}

export function matchingOfflineChapter(target: ResumeTarget, chapters: readonly OfflineChapter[]): OfflineChapter | undefined {
  if (target.kind === "novel") return chapters.find(chapter => chapter.contentType === "novel"
    && chapter.sourceId === target.history.book.source && chapter.contentId === target.history.book.id && chapter.chapterId === target.history.chapterId);
  if (target.kind !== "comic" || !target.history) return undefined;
  const history = target.history;
  if (history.providerResume) {
    const resume = history.providerResume;
    return chapters.find(chapter => chapter.contentType === "manga" && chapter.sourceId === resume.providerId
      && chapter.contentId === resume.seriesId && chapter.chapterId === resume.chapterId);
  }
  const prefix = /^(mangadex|baozi|dm5|ikkk):(.+)$/.exec(history.id);
  const source = prefix?.[1] ?? "picacg";
  if (source === "dm5" || source === "ikkk") return undefined;
  const contentId = prefix?.[2] ?? history.id;
  const position = readingRepository.positions.filter(p => p.kind === "comic" && p.source === source && p.contentId === contentId
    && (!history.readingKey || bookKey(p) === history.readingKey)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const chapterId = position?.chapterId ?? String(history.last_order);
  return chapters.find(chapter => chapter.contentType === "manga" && chapter.sourceId === source
    && (chapter.contentId === history.id || chapter.contentId === contentId) && chapter.chapterId === chapterId);
}

async function defaultDetails(target: ResumeTarget): Promise<boolean> {
  if (target.kind === "game") {
    gameStore.selectGame(target.gameId);
    navigateTo("game-detail", { entity: { kind: "game", id: target.gameId }, focus: "none" });
    return true;
  }
  navigateTo(target.kind, { focus: "none" });
  if (target.kind === "anime") {
    const source = target.history?.ruleName || target.collection?.ruleSource;
    const url = target.history?.sourceUrl || target.collection?.sourceUrl;
    const title = target.history?.name || target.collection?.name || "";
    if (!source || !url) { uiStore.notify("这部番剧缺少来源，请搜索作品后选择可用来源。", "info"); return false; }
    await animeStore.openDetail(source, { name: title, url }, target.history?.image || target.collection?.image);
  } else if (target.kind === "comic") {
    const id = target.history?.id || target.favorite!.id;
    if (/^(mangadex|baozi|dm5|ikkk):/.test(id)) await comicStore.openMangaDexComic(id);
    else if (target.history?.providerResume) {
      // Provider-v2 owns its detail/resume context; do not reinterpret its source id as Picacg.
      await comicStore.resumeHistory(target.history);
    } else await comicStore.openComic(id);
  } else await novelStore.openBook(target.history.book);
  return true;
}

const defaultDependencies: ContentDependencies = {
  read: () => ({ games: gameStore.allGames, animeHistory: animeStore.history, animeCollection: animeStore.collection,
    comicHistory: comicStore.readHistory, comicFavorites: comicStore.favorites, novelHistory: novelStore.history }),
  launch: (id) => gameStore.launchTracked(id),
  running: () => invokeCmd<RunningGame[]>("get_running_games"),
  async resume(target) {
    if (target.kind === "anime" && target.history) return openUnifiedMediaHistory({ kind: "anime", payload: target.history });
    if (target.kind === "comic" && target.history) return openUnifiedMediaHistory({ kind: "comic", payload: target.history });
    if (target.kind === "novel") return openUnifiedMediaHistory({ kind: "novel", payload: target.history });
    return defaultDetails(target);
  },
  details: defaultDetails,
  async favorite(target) {
    if (target.kind === "game") await gameStore.toggleFavorite(target.gameId);
    else if (target.kind === "anime") {
      const title = target.history?.name || target.collection?.name || "";
      collectionStore.setCollect(title, collectionStore.getType(title) ? 0 : 1, target.collection,
        { image: target.history?.image || target.collection?.image || "", ruleName: target.history?.ruleName || target.collection?.ruleSource || "", sourceUrl: target.history?.sourceUrl || target.collection?.sourceUrl || "" });
    }
  },
  notify: (message) => uiStore.notify(message, "error"),
  activateRunning: activateRunningGame,
  offlineList: offlineApi.list,
  offlineChapter: offlineApi.getChapter,
  refreshLibrary: () => gameStore.load(),
  subscribeSessionEnded: (callback) => isTauri() ? listen("play-session-ended", callback) : Promise.resolve(() => {}),
};

/** Rune-backed façade with injectable native actions for lifecycle tests. */
export function createHandheldContentStore(deps: ContentDependencies = defaultDependencies) {
  let pendingIds = $state<string[]>([]);
  let gameSession = $state<GameSession>(emptySession());
  let runningGames = $state<RunningGame[]>([]);
  let runningRequest = 0;
  let launchVersion = 0;
  let leftApplication = false;
  let stopWatching: (() => void) | null = null;
  let offline = $state<Record<string, { version: string; chapterKey: string; chapterTitle: string; checkedAt: number }>>({});
  let offlineRequest = 0;
  const operations = new Map<string, Promise<boolean>>();

  function pending(id: string, active: boolean) {
    pendingIds = active ? [...new Set([...pendingIds, id])] : pendingIds.filter((value) => value !== id);
  }

  async function refreshRunningGames(): Promise<void> {
    const request = ++runningRequest;
    const version = launchVersion;
    try {
      const result = await deps.running();
      if (request !== runningRequest || version !== launchVersion) return;
      runningGames = Array.isArray(result) ? result.filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0) : [];
      if (gameSession.status === "running" && !runningGames.some((entry) => entry.game_id === gameSession.gameId && entry.pid === gameSession.pid)) {
        gameSession = { ...gameSession, status: "returned", pid: null, message: "游戏已结束，已保留原浏览位置。" };
      }
    } catch {
      // Failed observation is not evidence that a running process has exited.
    }
  }

  function runOnce(id: string, action: () => Promise<boolean>): Promise<boolean> {
    const existing = operations.get(id);
    if (existing) return existing;
    pending(id, true);
    const operation = Promise.resolve().then(action).catch((error: unknown) => {
      deps.notify(String(error));
      return false;
    }).finally(() => {
      operations.delete(id);
      pending(id, false);
    });
    operations.set(id, operation);
    return operation;
  }

  async function refreshOffline(): Promise<void> {
    if (!deps.offlineList || !deps.offlineChapter) return;
    const request = ++offlineRequest;
    const verified: typeof offline = {};
    try {
      const chapters = await deps.offlineList();
      const candidates = buildHandheldContent(deps.read()).flatMap(item => {
        const chapter = matchingOfflineChapter(item.resumeTarget, chapters);
        return chapter?.readable && chapter.state === "complete" ? [{ item, chapter }] : [];
      });
      // Bound native IO. Never load every offline chapter body at the same time.
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
        while (next < candidates.length && request === offlineRequest) {
          const { item, chapter } = candidates[next++];
          try {
            const content = await deps.offlineChapter!(chapter.offlineChapterKey);
            const readable = content.chapter.readable && content.chapter.state === "complete"
              && content.chapter.offlineChapterKey === chapter.offlineChapterKey
              && (chapter.contentType === "novel" ? Boolean(content.body?.trim()) : content.resourcePaths.length > 0);
            if (readable) verified[item.id] = { version: resumeVersion(item.resumeTarget), chapterKey: chapter.offlineChapterKey, chapterTitle: chapter.title, checkedAt: Date.now() };
          } catch { /* A missing/corrupt chapter must not appear in the offline filter. */ }
        }
      }));
    } catch { /* Failed verification clears previously claimed availability. */ }
    if (request === offlineRequest) offline = verified;
  }

  const store = {
    get pendingIds() { return pendingIds; },
    get gameSession() { return gameSession; },
    get runningGames() { return runningGames; },
    get library(): HandheldContentItem[] {
      const input = deps.read();
      const launchableIds = new Set(input.games.filter(game => game.exe_path?.trim() || game.launch_uri?.trim()).map(game => game.id));
      const runningIds = new Set(runningGames.map(game => game.game_id));
      const pendingSet = new Set(pendingIds);
      return buildHandheldContent(input).map((item) => {
        const isPending = pendingSet.has(item.id);
        const target = item.resumeTarget;
        const running = target.kind === "game" && (runningIds.has(target.gameId)
          || (gameSession.gameId === target.gameId && gameSession.status === "running"));
        const delegated = target.kind === "game" && gameSession.gameId === target.gameId && gameSession.status === "delegated";
        const failed = target.kind === "game" && gameSession.gameId === target.gameId && gameSession.status === "failed";
        const launchable = target.kind !== "game" || launchableIds.has(target.gameId);
        const cached = offline[item.id];
        if (cached?.version === resumeVersion(target) && item.kind !== "game") { item.offline = cached; item.installed = true; }
        item.primaryLabel = isPending ? target.kind === "game" ? "正在处理…" : "正在打开…" : running ? "返回游戏" : delegated ? "已交给平台" : failed ? "重试启动" : item.primaryLabel;
        const actions: ContentAction[] = [
          { id: "launch", label: item.primaryLabel, emphasis: "primary", enabled: launchable && !isPending && !delegated, pending: isPending,
            run: async () => { await store.activate(item); } },
          { id: "open", label: "查看详情", emphasis: "secondary", enabled: !isPending, pending: false,
            run: async () => { await store.openDetails(item); } },
        ];
        if (delegated) actions.push({ id: "launch-again", label: "再次请求平台启动", emphasis: "secondary", enabled: !isPending, pending: false,
          run: async () => { await store.activate(item, true); } });
        if (item.kind === "game" || item.kind === "anime") actions.push({
          id: "toggle-favorite", label: item.favorite ? "取消收藏" : "收藏", emphasis: "quiet", enabled: !isPending, pending: false, active: item.favorite,
          run: async () => { await deps.favorite(item.resumeTarget); },
        });
        item.actions = actions;
        return item;
      });
    },
    get continueItems() { return store.library.filter((item) => item.inProgress).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)); },
    activate(item: HandheldContentItem, requestAgain = false): Promise<boolean> {
      const target = item.resumeTarget;
      if (target.kind !== "game") return runOnce(item.id, () => deps.resume(target));
      if (runningGames.some((entry) => entry.game_id === target.gameId)
        || (gameSession.gameId === target.gameId && gameSession.status === "running")) return runOnce(item.id, async () => {
          const result = await deps.activateRunning?.(target.gameId);
          if (result?.status === "activated") return true;
          deps.notify("Windows 暂时无法切回游戏，请使用系统任务切换（Alt+Tab）。游戏仍保持运行。");
          return false;
        });
      if (!requestAgain && gameSession.gameId === target.gameId && gameSession.status === "delegated") return Promise.resolve(false);
      return runOnce(item.id, async () => {
        const version = ++launchVersion;
        leftApplication = false;
        gameSession = { gameId: target.gameId, title: item.title, status: "pending", pid: null, message: "正在启动…", error: null };
        try {
          const result = await deps.launch(target.gameId);
          if (!result || !(result.pid === null || (Number.isInteger(result.pid) && result.pid > 0))) throw new Error("启动返回状态无效，请先检查游戏是否已经打开。");
          const pid = result.pid;
          if (pid) runningGames = [...runningGames.filter((entry) => entry.game_id !== target.gameId),
            { game_id: target.gameId, session_id: result.session_id, pid, elapsed_seconds: 0 }];
          if (version !== launchVersion) return true;
          gameSession = { ...gameSession, pid, status: pid ? "running" : "delegated",
            message: pid ? "游戏运行中" : "已交给平台启动；返回萌游后可继续浏览。" };
          void deps.refreshLibrary?.().catch(() => {});
          return true;
        } catch (error) {
          if (version === launchVersion) gameSession = { ...gameSession, status: "failed", message: "启动失败，可以重试。", error: String(error) };
          throw error;
        }
      });
    },
    openDetails(item: HandheldContentItem) { return runOnce(item.id, () => deps.details(item.resumeTarget)); },
    refreshRunningGames,
    refreshOffline,
    onApplicationBlur() { leftApplication = true; },
    async onApplicationReturn() {
      if (leftApplication && gameSession.status === "delegated") {
        gameSession = { ...gameSession, status: "returned", message: "已返回萌游；平台游戏的运行状态未知。" };
      }
      leftApplication = false;
      await Promise.all([refreshRunningGames(), refreshOffline()]);
    },
    start(): () => void {
      if (stopWatching || typeof window === "undefined") return () => {};
      void refreshRunningGames();
      void refreshOffline();
      const onFocus = () => { void store.onApplicationReturn(); };
      const onBlur = () => store.onApplicationBlur();
      const onVisibility = () => document.visibilityState === "visible" ? onFocus() : onBlur();
      let stopped = false;
      let unlisten: (() => void) | undefined;
      void deps.subscribeSessionEnded?.(() => {
        if (stopped) return;
        void refreshRunningGames();
        void deps.refreshLibrary?.().catch(() => {});
      }).then((release) => { if (stopped) release(); else unlisten = release; }).catch(() => {});
      window.addEventListener("focus", onFocus);
      window.addEventListener("blur", onBlur);
      document.addEventListener("visibilitychange", onVisibility);
      const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refreshRunningGames(); }, 3000);
      stopWatching = () => {
        stopped = true;
        unlisten?.();
        window.clearInterval(timer);
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("blur", onBlur);
        document.removeEventListener("visibilitychange", onVisibility);
        runningRequest += 1;
        offlineRequest += 1;
        stopWatching = null;
      };
      return () => stopWatching?.();
    },
  };
  return store;
}

export const handheldContentStore = createHandheldContentStore();
