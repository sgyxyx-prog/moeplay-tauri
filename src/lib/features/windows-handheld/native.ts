import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeCmd, isMockEnabled } from "../../api/core";

export interface KeyboardOcclusion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowsKeyboardState {
  available: boolean;
  /** Last observed visibility; check visibilityKnown before treating it as authoritative. */
  visible: boolean;
  visibilityKnown: boolean;
  /** Top-level window client coordinates, 96-DPI device-independent pixels. */
  occluded: KeyboardOcclusion;
  coordinateSpace: "dip";
  /** Width of the same client coordinate space; CSS client width / this value maps to CSS pixels. */
  clientWidth: number;
  reason?: string;
}

export interface WindowsKeyboardRequestResult {
  /** requested means Windows accepted a best-effort request, not that a keyboard is visible. */
  status: "requested" | "unavailable" | "failed";
  reason?: string;
}

export interface WindowsGameActivationResult {
  status: "activated" | "denied" | "unavailable";
  reason?: string;
}

export const WINDOWS_KEYBOARD_STATE_EVENT = "windows-keyboard-state";

function nativeAvailable(): boolean {
  return isMockEnabled() || isTauri();
}

export function unavailableKeyboardState(reason = "系统键盘桥接不可用"): WindowsKeyboardState {
  return {
    available: false, visible: false, visibilityKnown: false,
    occluded: { x: 0, y: 0, width: 0, height: 0 }, coordinateSpace: "dip", clientWidth: 0, reason,
  };
}

export async function showSystemKeyboard(): Promise<WindowsKeyboardRequestResult> {
  if (!nativeAvailable()) return { status: "unavailable", reason: "当前不是原生 Windows 应用" };
  try { return await invokeCmd<WindowsKeyboardRequestResult>("windows_keyboard_show"); }
  catch (error) { return { status: "failed", reason: String(error) }; }
}

export async function hideSystemKeyboard(): Promise<WindowsKeyboardRequestResult> {
  if (!nativeAvailable()) return { status: "unavailable", reason: "当前不是原生 Windows 应用" };
  try { return await invokeCmd<WindowsKeyboardRequestResult>("windows_keyboard_hide"); }
  catch (error) { return { status: "failed", reason: String(error) }; }
}

export async function getSystemKeyboardState(): Promise<WindowsKeyboardState> {
  if (!nativeAvailable()) return unavailableKeyboardState();
  try { return await invokeCmd<WindowsKeyboardState>("windows_keyboard_status"); }
  catch (error) { return unavailableKeyboardState(String(error)); }
}

/** Subscribe before requesting the initial status so Showing/Hiding cannot be missed during setup. */
export async function onSystemKeyboardState(
  callback: (state: WindowsKeyboardState) => void,
): Promise<UnlistenFn> {
  if (!nativeAvailable()) return () => {};
  return listen<WindowsKeyboardState>(WINDOWS_KEYBOARD_STATE_EVENT, event => callback(event.payload));
}

/** Only a database game ID is sent. PID/HWND resolution and ownership validation stay native. */
export async function activateRunningGame(gameId: string): Promise<WindowsGameActivationResult> {
  if (!nativeAvailable()) return { status: "unavailable", reason: "当前不是原生 Windows 应用" };
  try { return await invokeCmd<WindowsGameActivationResult>("windows_activate_game", { gameId }); }
  catch (error) { return { status: "unavailable", reason: String(error) }; }
}

export async function openKeyboardSettings(kind: "touch" | "accessibility"): Promise<WindowsKeyboardRequestResult> {
  if (!nativeAvailable()) return { status: "unavailable", reason: "当前不是原生 Windows 应用" };
  try { return await invokeCmd<WindowsKeyboardRequestResult>("windows_keyboard_settings", { kind }); }
  catch (error) { return { status: "failed", reason: String(error) }; }
}

/** Match the native DIP client width to the actual CSS client width; no duplicate DPI scaling. */
export function keyboardOcclusionToCss(
  rect: KeyboardOcclusion,
  nativeClientWidth: number,
  cssClientWidth: number,
): KeyboardOcclusion {
  const positive = (value: number) => Number.isFinite(value) && value > 0;
  const factor = positive(cssClientWidth) && positive(nativeClientWidth)
    ? cssClientWidth / nativeClientWidth : 1;
  const finite = (value: number) => Number.isFinite(value) ? value : 0;
  return {
    x: finite(rect.x) * factor, y: finite(rect.y) * factor,
    width: Math.max(0, finite(rect.width)) * factor,
    height: Math.max(0, finite(rect.height)) * factor,
  };
}
