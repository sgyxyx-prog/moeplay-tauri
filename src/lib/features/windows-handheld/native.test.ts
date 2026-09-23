import { afterEach, describe, expect, it } from "vitest";
import { clearMockInvokeHandler, setMockInvokeHandler } from "../../api/core";
import { activateRunningGame, getSystemKeyboardState, keyboardOcclusionToCss, openKeyboardSettings, showSystemKeyboard, unavailableKeyboardState } from "./native";

afterEach(clearMockInvokeHandler);

describe("Windows handheld native boundaries", () => {
  it("keeps an accepted show request separate from observed keyboard state", async () => {
    setMockInvokeHandler(command => command === "windows_keyboard_show"
      ? { status: "requested" }
      : { ...unavailableKeyboardState(), available: true });
    expect(await showSystemKeyboard()).toEqual({ status: "requested" });
    expect(await getSystemKeyboardState()).toMatchObject({ visible: false, visibilityKnown: false });
  });

  it("sends only a game ID and preserves native foreground denial", async () => {
    const calls: unknown[] = [];
    setMockInvokeHandler((command, args) => {
      calls.push({ command, args });
      return { status: "denied", reason: "foreground lock" };
    });
    expect(await activateRunningGame("game-a")).toEqual({ status: "denied", reason: "foreground lock" });
    expect(calls).toEqual([{ command: "windows_activate_game", args: { gameId: "game-a" } }]);
  });

  it("converts DIP occlusion using both OS scaling and WebView zoom", () => {
    const rect = { x: 0, y: 300, width: 800, height: 200 };
    expect(keyboardOcclusionToCss(rect, 800, 800)).toEqual(rect);
    expect(keyboardOcclusionToCss(rect, 800, 640)).toEqual({ x: 0, y: 240, width: 640, height: 160 });
    expect(keyboardOcclusionToCss(rect, 0, 640)).toEqual(rect);
    expect(keyboardOcclusionToCss({ x: NaN, y: 0, width: Infinity, height: -5 }, 0, NaN))
      .toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("opens only the requested fixed keyboard settings kind", async () => {
    const calls: unknown[] = [];
    setMockInvokeHandler((command, args) => { calls.push({ command, args }); return { status: "requested" }; });
    await openKeyboardSettings("touch");
    expect(calls).toEqual([{ command: "windows_keyboard_settings", args: { kind: "touch" } }]);
  });
});
