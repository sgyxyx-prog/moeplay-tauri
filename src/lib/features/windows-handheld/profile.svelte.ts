import { platformStore } from "../../platform/runtime.svelte";

export interface DisplayProfile {
  mode: "desktop" | "handheld";
  density: "comfortable" | "compact";
  comfort: number;
  lightEffects: boolean;
  monitors: Record<string, { comfort: number }>;
}
export const DISPLAY_PROFILE_KEY = "moeplay-windows-display-v1";
export function normalizeDisplayProfile(value: unknown): DisplayProfile {
  const v = (value && typeof value === "object" ? value : {}) as Partial<DisplayProfile>;
  return {
    mode: v.mode === "handheld" ? "handheld" : "desktop",
    density: v.density === "compact" ? "compact" : "comfortable",
    comfort: Math.max(90, Math.min(130, typeof v.comfort === "number" && Number.isFinite(v.comfort) ? v.comfort : 100)),
    lightEffects: v.lightEffects !== false,
    monitors: Object.fromEntries(Object.entries(v.monitors && typeof v.monitors === "object" ? v.monitors : {}).filter(([, p]) => p && Number.isFinite(p.comfort)).map(([key, p]) => [key, { comfort: Math.max(90, Math.min(130, p.comfort)) }])),
  };
}
function readProfile(): DisplayProfile {
  try { return normalizeDisplayProfile(JSON.parse(localStorage.getItem(DISPLAY_PROFILE_KEY) ?? "null")); }
  catch { return normalizeDisplayProfile(null); }
}
let profile = $state<DisplayProfile>(readProfile());
export const displayProfile = {
  get profile() { return profile; },
  get enabled() { return profile.mode === "handheld" && !platformStore.isAndroid; },
  update(patch: Partial<DisplayProfile>) {
    profile = normalizeDisplayProfile({ ...profile, ...patch });
    try { localStorage.setItem(DISPLAY_PROFILE_KEY, JSON.stringify(profile)); } catch { /* Session preference still works in restricted storage. */ }
  },
  reload() { profile = readProfile(); },
};

/** Only logical client width affects tokens; never multiply by devicePixelRatio. */
export function displayMetrics(width: number, comfort = 100) {
  const scale = Math.max(0.7, width / 1280) * Math.max(90, Math.min(130, comfort)) / 100;
  return { body: Math.max(14, 18 * scale), auxiliary: Math.max(14, 14 * scale), target: Math.max(44, 48 * scale), gap: Math.max(8, 16 * scale), compact: width < 960 };
}

/** Native rect is in client DIPs. Account for WebView zoom once, and subtract only intersection with the current viewport. */
export function keyboardInset(viewport: { height: number; width: number }, rect: { y: number; height: number; width: number }, dipClientWidth: number) {
  if (rect.height <= 0 || rect.width <= 0 || dipClientWidth <= 0) return 0;
  const ratio = viewport.width / dipClientWidth;
  const top = rect.y * ratio;
  // Floating keyboards do not reduce the whole shell; focused input scrolls into view.
  if (rect.width * ratio < viewport.width * 0.7) return 0;
  return Math.max(0, Math.min(viewport.height, viewport.height - top));
}
