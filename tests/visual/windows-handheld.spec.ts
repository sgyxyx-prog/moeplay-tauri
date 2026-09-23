import { test, expect, DEFAULT_APP_STATE, MOCK_GAMES } from "./fixtures/app-fixture";

const profileKey = "moeplay-windows-display-v1";
const state = {
  ...DEFAULT_APP_STATE,
  settings: { ...DEFAULT_APP_STATE.settings, startup_mode: "windowed" },
  localStorage: { ...DEFAULT_APP_STATE.localStorage, [profileKey]: JSON.stringify({ mode: "handheld", comfort: 100, density: "comfortable", lightEffects: true }) },
  commandResults: {
    get_running_games: [],
    windows_keyboard_show: { status: "requested" },
    windows_keyboard_hide: { status: "requested" },
    windows_keyboard_status: { available: true, visible: false, visibilityKnown: true, occluded: {x:0,y:0,width:0,height:0}, clientWidth:1280, coordinateSpace:"dip" },
    offline_list: [],
  },
};

const sampleArt = (portrait: boolean, label: string, first: string, second: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${portrait ? "600 900" : "1200 650"}"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="${first}"/><stop offset="1" stop-color="${second}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#a)"/><circle cx="67%" cy="38%" r="28%" fill="#ffffff44"/><path d="M0 530 Q380 220 700 530 T1200 470 V900 H0" fill="#1c254688"/><text x="8%" y="68%" font-family="sans-serif" font-weight="bold" font-size="${portrait ? 58 : 92}" fill="white">${label}</text></svg>`)}`;
const visualGames = [
  { ...MOCK_GAMES[0], id: "wide-art", name: "星海回声", metadata: { ...MOCK_GAMES[0].metadata, cover: "https://art.moeplay.test/portrait.svg", background: "https://art.moeplay.test/wide.svg" }, play_tracker: { ...MOCK_GAMES[0].play_tracker, last_played: "2026-09-23T12:00:00.000Z" } },
  { ...MOCK_GAMES[1], id: "portrait-art", name: "只有竖版封面的作品", metadata: { ...MOCK_GAMES[1].metadata, cover: "https://art.moeplay.test/portrait-pink.svg" }, play_tracker: { ...MOCK_GAMES[1].play_tracker, last_played: "2026-09-22T12:00:00.000Z" } },
  { ...MOCK_GAMES[0], id: "failed-art", name: "加载失败后依然清楚可读的超长作品标题：关于那场旅行与记忆的另一种结局", metadata: { ...MOCK_GAMES[0].metadata, cover: "data:image/png;base64,invalid", background: "data:image/png;base64,invalid" }, play_tracker: { ...MOCK_GAMES[0].play_tracker, last_played: "2026-09-21T12:00:00.000Z" } },
  { ...MOCK_GAMES[1], id: "no-art", name: "没有封面的故事", metadata: { ...MOCK_GAMES[1].metadata }, play_tracker: { ...MOCK_GAMES[1].play_tracker, last_played: "2026-09-20T12:00:00.000Z" } },
];

test.describe("Windows handheld settings entry", () => {
  test.use({ appState: { ...DEFAULT_APP_STATE, settings: { ...DEFAULT_APP_STATE.settings, startup_mode: "windowed" } }, viewport: { width: 1280, height: 800 } });
  test("enables the persistent shell from the existing appearance settings", async ({ appPage: page }) => {
    await expect(page.getByTestId("windows-handheld-shell")).toHaveCount(0);
    await page.getByRole("banner").getByRole("button", { name: "打开设置" }).click();
    const entry = page.getByRole("button", { name: "开启新掌机模式" });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry).toBeInViewport();
    await entry.click();
    await expect(page.getByTestId("windows-handheld-shell")).toBeVisible();
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).mode, profileKey)).toBe("handheld");
  });
});

test.describe("Windows handheld interaction", () => {
  test.use({ appState: state, viewport: { width: 1280, height: 800 } });
  test("preserves selection across resolution changes, panels and inner routes", async ({ appPage: page, gamepad }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await expect(page.getByTestId("windows-handheld-shell")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("editorial-home-1280.png") });
    await page.getByRole("button", { name: "藏馆", exact: true }).click();
    await page.getByRole("button", { name: "全部作品", exact: true }).click();
    const rows = page.locator(".content-row");
    await expect(rows.first()).toBeVisible();
    await rows.nth(1).click();
    const id = await rows.nth(1).getAttribute("data-focus-key");
    await gamepad.connect();
    await gamepad.press("x");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("action-wheel-1280.png") });
    await gamepad.press("b");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    for (const size of [{width:640,height:400},{width:1280,height:800},{width:1920,height:1200},{width:2560,height:1600},{width:1280,height:800}]) {
      await page.setViewportSize(size);
      await page.clock.runFor(100);
      await expect(page.locator(".content-row.selected")).toHaveAttribute("data-focus-key", id!);
    }
    await gamepad.press("x");
    await page.getByRole("button", { name: "章节与详情" }).click();
    await expect(page.getByRole("button", { name: "← 返回藏馆" })).toBeVisible();
    await page.getByRole("button", { name: "← 返回藏馆" }).click();
    await expect(page.locator(".content-row.selected")).toHaveAttribute("data-focus-key", id!);
    await page.screenshot({ path: testInfo.outputPath("handheld-1280.png") });
    expect(errors).toEqual([]);
  });
  test("keeps real Chinese composition input and keyboard request separate from visibility", async ({ appPage: page, gamepad }) => {
    // The native API checks this official marker; invoke is already intercepted by the fixture.
    await page.evaluate(() => Object.defineProperty(window, "isTauri", { configurable: true, value: true }));
    await gamepad.connect();
    await gamepad.press("y");
    const input = page.getByRole("searchbox", { name: "作品名称" });
    await expect(input).toBeFocused();
    await input.dispatchEvent("compositionstart");
    await input.fill("命运石之门");
    await expect(page.getByRole("button", { name: "搜索", exact:true })).toBeDisabled();
    await input.dispatchEvent("compositionend");
    await page.getByRole("button", { name: "打开键盘", exact: true }).click();
    await expect(input).toHaveValue("命运石之门");
    await expect(page.getByRole("status").filter({ hasText:"已请求系统键盘" })).toBeVisible();
    await page.setViewportSize({width:1280,height:500});
    await expect(input).toHaveValue("命运石之门");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("windows-handheld-shell")).toBeVisible();
  });
});

test.describe("Windows handheld artwork states", () => {
  test.use({ appState: { ...state, games: visualGames }, viewport: { width: 1280, height: 800 } });
  test("keeps hero, portrait, broken and missing artwork legible", async ({ appPage: page, gamepad }, testInfo) => {
    await page.route("https://art.moeplay.test/**", async route => {
      const name = route.request().url().split("/").at(-1);
      const svg = name === "wide.svg" ? sampleArt(false, "星海回声", "#4c68aa", "#ab80c7")
        : name === "portrait-pink.svg" ? sampleArt(true, "竖版封面", "#c870a3", "#e8b392")
        : sampleArt(true, "星海", "#5d70b9", "#a07dd6");
      await route.fulfill({ contentType: "image/svg+xml", body: decodeURIComponent(svg.slice("data:image/svg+xml,".length)) });
    });
    await page.reload();
    const shell = page.getByTestId("windows-handheld-shell");
    await expect(page.locator(".stage-art")).toBeVisible();
    await expect.poll(() => page.locator(".stage-art").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("home-wide-art.png") });
    await page.locator(".recent-card").first().focus();
    await gamepad.connect();
    await gamepad.press("dpadRight");
    await expect(page.locator(".recent-card").nth(1)).toHaveClass(/selected/);
    await page.getByRole("button", { name: /只有竖版封面的作品/ }).first().click();
    await expect(page.locator(".stage-art:not(.wide)")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("home-portrait-art.png") });
    await page.getByRole("button", { name: /加载失败后依然清楚可读/ }).first().click();
    await expect(page.locator(".stage-pattern")).toBeVisible();
    await expect(page.locator(".stage-copy h1")).toContainText("加载失败后依然清楚可读");
    await page.screenshot({ path: testInfo.outputPath("home-failed-art.png") });
    await page.getByRole("button", { name: "藏馆", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("gallery-art-states.png") });
    expect(await shell.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 640, height: 400 });
    await expect(page.locator(".content-row").first()).toBeInViewport();
    await page.getByRole("button", { name: "搜索内容" }).click();
    await page.screenshot({ path: testInfo.outputPath("search-640.png") });
    await page.keyboard.press("Escape");
    await page.locator(".content-row").first().click();
    await gamepad.connect();
    await gamepad.press("x");
    await expect(page.locator(".wheel-list")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("wheel-640.png") });
    await gamepad.press("b");
    await page.getByRole("button", { name: "快捷面板" }).click();
    await expect(page.getByRole("button", { name: "切回原界面" })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("quick-640.png") });
    await page.keyboard.press("Escape");
    expect(await shell.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  });
});

test.describe("personal work album", () => {
  test.use({ appState: state, viewport: { width: 1280, height: 800 } });
  test("creates, arranges and restores a playable album", async ({ appPage: page, gamepad }, testInfo) => {
    await page.getByRole("button", { name: "藏馆", exact: true }).click();
    await page.getByRole("button", { name: "我的专题 · 0" }).click();
    await page.getByPlaceholder("给新专题起个名字").fill("科幻故事收藏");
    await page.getByRole("button", { name: "创建专题" }).click();
    await expect(page.getByRole("region", { name: "专题 科幻故事收藏" })).toBeVisible();
    await page.getByRole("button", { name: "编辑专题" }).click();
    await page.screenshot({ path: testInfo.outputPath("album-edit-1280.png") });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "添加作品" }).click();
    await page.getByRole("button", { name: /星海回声/ }).last().click();
    await expect(page.locator(".member-list .member")).toHaveCount(1);
    await page.getByRole("button", { name: "添加作品" }).click();
    await page.getByRole("button", { name: /夏日列车/ }).last().click();
    await expect(page.locator(".member-list .member")).toHaveCount(2);
    await page.locator(".member-list .member").nth(1).dragTo(page.locator(".member-list .member").nth(0));
    await expect(page.locator(".member-list .member").first()).toContainText("夏日列车");
    await page.locator(".member-list .member").last().click();
    await page.getByRole("button", { name: "编辑这项" }).click();
    await page.getByRole("textbox", { name: "我的短评" }).fill("特别喜欢叙事节奏");
    await page.getByRole("textbox", { name: "我的短评" }).blur();
    await page.keyboard.press("Escape");
    await expect(page.locator(".member-note")).toContainText("特别喜欢叙事节奏");
    await gamepad.connect();
    await gamepad.press("x");
    await expect(page.getByRole("dialog")).toBeVisible();
    await gamepad.press("b");
    await page.screenshot({ path: testInfo.outputPath("album-1280.png") });
    await page.reload();
    await page.getByRole("button", { name: "藏馆", exact: true }).click();
    await page.getByRole("button", { name: "我的专题 · 1" }).click();
    await page.getByRole("button", { name: /科幻故事收藏/ }).click();
    await expect(page.getByRole("region", { name: "专题 科幻故事收藏" })).toBeVisible();
    await expect(page.locator(".member-list .member").last()).toContainText("星海回声");
    await expect(page.locator(".member-list .member").first()).toContainText("夏日列车");
    await page.getByRole("button", { name: "搜索内容" }).click();
    await page.getByRole("searchbox", { name: "作品名称" }).fill("科幻故事收藏");
    await expect(page.getByText("本机作品与专题 · 可直接打开")).toBeVisible();
    await page.locator(".local-results button").first().click();
    await expect(page.getByRole("region", { name: "专题 科幻故事收藏" })).toBeVisible();
    await page.setViewportSize({ width: 640, height: 400 });
    await expect(page.getByRole("button", { name: "添加作品" })).toBeVisible();
    await expect(page.locator(".member-list .member").first()).toBeInViewport();
    await expect(page.getByRole("button", { name: "继续使用" })).toBeInViewport();
    expect(await page.getByTestId("windows-handheld-shell").evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("album-640.png") });
    await gamepad.connect();
    await gamepad.press("b");
    await expect(page.getByRole("region", { name: "我的专题" })).toBeVisible();
  });
});

test.describe("Bangumi album relations", () => {
  test.use({ appState: { ...state, commandResults: { ...state.commandResults,
    handheld_bangumi_search: [{ subjectId: 100, title: "星海回声", subjectType: 4, cover: null }],
    handheld_bangumi_relations: [{ subjectId: 200, title: "星海回声：前传", relation: "前传", subjectType: 1, cover: null }],
  } }, viewport: { width: 1280, height: 800 } });
  test("requires explicit binding and keeps book recommendations as metadata", async ({ appPage: page }) => {
    await page.getByRole("button", { name: "藏馆", exact: true }).click();
    await page.getByRole("button", { name: "我的专题 · 0" }).click();
    await page.getByPlaceholder("给新专题起个名字").fill("星海系列");
    await page.getByRole("button", { name: "创建专题" }).click();
    await page.getByRole("button", { name: "添加作品" }).click();
    await page.getByRole("button", { name: /星海回声/ }).last().click();
    await page.locator(".member-list .member").first().click();
    await page.getByRole("button", { name: "查看关联" }).click();
    await page.getByPlaceholder("搜索作品标题").fill("星海回声");
    await page.getByRole("button", { name: "搜索条目" }).click();
    await page.getByRole("button", { name: /Bangumi #100/ }).click();
    await expect(page.getByText("星海回声：前传")).toBeVisible();
    await page.getByRole("button", { name: "加入专题" }).click();
    await expect(page.locator(".member-list .member")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await page.locator(".member-list .member").last().click();
    await expect(page.getByText("仅资料 · 尚未绑定可用内容")).toBeVisible();
    await expect(page.getByRole("button", { name: "查找来源" })).toBeVisible();
    await page.getByRole("button", { name: "查看关联" }).click();
    await page.getByRole("button", { name: "关联本机内容" }).click();
    await page.getByRole("textbox", { name: "搜索本机内容进行关联" }).fill("");
    await page.locator(".link-results button").first().click();
    await expect(page.getByRole("status")).toContainText("作品类型不匹配");
    await expect(page.locator(".member-list .member")).toHaveCount(2);
  });
});

for (const [width, height] of [[1280,800],[1920,1200],[2560,1600]]) {
  for (const dpi of [1,1.25,1.5,2]) {
    test.describe(`handheld ${width}x${height} at ${dpi*100}% simulation`, () => {
      test.use({ appState: state, viewport: { width: Math.round(width/dpi), height:Math.round(height/dpi) }, deviceScaleFactor: dpi });
      test("keeps actions visible and opt-in mode stable", async ({ appPage: page }, testInfo) => {
        const shell = page.getByTestId("windows-handheld-shell");
        await expect(shell).toBeVisible();
        if ((width === 1280 && dpi === 1) || (width === 1920 && dpi === 1.5) || (width === 2560 && dpi === 2))
          await page.screenshot({ path: testInfo.outputPath(`home-${width}x${height}-${dpi}.png`) });
        await expect(page.getByRole("button", { name: "快捷面板", exact:true })).toBeInViewport();
        await expect(page.getByRole("button", { name: "藏馆", exact:true })).toBeInViewport();
        expect(await shell.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        await page.getByRole("button", { name:"快捷面板",exact:true }).click();
        await expect(page.getByRole("button", { name:"切回原界面" })).toBeVisible();
        await expect(page.getByRole("slider")).toBeInViewport();
        await page.keyboard.press("Escape");
        expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).mode, profileKey)).toBe("handheld");
      });
    });
  }
}

test.describe("large handheld collection", () => {
  test.use({ appState: { ...state, games: Array.from({length:10000}, (_, i) => ({...MOCK_GAMES[0], id:`large-${i}`,name:`游戏 ${String(i).padStart(5,"0")}`})) } });
  test("renders a bounded window of a 10000-item library", async ({ appPage: page }) => {
    await page.getByRole("button", { name:"藏馆",exact:true }).click();
    await page.getByRole("button", { name:"全部作品",exact:true }).click();
    await expect(page.locator(".section-heading")).toContainText("10000 项内容");
    expect(await page.locator("[data-virtual-item-id]").count()).toBeLessThan(40);
    const scroll = page.getByTestId("handheld-virtual-list");
    await scroll.evaluate(node => node.scrollTop = node.scrollHeight);
    await page.clock.runFor(150);
    expect(await page.locator("[data-virtual-item-id]").count()).toBeLessThan(40);
    await expect(page.locator("[data-virtual-item-id='game:large-9999']")).toBeAttached();
  });
});
