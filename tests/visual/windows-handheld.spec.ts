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
    await page.getByRole("button", { name: "作品操作", exact: true }).click();
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

test.describe("personal work album", () => {
  test.use({ appState: state, viewport: { width: 1280, height: 800 } });
  test("creates, arranges and restores a playable album", async ({ appPage: page, gamepad }, testInfo) => {
    await page.getByRole("button", { name: "藏馆", exact: true }).click();
    await page.getByPlaceholder("给新专题起个名字").fill("科幻故事收藏");
    await page.getByRole("button", { name: "创建专题" }).click();
    await expect(page.getByRole("region", { name: "专题 科幻故事收藏" })).toBeVisible();
    await page.getByRole("button", { name: "＋ 添加本机作品" }).click();
    await page.getByRole("button", { name: /星海回声/ }).last().click();
    await expect(page.locator(".member-list .member")).toHaveCount(1);
    await page.getByRole("button", { name: "＋ 添加本机作品" }).click();
    await page.getByRole("button", { name: /夏日列车/ }).last().click();
    await expect(page.locator(".member-list .member")).toHaveCount(2);
    await page.locator(".member-list .member").nth(1).dragTo(page.locator(".member-list .member").nth(0));
    await expect(page.locator(".member-list .member").first()).toContainText("夏日列车");
    await page.locator(".member-list .member").last().click();
    await page.getByRole("textbox", { name: "我的短评" }).fill("特别喜欢叙事节奏");
    await page.getByRole("textbox", { name: "我的短评" }).blur();
    await expect(page.locator(".own-note")).toContainText("特别喜欢叙事节奏");
    await gamepad.connect();
    await gamepad.press("x");
    await expect(page.getByRole("dialog")).toBeVisible();
    await gamepad.press("b");
    await page.screenshot({ path: testInfo.outputPath("album-1280.png") });
    await page.reload();
    await page.getByRole("button", { name: "藏馆", exact: true }).click();
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
    await expect(page.getByRole("button", { name: "＋ 添加本机作品" })).toBeVisible();
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
    await page.getByPlaceholder("给新专题起个名字").fill("星海系列");
    await page.getByRole("button", { name: "创建专题" }).click();
    await page.getByRole("button", { name: "＋ 添加本机作品" }).click();
    await page.getByRole("button", { name: /星海回声/ }).last().click();
    await page.getByPlaceholder("搜索 Bangumi 标题").fill("星海回声");
    await page.getByRole("button", { name: "搜索条目" }).click();
    await page.getByRole("button", { name: /Bangumi #100/ }).click();
    await expect(page.getByText("星海回声：前传")).toBeVisible();
    await page.getByRole("button", { name: "加入专题" }).click();
    await expect(page.locator(".member-list .member")).toHaveCount(2);
    await page.locator(".member-list .member").last().click();
    await expect(page.getByText("仅资料 · 需要关联本机内容")).toBeVisible();
    await expect(page.getByRole("button", { name: "查找来源" })).toBeVisible();
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
