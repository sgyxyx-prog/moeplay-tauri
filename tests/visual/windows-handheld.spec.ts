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
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).mode, profileKey)).toBe("handheld");
  });
});

test.describe("Windows handheld interaction", () => {
  test.use({ appState: state, viewport: { width: 1280, height: 800 } });
  test("preserves selection across resolution changes, panels and inner routes", async ({ appPage: page, gamepad }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await expect(page.getByTestId("windows-handheld-shell")).toBeVisible();
    await page.getByRole("button", { name: "内容库", exact: true }).click();
    const rows = page.locator(".content-row");
    await expect(rows.first()).toBeVisible();
    await rows.nth(1).click();
    const id = await rows.nth(1).getAttribute("data-focus-key");
    await gamepad.connect();
    await gamepad.press("x");
    await expect(page.getByRole("dialog")).toBeVisible();
    await gamepad.press("b");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    for (const size of [{width:640,height:400},{width:1280,height:800},{width:1920,height:1200},{width:2560,height:1600},{width:1280,height:800}]) {
      await page.setViewportSize(size);
      await page.clock.runFor(100);
      await expect(page.locator(".content-row.selected")).toHaveAttribute("data-focus-key", id!);
    }
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("button", { name: "详情与章节" }).click();
    await expect(page.getByRole("button", { name: "← 返回内容库" })).toBeVisible();
    await page.getByRole("button", { name: "← 返回内容库" }).click();
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

for (const [width, height] of [[1280,800],[1920,1200],[2560,1600]]) {
  for (const dpi of [1,1.25,1.5,2]) {
    test.describe(`handheld ${width}x${height} at ${dpi*100}% simulation`, () => {
      test.use({ appState: state, viewport: { width: Math.round(width/dpi), height:Math.round(height/dpi) }, deviceScaleFactor: dpi });
      test("keeps actions visible and opt-in mode stable", async ({ appPage: page }) => {
        const shell = page.getByTestId("windows-handheld-shell");
        await expect(shell).toBeVisible();
        await expect(page.getByRole("button", { name: "快捷面板", exact:true })).toBeInViewport();
        await expect(page.getByRole("button", { name: "内容库", exact:true })).toBeInViewport();
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
    await page.getByRole("button", { name:"内容库",exact:true }).click();
    await expect(page.locator(".section-heading")).toContainText("10000 项内容");
    expect(await page.locator("[data-virtual-item-id]").count()).toBeLessThan(40);
    const scroll = page.getByTestId("handheld-virtual-list");
    await scroll.evaluate(node => node.scrollTop = node.scrollHeight);
    await page.clock.runFor(150);
    expect(await page.locator("[data-virtual-item-id]").count()).toBeLessThan(40);
    await expect(page.locator("[data-virtual-item-id='game:large-9999']")).toBeAttached();
  });
});
