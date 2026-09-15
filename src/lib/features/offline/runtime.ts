import { offlineApi, type OfflineChapter } from "../../api/offline";

/** Chapter parsing is deliberately bounded independently from video downloads. */
export const OFFLINE_PARSE_CONCURRENCY = 2;

/** Rehydrate the durable queue after an app restart. The Rust store is the source of truth. */
export async function restoreOfflineQueue(): Promise<OfflineChapter[]> {
  const chapters = await offlineApi.list();
  return chapters.filter((chapter) => chapter.state === "queued" || chapter.state === "downloading" || chapter.state === "paused");
}
