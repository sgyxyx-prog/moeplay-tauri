import { attachGamepad, type GamepadAttachment, type GamepadHandlers } from "../../components/switch/useGamepad.svelte";
import { activateGamepadFocus, moveGamepadFocus } from "../../actions/a11y/domGamepadNavigation";
import { adjustFocusedGamepadControl } from "../../actions/a11y/gamepadSemantics";
import { focusTrap } from "../../actions/a11y/focusTrap";
import { closeOverlay, closeTopOverlay, openOverlay, routerStore } from "../../stores/router.svelte";

export interface MediaSurfaceOptions {
  enabled: boolean;
  id: string;
  onBack: () => void;
  handlers?: GamepadHandlers;
  menu?: boolean;
  initialFocus?: string;
}

/** One router layer owns both the visible surface and its controller input. */
export function mediaSurface(node: HTMLElement, initial: MediaSurfaceOptions) {
  let options = initial;
  let scope: GamepadAttachment | null = null;
  let trap: ReturnType<typeof focusTrap> | null = null;
  let registeredId: string | null = null;
  const back = () => {
    if (routerStore.topOverlay?.id === options.id) closeTopOverlay();
  };
  const move = (direction: "up" | "down" | "left" | "right") => {
    const request = { direction, handled: false };
    document.activeElement?.dispatchEvent(new CustomEvent("moeplay:virtual-navigate", { bubbles: true, detail: request }));
    if (request.handled) return;
    if (!adjustFocusedGamepadControl(direction)) moveGamepadFocus(direction, { root: node });
  };
  const handlers = (): GamepadHandlers => ({
    up: () => move("up"), down: () => move("down"),
    left: () => move("left"), right: () => move("right"),
    launch: () => { activateGamepadFocus({ root: node }); },
    ...options.handlers,
    back,
  });
  function stop() {
    scope?.(); scope = null;
    trap?.destroy(); trap = null;
    if (registeredId) closeOverlay(registeredId);
    registeredId = null;
  }
  function sync() {
    if (!options.enabled) { stop(); return; }
    if (registeredId && registeredId !== options.id) stop();
    if (!scope) {
      registeredId = options.id;
      openOverlay({ id: options.id, kind: options.menu ? "drawer" : "overlay" }, () => options.onBack());
      scope = attachGamepad(handlers(), { id: options.id, overlay: true, priority: options.menu ? 130 : 120 });
      if (options.menu) trap = focusTrap(node, {
        initialFocus: options.initialFocus, returnFocus: true, onEscape: back,
      });
    } else scope.updateHandlers(handlers());
  }
  function onKeydown(event: KeyboardEvent) {
    if (!options.enabled || !options.menu || event.defaultPrevented) return;
    const direction = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[event.key as "ArrowUp"];
    if (!direction) return;
    if (event.target instanceof HTMLElement && event.target.matches("input:not([type=range]), textarea, [contenteditable=true]")) return;
    event.preventDefault(); event.stopPropagation(); move(direction);
  }
  node.addEventListener("keydown", onKeydown);
  sync();
  return {
    update(next: MediaSurfaceOptions) { options = next; sync(); },
    destroy() { node.removeEventListener("keydown", onKeydown); stop(); },
  };
}

/** Suspend never rebuilds media or resumes it without a new user play action. */
export function createMediaPauseGuard(
  video: () => HTMLVideoElement | null,
  enabled: () => boolean,
  onSuspend: () => void = () => {},
) {
  let blocked = false;
  const suspend = () => {
    if (!enabled()) return;
    blocked = true;
    video()?.pause();
    onSuspend();
  };
  return {
    get blocked() { return enabled() && blocked; },
    suspend,
    allowPlayback() { blocked = false; },
    acceptPlay() {
      if (enabled() && blocked) { video()?.pause(); return false; }
      return true;
    },
    mount() {
      const visibility = () => { if (document.hidden) suspend(); };
      document.addEventListener("visibilitychange", visibility);
      document.addEventListener("freeze", suspend);
      window.addEventListener("pagehide", suspend);
      window.addEventListener("moeplay:suspend", suspend);
      window.addEventListener("moeplay:resume", suspend);
      return () => {
        document.removeEventListener("visibilitychange", visibility);
        document.removeEventListener("freeze", suspend);
        window.removeEventListener("pagehide", suspend);
        window.removeEventListener("moeplay:suspend", suspend);
        window.removeEventListener("moeplay:resume", suspend);
      };
    },
  };
}
