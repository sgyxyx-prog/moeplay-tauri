import { getCurrentWindow } from "@tauri-apps/api/window";

/** Container, native DPI and visual viewport changes share one rAF measurement. */
export function observeHandheldLayout(node: HTMLElement, measure: (size: { width: number; height: number }) => void) {
  let frame = 0;
  let disposed = false;
  const releases: (() => void)[] = [];
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (disposed) return;
      const rect = node.getBoundingClientRect();
      measure({ width: rect.width, height: rect.height });
    });
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(node);
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const win = getCurrentWindow();
      for (const promise of [win.onResized(schedule), win.onScaleChanged(schedule)]) {
        void promise.then((release) => disposed ? release() : releases.push(release)).catch(() => {});
      }
    } catch { /* Browser preview. */ }
  }
  schedule();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
    releases.forEach((release) => release());
  };
}

/** A scheduler gap after sleep also pauses media when the OS never hid the window. */
export function observeSessionSuspension() {
  let last = performance.now();
  const pause = () => window.dispatchEvent(new CustomEvent("moeplay:suspend"));
  const visibility = () => { if (document.hidden) pause(); };
  const interval = window.setInterval(() => {
    const now = performance.now();
    if (now - last > 5000) pause();
    last = now;
  }, 1000);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", pause);
  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", pause);
  };
}
