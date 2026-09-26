import { afterEach, describe, expect, it, vi } from "vitest";
import type { GamepadHandlers } from "../../components/switch/useGamepad.svelte";
import { createMediaPauseGuard, mediaSurface } from "./mediaSession";
import { closeTopOverlay, routerStore } from "../../stores/router.svelte";

const scopes = vi.hoisted(() => [] as Array<{ handlers: GamepadHandlers; priority: number; detached: boolean }>);
vi.mock("../../components/switch/useGamepad.svelte", () => ({
  attachGamepad: (handlers: GamepadHandlers, options: { priority: number }) => {
    const scope = { handlers, priority: options.priority, detached: false };
    scopes.push(scope);
    return Object.assign(() => { scope.detached = true; }, {
      updateHandlers: (next: GamepadHandlers) => { scope.handlers = next; },
    });
  },
}));

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  while (routerStore.topOverlay) closeTopOverlay();
  scopes.length = 0;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function surface(markup: string) {
  const node = document.createElement("div");
  node.innerHTML = markup;
  document.body.append(node);
  return node;
}

describe("Windows media surface ownership", () => {
  it("keeps desktop and Android surfaces outside the Windows input stack", () => {
    const node = surface("<button>reader</button>");
    const action = mediaSurface(node, { enabled: false, id: "reader", onBack: vi.fn() });
    cleanups.push(action.destroy);
    expect(scopes).toHaveLength(0);
    expect(routerStore.topOverlay).toBeNull();
  });

  it("closes only a chapter panel and restores its trigger without moving the reader", async () => {
    const node = surface('<button id="chapter-trigger">chapters</button>');
    node.scrollTop = 720;
    const leaveReader = vi.fn();
    const reader = mediaSurface(node, { enabled: true, id: "reader", onBack: leaveReader });
    cleanups.push(reader.destroy);
    const trigger = node.querySelector<HTMLButtonElement>("button")!;
    trigger.focus();
    const panel = surface("<button>Chapter 20</button>");
    const closePanel = vi.fn(() => { chapters.destroy(); panel.remove(); });
    const chapters = mediaSurface(panel, { enabled: true, id: "chapters", menu: true, onBack: closePanel });
    cleanups.push(chapters.destroy);
    await Promise.resolve();
    expect(routerStore.topOverlay?.id).toBe("chapters");
    expect(scopes.map(scope => scope.priority)).toEqual([120, 130]);
    scopes[1].handlers.back?.();
    await Promise.resolve();
    expect(closePanel).toHaveBeenCalledOnce();
    expect(leaveReader).not.toHaveBeenCalled();
    expect(routerStore.topOverlay?.id).toBe("reader");
    expect(document.activeElement).toBe(trigger);
    expect(node.scrollTop).toBe(720);
  });

  it("routes direction into virtual chapters and lets Escape close one panel", async () => {
    const node = surface("<button>Chapter 999</button>");
    const moved = vi.fn();
    node.addEventListener("moeplay:virtual-navigate", event => {
      const request = (event as CustomEvent<{ direction: string; handled: boolean }>).detail;
      request.handled = true;
      moved(request.direction);
    });
    const onBack = vi.fn();
    const action = mediaSurface(node, { enabled: true, id: "chapters", menu: true, onBack });
    cleanups.push(action.destroy);
    await Promise.resolve();
    scopes[0].handlers.down?.();
    expect(moved).toHaveBeenCalledWith("down");
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    node.querySelector("button")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onBack).toHaveBeenCalledOnce();
    expect(routerStore.topOverlay).toBeNull();
  });
});

describe("suspend playback latch", () => {
  it("retains the video and position across sleep and rejects delayed autoplay until explicit play", () => {
    const video = document.createElement("video");
    video.src = "https://example.test/episode.mp4";
    video.currentTime = 126;
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
    const save = vi.fn();
    const guard = createMediaPauseGuard(() => video, () => true, save);
    cleanups.push(guard.mount());
    window.dispatchEvent(new Event("moeplay:suspend"));
    window.dispatchEvent(new Event("moeplay:resume"));
    expect(guard.blocked).toBe(true);
    expect(guard.acceptPlay()).toBe(false);
    expect(pause).toHaveBeenCalledTimes(3);
    expect(video.currentTime).toBe(126);
    expect(video.src).toBe("https://example.test/episode.mp4");
    expect(save).toHaveBeenCalledTimes(2);
    guard.allowPlayback();
    expect(guard.acceptPlay()).toBe(true);
    expect(guard.blocked).toBe(false);
  });

  it("does not change existing playback behavior when the Windows profile is disabled", () => {
    const video = document.createElement("video");
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
    const guard = createMediaPauseGuard(() => video, () => false);
    cleanups.push(guard.mount());
    window.dispatchEvent(new Event("moeplay:suspend"));
    expect(pause).not.toHaveBeenCalled();
    expect(guard.acceptPlay()).toBe(true);
  });
});
