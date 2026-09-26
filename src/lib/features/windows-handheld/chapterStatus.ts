import type { OfflineChapter } from "../../api/offline";
import type { ReadingPosition } from "../reading-history/repository";

/** Only claim completion when the persisted record actually measures it. */
export function chapterStatus(position?: ReadingPosition, offline?: OfflineChapter, current = false): string {
  const labels: string[] = current ? ["正在阅读"] : [];
  if (position?.progress !== undefined) labels.push(position.progress >= 0.995 ? "已读" : `已读 ${Math.round(position.progress * 100)}%`);
  else if (position?.pageIndex !== undefined) labels.push(`读到第 ${position.pageIndex + 1} 页`);
  if (offline) {
    if (offline.readable && offline.state === "complete" && offline.resourceState === "complete") labels.push("已离线");
    else labels.push(({ queued: "等待下载", downloading: "下载中", paused: "下载已暂停", failed: "下载失败", cancelled: "下载已取消", complete: "离线不可用" })[offline.state]);
  }
  return labels.join(" · ") || "未读";
}
