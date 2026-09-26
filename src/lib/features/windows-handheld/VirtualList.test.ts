import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import Harness from "./VirtualListHarness.svelte";
import { closeOverlay, openOverlay, resetRouterState } from "../../stores/router.svelte";

const resizeCallbacks = new Set<ResizeObserverCallback>();
class TestResizeObserver {
  constructor(private callback: ResizeObserverCallback) { resizeCallbacks.add(callback); }
  observe() {}
  unobserve() {}
  disconnect() { resizeCallbacks.delete(this.callback); }
}

beforeEach(() => {
  resetRouterState();
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(640);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (this: HTMLElement, options: number | ScrollToOptions) {
    if (typeof options === "object") this.scrollTop = options.top ?? this.scrollTop;
    this.dispatchEvent(new Event("scroll"));
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resizeCallbacks.clear(); resetRouterState(); });

describe("VirtualList", () => {
  it("restores the saved viewport offset before focusing an already visible item", async () => {
    const { component, getByTestId } = render(Harness, {
      items: Array.from({ length: 1000 }, (_, i) => String(i)), initialScrollOffset: 600,
    });
    await tick();
    const scroll = getByTestId("handheld-virtual-list");
    expect(scroll.scrollTop).toBe(600);
    expect(await component.focusItem("12")).toBe(true);
    expect(scroll.scrollTop).toBe(600);
  });

  it("keeps a 10,000-item DOM bounded while focusing and navigating to a distant item", async () => {
    const { component, container, getByTestId } = render(Harness, { items: Array.from({ length: 10000 }, (_, i) => String(i)), columns: 4 });
    await tick();
    expect(container.querySelectorAll("[data-virtual-item-id]").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("[data-virtual-item-id]").length).toBeLessThan(80);
    expect(await component.focusItem("9000")).toBe(true);
    expect(document.activeElement).toBe(getByTestId("item-9000"));
    const detail = { direction: "down", handled: false };
    document.activeElement!.dispatchEvent(new CustomEvent("moeplay:virtual-navigate", { bubbles: true, detail }));
    expect(detail.handled).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(getByTestId("item-9004")));
    expect(container.querySelectorAll("[data-virtual-item-id]").length).toBeLessThan(80);
  });

  it("cancels stale focus on overlay/newer input and preserves identity through sort/deletion", async () => {
    const { component, getByTestId, rerender } = render(Harness, { items: ["a", "b", "c", "d"] });
    await tick();
    const pending = component.focusItem("c");
    openOverlay({ id: "test-overlay", kind: "dialog", returnFocusKey: null }, () => {});
    expect(await pending).toBe(false);
    closeOverlay("test-overlay");
    await tick();
    const old = component.focusItem("a");
    const next = component.focusItem("b");
    expect(await old).toBe(false);
    expect(await next).toBe(true);
    await rerender({ items: ["d", "c", "b", "a"] });
    await waitFor(() => expect(document.activeElement).toBe(getByTestId("item-b")));
    await rerender({ items: ["d", "c", "a"] });
    await waitFor(() => expect(document.activeElement).toBe(getByTestId("item-a")));
  });

  it("does not steal focus from other controls or another application on resize", async () => {
    const { component, getByTestId } = render(Harness, { items: ["a", "b"] });
    await tick();
    await component.focusItem("a");
    getByTestId("outside").focus();
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    await tick();
    expect(document.activeElement).toBe(getByTestId("outside"));
    await component.focusItem("b");
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const focus = vi.spyOn(getByTestId("item-b"), "focus");
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    await tick();
    expect(focus).not.toHaveBeenCalled();
    vi.mocked(document.hasFocus).mockReturnValue(true);
    await fireEvent.keyDown(getByTestId("item-b"), { key: "ArrowUp" });
    await waitFor(() => expect(document.activeElement).toBe(getByTestId("item-a")));
  });
});
