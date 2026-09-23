import { describe, expect, it } from "vitest";
import { displayMetrics, keyboardInset, normalizeDisplayProfile } from "./profile.svelte";

describe("persistent handheld display", () => {
  it("opts in explicitly and clamps corrupt preferences", () => {
    expect(normalizeDisplayProfile(null).mode).toBe("desktop");
    expect(normalizeDisplayProfile({ mode: "auto", comfort: Infinity }).comfort).toBe(100);
    expect(normalizeDisplayProfile({ mode: "handheld", comfort: 500 }).comfort).toBe(130);
  });
  it.each([640, 853, 960, 1024, 1280, 1536, 1920, 2048, 2560])("keeps readable targets at logical width %i", (width) => {
    for (const comfort of [90, 100, 130]) {
      const metrics = displayMetrics(width, comfort);
      expect(metrics.body).toBeGreaterThanOrEqual(14);
      expect(metrics.target).toBeGreaterThanOrEqual(44);
    }
  });
  it("does not subtract keyboard occlusion twice after the window shrinks", () => {
    const rect = { y: 500, height: 300, width: 1280 };
    expect(keyboardInset({ width: 1280, height: 800 }, rect, 1280)).toBe(300);
    expect(keyboardInset({ width: 1280, height: 500 }, rect, 1280)).toBe(0);
    expect(keyboardInset({ width: 640, height: 400 }, rect, 1280)).toBe(150);
    expect(keyboardInset({ width: 1280, height: 800 }, { ...rect, width: 400 }, 1280)).toBe(0);
  });
});
