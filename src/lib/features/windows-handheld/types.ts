import type { Game } from "../../stores/games.svelte";
import type { ComicSummary, ReadRecord } from "../../stores/comic.svelte";
import type { AnimeCollect } from "../anime-home/collection.svelte";
import type { AnimeHistory } from "../anime-player/historyStore.svelte";
import type { MediaPresentationAction, MediaPresentationItem } from "../media-workspace/model/types";
import type { NovelHistoryEntry } from "../novel/types";

export type ContentKind = "game" | "anime" | "comic" | "novel";

/** Keep the real source identity and position, including collection-only entries. */
export type ResumeTarget =
  | { kind: "game"; gameId: string }
  | { kind: "anime"; history: AnimeHistory; collection?: AnimeCollect }
  | { kind: "anime"; history?: undefined; collection: AnimeCollect }
  | { kind: "comic"; history: ReadRecord; favorite?: ComicSummary }
  | { kind: "comic"; history?: undefined; favorite: ComicSummary }
  | { kind: "novel"; history: NovelHistoryEntry };

export interface HandheldContentItem extends MediaPresentationItem {
  actions: ContentAction[];
  kind: ContentKind;
  resumeTarget: ResumeTarget;
  updatedAt: number;
  progress: number | null;
  progressLabel: string;
  primaryLabel: string;
  inProgress: boolean;
  /** Verified only for the saved chapter, never the entire work. */
  offline?: { chapterKey: string; chapterTitle: string; checkedAt: number };
}

export interface ContentAction extends MediaPresentationAction {
  pending: boolean;
}

export interface HandheldContentInput {
  games: readonly Game[];
  animeHistory: readonly AnimeHistory[];
  animeCollection: readonly AnimeCollect[];
  comicHistory: readonly ReadRecord[];
  comicFavorites: readonly ComicSummary[];
  novelHistory: readonly NovelHistoryEntry[];
}

export type GameSessionStatus = "idle" | "pending" | "running" | "delegated" | "returned" | "failed";

export interface GameSession {
  gameId: string | null;
  title: string;
  status: GameSessionStatus;
  pid: number | null;
  message: string;
  error: string | null;
}

export interface RunningGame {
  game_id: string;
  session_id: string;
  pid: number;
  elapsed_seconds: number;
}

export interface GameLaunchResult {
  session_id: string;
  pid: number | null;
  locale_method?: string;
}
