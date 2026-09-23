import { describe, expect, it } from "vitest";
import { adjacentItemIndex, createFocusTransactions, includePinnedRow, restoreFocusId } from "./focus";

describe("handheld focus transactions", () => {
  it("invalidates pending focus for newer input, sorting, resize, or an overlay", () => {
    const context = { listVersion: "a,b", layoutVersion: 1, overlayId: null as string | null };
    const focus = createFocusTransactions(() => context);
    const first = focus.begin("a");
    expect(focus.isCurrent(first)).toBe(true);
    const second = focus.begin("b");
    expect(focus.isCurrent(first)).toBe(false);
    context.listVersion = "b,a";
    expect(focus.isCurrent(second)).toBe(false);
    const sorted = focus.begin("b");
    context.layoutVersion++;
    expect(focus.isCurrent(sorted)).toBe(false);
    const resized = focus.begin("b");
    context.overlayId = "settings";
    expect(focus.isCurrent(resized)).toBe(false);
    const overlay = focus.begin("b");
    focus.cancel();
    expect(focus.isCurrent(overlay)).toBe(false);
  });

  it("restores identity across sorting and finds a surviving neighbour after deletion", () => {
    expect(restoreFocusId(["a", "b", "c"], ["c", "b", "a"], "b")).toBe("b");
    expect(restoreFocusId(["a", "b", "c", "d"], ["d", "a", "c"], "b")).toBe("c");
    expect(restoreFocusId(["a", "b"], ["a"], "b")).toBe("a");
    expect(restoreFocusId(["a"], [], "a")).toBeNull();
  });

  it("pins only one distant row and hands edge navigation to the surrounding scope", () => {
    expect(includePinnedRow([0, 1, 2], 9999, 10000)).toEqual([0, 1, 2, 9999]);
    expect(includePinnedRow([0, 1], 1, 10000)).toEqual([0, 1]);
    expect(includePinnedRow([0, 1], 10000, 10000)).toEqual([0, 1]);
    expect(adjacentItemIndex(3, 10000, 4, "down")).toBe(7);
    expect(adjacentItemIndex(3, 10000, 4, "right")).toBeNull();
    expect(adjacentItemIndex(4, 10000, 4, "left")).toBeNull();
    expect(adjacentItemIndex(9999, 10000, 4, "down")).toBeNull();
  });
});
