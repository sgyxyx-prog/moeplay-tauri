import { readFileSync } from "node:fs";
import { test, expect, DEFAULT_APP_STATE } from "./fixtures/app-fixture";

test.use({ viewport: { width: 1280, height: 800 }, appState: {
  ...DEFAULT_APP_STATE,
  settings: { ...DEFAULT_APP_STATE.settings, startup_mode: "windowed" },
  localStorage: { ...DEFAULT_APP_STATE.localStorage, "moeplay-windows-display-v1": JSON.stringify({ mode: "handheld" }) },
  commandResults: { get_running_games: [], offline_list: [] },
} });

// Mount the real consuming component against deterministic media, keeping
// source resolution independent from controller and WebView playback behavior.
test("Windows video keeps its element and position paused after resume", async ({ appPage: page, gamepad }, testInfo) => {
  const bytes = readFileSync("tests/visual/fixtures/media/picture-and-sound.mp4");
  await page.route("**/handheld-media.mp4", route => {
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: "video/mp4", headers: {
      "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}),
    }, body: bytes.subarray(start, end + 1) });
  });
  await page.evaluate(async () => {
    const componentUrl = "/src/lib/components/anime/provider-v2/ProviderV2Player.svelte";
    const svelteUrl = "/node_modules/.vite/deps/svelte.js";
    const { default: Player } = await import(componentUrl);
    const { mount, unmount } = await import(svelteUrl);
    const internals = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string) => string } }).__TAURI_INTERNALS__;
    internals.convertFileSrc = () => `${location.origin}/handheld-media.mp4`;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:9999";
    document.body.append(host);
    const identity = { providerId: "fixture", seriesId: "series", episodeId: "episode-1" };
    const component = mount(Player, { target: host, props: {
      resolution: { episode: identity, target: { mode: "native_file", path: "fixture.mp4" } },
      episode: { identity, title: "第 1 集", number: 1, artworkUrl: null }, seriesTitle: "掌机播放验收",
      onClose: () => { void unmount(component); host.remove(); }, onFallback: () => {},
    } });
  });
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate(node => node.readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate(async node => { node.muted = true; await node.play(); node.currentTime = 0.25; node.dataset.instance = "retained"; });
  await gamepad.connect();
  await gamepad.press("y");
  const settings = page.getByRole("complementary", { name: "播放设置" });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("combobox", { name: "倍速" })).toHaveValue("1");
  await gamepad.press("b");
  await expect(settings).toHaveCount(0);
  await expect(video).toBeVisible();
  await video.evaluate(node => { node.pause(); node.currentTime = 0.25; window.dispatchEvent(new Event("moeplay:suspend")); window.dispatchEvent(new Event("moeplay:resume")); });
  await expect.poll(() => video.evaluate(node => node.seeking)).toBe(false);
  expect(await video.evaluate(node => node.currentTime)).toBeCloseTo(0.25, 1);
  await video.evaluate(node => node.play().catch(() => {}));
  await expect.poll(() => video.evaluate(node => node.paused)).toBe(true);
  await expect(video).toHaveAttribute("data-instance", "retained");
  expect(await video.evaluate(node => node.currentTime)).toBeCloseTo(0.25, 1);
  await gamepad.press("a");
  await expect.poll(() => video.evaluate(node => node.paused)).toBe(false);
  await gamepad.press("y");
  await page.setViewportSize({ width: 640, height: 400 });
  expect((await settings.boundingBox())?.width).toBeGreaterThanOrEqual(638);
  await expect(settings.getByRole("button", { name: "返回播放" })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("windows-video-settings.png") });
});

test("Windows comic settings own directions and preserve the current page", async ({ appPage: page, gamepad }, testInfo) => {
  await page.route("**/handheld-page-*.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1800"><rect width="600" height="1800" fill="#516788"/><text x="40" y="100" fill="white" font-size="40">Reader fixture</text></svg>' }));
  await page.evaluate(async () => {
    const componentUrl = "/src/lib/components/comic/provider-v2/ProviderReader.svelte";
    const svelteUrl = "/node_modules/.vite/deps/svelte.js";
    const { default: Reader } = await import(componentUrl);
    const { mount, unmount } = await import(svelteUrl);
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:9999";
    document.body.append(host);
    const component = mount(Reader, { target: host, props: {
      provider: { id: "fixture", kind: "komga", name: "Fixture", origin: location.origin, authMode: "none", secretConfigured: false,
        manifest: { id: "fixture", name: "Fixture", resourceKinds: ["comic"], capabilities: ["resolve"], trust: "self_hosted", version: "1", enabled: true, requiresAuth: false, allowedHosts: [location.hostname] } },
      target: { mode: "image_pages", pages: [`${location.origin}/handheld-page-1.svg`, `${location.origin}/handheld-page-2.svg`], headers: [] },
      title: "掌机阅读验收", chapterTitle: "第 1 话", seriesId: "series", chapterId: "chapter-1",
      onclose: () => { void unmount(component); host.remove(); },
    } });
  });
  const reader = page.getByRole("dialog", { name: "阅读 掌机阅读验收" });
  await expect(reader).toHaveClass(/width-fit/);
  await expect(reader.locator(".page-frame img")).toBeVisible();
  await expect(reader.locator(".reader-header-actions")).toContainText("1 / 2");
  await gamepad.connect();
  await gamepad.press("y");
  const settings = page.getByRole("complementary", { name: "阅读设置" });
  await expect(settings).toBeVisible();
  await gamepad.press("dpadDown");
  await gamepad.press("a");
  await expect(settings.getByRole("button", { name: "图片适配：适合整页" })).toBeVisible();
  await expect(reader.locator(".reader-header-actions")).toContainText("1 / 2");
  await gamepad.press("b");
  await expect(settings).toHaveCount(0);
  await gamepad.press("a");
  await expect(reader.locator(".reader-header-actions")).toContainText("2 / 2");
  expect(await page.evaluate(() => localStorage.getItem("moeplay-provider-reader-fit:fixture:series"))).toBe("screen");
  await gamepad.press("y");
  await page.setViewportSize({ width: 640, height: 400 });
  expect((await settings.boundingBox())?.width).toBeGreaterThanOrEqual(638);
  await page.screenshot({ path: testInfo.outputPath("windows-comic-reader.png") });
});

test("Windows novel virtual chapters preserve reading progress and expose real offline states", async ({ appPage: page, gamepad }, testInfo) => {
  await page.evaluate(async () => {
    const componentUrl = "/src/lib/components/NovelPage.svelte";
    const svelteUrl = "/node_modules/.vite/deps/svelte.js";
    const storeUrl = "/src/lib/features/novel/store.svelte.ts";
    const historyUrl = "/src/lib/features/reading-history/repository.ts";
    const { default: Novel } = await import(componentUrl);
    const { mount } = await import(svelteUrl);
    const { novelStore } = await import(storeUrl);
    const { readingRepository } = await import(historyUrl);
    const book = { id: "long-novel", source: "gutenberg", title: "千章阅读验收", subjects: [], publicDomain: true, sourceUrl: "https://example.test/book" };
    const chapters = Array.from({ length: 1000 }, (_, index) => ({ id: `chapter-${index}`, title: `第 ${index + 1} 章`, order: index }));
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const previous = internals.invoke;
    internals.invoke = async (command, args) => {
      if (command === "novel_detail") return { book, chapters };
      if (command === "novel_read_chapter") return { bookId: book.id, source: book.source, chapter: chapters.find(chapter => chapter.id === args?.chapterId), content: Array.from({ length: 250 }, (_, i) => `第 ${i + 1} 段。这是一段用于验证掌机分页、续读和字体布局的正文，调整设置后仍应留在相同阅读位置。`).join("\n\n") };
      if (command === "offline_list") return [501, 502].map(index => ({ offlineChapterKey: `offline-${index}`, contentType: "novel", sourceId: "gutenberg", contentId: book.id, chapterId: `chapter-${index}`, state: "complete", resourceState: "complete", readable: index === 501, resources: [] }));
      return previous(command, args);
    };
    await novelStore.openBook(book);
    await novelStore.readChapter(chapters[500]);
    await readingRepository.save({ kind: "novel", source: book.source, contentId: book.id, chapterId: chapters[500].id, chapterTitle: chapters[500].title, title: book.title, progress: 0.4, updatedAt: Date.now(), metadata: { book } });
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:9999";
    document.body.append(host);
    mount(Novel, { target: host });
  });
  const reader = page.locator(".reader-scroll.paged");
  await expect(reader).toBeVisible();
  await expect.poll(() => reader.evaluate(node => node.scrollLeft)).toBeGreaterThan(100);
  const offset = await reader.evaluate(node => node.scrollLeft);
  await gamepad.connect();
  await gamepad.press("x");
  const chapters = page.getByRole("complementary", { name: "小说章节" });
  await expect(chapters).toBeVisible();
  await expect(chapters.locator("[aria-current=true]")).toBeFocused();
  await expect(chapters.locator("[aria-current=true]")).toContainText("正在阅读");
  await expect(chapters.getByRole("button", { name: "第 502 章 未读 · 已离线" })).toHaveCount(0);
  await expect(chapters.locator("[data-virtual-item-id='chapter-501']")).toContainText("已离线");
  await expect(chapters.locator("[data-virtual-item-id='chapter-502']")).toContainText("离线不可用");
  expect(await chapters.locator("[data-virtual-item-id]").count()).toBeLessThan(35);
  await page.keyboard.press("ArrowDown");
  await expect(chapters.locator("[data-virtual-item-id='chapter-501'] button")).toBeFocused();
  await gamepad.press("b");
  await expect(chapters).toHaveCount(0);
  expect(await reader.evaluate(node => node.scrollLeft)).toBeCloseTo(offset, 0);
  await gamepad.press("y");
  const settings = page.locator(".windows-reader-settings");
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "增大字体" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("moeplay-novel-reader-prefs-v1:gutenberg:long-novel")!).fontSize)).toBe(20);
  await gamepad.press("b");
  await gamepad.press("x");
  await page.setViewportSize({ width: 640, height: 400 });
  expect((await chapters.boundingBox())?.width).toBeGreaterThanOrEqual(638);
  await page.screenshot({ path: testInfo.outputPath("windows-novel-chapters.png") });
});
