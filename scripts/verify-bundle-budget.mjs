import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_BUDGET = Object.freeze({
  // v0.24.0 Windows 掌机预览: 直接引入 TanStack Virtual，并为掌机壳、
  // 章节面板和媒体恢复新增按需块。origin/master 的同环境基线为
  // 3,078,239 B / 97,474 B Comic；保持约 22 KB / 5 KB 的缓冲，避免
  // 未来把整个预览功能无界地纳入包体。
  totalJavaScriptBytes: 3_200_000,
  largestChunkBytes: 1_100_000,
  animeChunkBytes: 700_000,
  comicChunkBytes: 110_000,
});

export function inspectBundle(directory, budget = DEFAULT_BUDGET) {
  if (!fs.existsSync(directory)) throw new Error(`bundle directory does not exist: ${directory}`);
  const files = fs.readdirSync(directory)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({ name, bytes: fs.statSync(path.join(directory, name)).size }));
  if (!files.length) throw new Error(`no JavaScript chunks found in ${directory}`);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  const largest = [...files].sort((a, b) => b.bytes - a.bytes)[0];
  const anime = files.find((file) => file.name.startsWith("AnimePage-"));
  const comic = files.find((file) => file.name.startsWith("ComicPage-"));
  const failures = [];
  if (total > budget.totalJavaScriptBytes) failures.push(`total JS ${total} > ${budget.totalJavaScriptBytes}`);
  if (largest.bytes > budget.largestChunkBytes) failures.push(`largest chunk ${largest.name} ${largest.bytes} > ${budget.largestChunkBytes}`);
  if (anime && anime.bytes > budget.animeChunkBytes) failures.push(`Anime chunk ${anime.bytes} > ${budget.animeChunkBytes}`);
  if (comic && comic.bytes > budget.comicChunkBytes) failures.push(`Comic chunk ${comic.bytes} > ${budget.comicChunkBytes}`);
  return { files, total, largest, anime, comic, failures };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const directory = path.resolve(process.argv[2] ?? "dist/assets");
  const report = inspectBundle(directory);
  console.log(`Bundle budget: ${report.files.length} JS chunks, ${report.total} bytes total`);
  console.log(`Largest: ${report.largest.name} (${report.largest.bytes} bytes)`);
  if (report.anime) console.log(`Anime: ${report.anime.bytes} bytes`);
  if (report.comic) console.log(`Comic: ${report.comic.bytes} bytes`);
  if (report.failures.length) {
    for (const failure of report.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
}
