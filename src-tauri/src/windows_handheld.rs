//! App-scoped Windows touch keyboard and tracked-game activation.
//!
//! InputPane COM objects remain on the Tauri UI thread. The webview receives
//! observed state separately from best-effort show/hide request results.
//! No executable paths, HWNDs, PIDs or system settings are accepted from JS.

use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::sync::{Arc, Mutex};

pub const KEYBOARD_STATE_EVENT: &str = "windows-keyboard-state";

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub struct KeyboardOcclusion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl KeyboardOcclusion {
    #[cfg(any(windows, test))]
    fn sanitized(x: f64, y: f64, width: f64, height: f64) -> Self {
        fn finite(value: f64) -> f64 {
            if value.is_finite() {
                value
            } else {
                0.0
            }
        }
        Self {
            x: finite(x),
            y: finite(y),
            width: finite(width).max(0.0),
            height: finite(height).max(0.0),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsKeyboardState {
    pub available: bool,
    /// Last observed visibility, never set from a TryShow/TryHide result.
    pub visible: bool,
    /// A zero occlusion rectangle alone cannot determine floating keyboard visibility.
    pub visibility_known: bool,
    /// Window client coordinates in device-independent pixels (96 DPI).
    pub occluded: KeyboardOcclusion,
    pub coordinate_space: &'static str,
    /// Width of the same window client area in DIP; use CSS width / clientWidth
    /// when mapping occlusion into a zoomed WebView.
    pub client_width: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl Default for WindowsKeyboardState {
    fn default() -> Self {
        Self {
            available: false,
            visible: false,
            visibility_known: false,
            occluded: KeyboardOcclusion::default(),
            coordinate_space: "dip",
            client_width: 0.0,
            reason: None,
        }
    }
}

impl WindowsKeyboardState {
    fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            reason: Some(reason.into()),
            ..Self::default()
        }
    }

    #[cfg(any(windows, test))]
    fn observe(&mut self, visible: bool, occluded: KeyboardOcclusion) {
        self.available = true;
        self.visible = visible;
        self.visibility_known = true;
        self.occluded = if visible {
            occluded
        } else {
            KeyboardOcclusion::default()
        };
        self.reason = None;
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyboardRequestStatus {
    Requested,
    Unavailable,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct KeyboardRequestResult {
    pub status: KeyboardRequestStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl KeyboardRequestResult {
    fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            status: KeyboardRequestStatus::Unavailable,
            reason: Some(reason.into()),
        }
    }

    #[cfg(windows)]
    fn failed(reason: impl Into<String>) -> Self {
        Self {
            status: KeyboardRequestStatus::Failed,
            reason: Some(reason.into()),
        }
    }

    #[cfg(any(windows, test))]
    fn accepted(accepted: bool) -> Self {
        if accepted {
            Self {
                status: KeyboardRequestStatus::Requested,
                reason: None,
            }
        } else {
            Self::unavailable("Windows 未接受键盘请求；可触摸输入框或使用系统键盘入口")
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GameActivationStatus {
    Activated,
    Denied,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
pub struct GameActivationResult {
    pub status: GameActivationStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl GameActivationResult {
    fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            status: GameActivationStatus::Unavailable,
            reason: Some(reason.into()),
        }
    }

    #[cfg(windows)]
    fn denied(reason: impl Into<String>) -> Self {
        Self {
            status: GameActivationStatus::Denied,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Default)]
pub struct WindowsHandheldState {
    #[cfg(windows)]
    keyboard: Arc<Mutex<WindowsKeyboardState>>,
}

impl WindowsHandheldState {
    #[cfg(windows)]
    fn snapshot(&self) -> WindowsKeyboardState {
        self.keyboard
            .lock()
            .map(|state| state.clone())
            .unwrap_or_else(|_| WindowsKeyboardState::unavailable("键盘状态不可用"))
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyboardSettingsKind {
    Touch,
    Accessibility,
}

impl KeyboardSettingsKind {
    #[cfg(any(windows, test))]
    fn uri(self) -> &'static str {
        match self {
            Self::Touch => "ms-settings:personalization-touchkeyboard",
            Self::Accessibility => "ms-settings:easeofaccess-keyboard",
        }
    }
}

/// Explicit user action only. This opens a settings page; it never changes a setting.
#[tauri::command]
pub fn windows_keyboard_settings(kind: KeyboardSettingsKind) -> KeyboardRequestResult {
    #[cfg(windows)]
    {
        match open::that(kind.uri()) {
            Ok(()) => KeyboardRequestResult::accepted(true),
            Err(error) => KeyboardRequestResult::failed(error.to_string()),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = kind;
        KeyboardRequestResult::unavailable("仅 Windows 支持系统键盘设置入口")
    }
}

#[tauri::command]
pub async fn windows_keyboard_show(window: tauri::WebviewWindow) -> KeyboardRequestResult {
    keyboard_request(window, true).await
}

#[tauri::command]
pub async fn windows_keyboard_hide(window: tauri::WebviewWindow) -> KeyboardRequestResult {
    keyboard_request(window, false).await
}

async fn keyboard_request(window: tauri::WebviewWindow, show: bool) -> KeyboardRequestResult {
    #[cfg(windows)]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let ui_window = window.clone();
        if let Err(error) = window.run_on_main_thread(move || {
            let _ = sender.send(native::keyboard_request(&ui_window, show));
        }) {
            return KeyboardRequestResult::failed(error.to_string());
        }
        receiver
            .await
            .unwrap_or_else(|_| KeyboardRequestResult::failed("键盘请求已取消"))
    }
    #[cfg(not(windows))]
    {
        let _ = (window, show);
        KeyboardRequestResult::unavailable("仅 Windows 支持系统触摸键盘桥接")
    }
}

#[tauri::command]
pub async fn windows_keyboard_status(window: tauri::WebviewWindow) -> WindowsKeyboardState {
    #[cfg(windows)]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let ui_window = window.clone();
        if let Err(error) = window.run_on_main_thread(move || {
            let _ = sender.send(native::keyboard_status(&ui_window));
        }) {
            return WindowsKeyboardState::unavailable(error.to_string());
        }
        receiver
            .await
            .unwrap_or_else(|_| WindowsKeyboardState::unavailable("键盘状态请求已取消"))
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        WindowsKeyboardState::unavailable("仅 Windows 支持系统触摸键盘桥接")
    }
}

#[tauri::command]
pub async fn windows_activate_game(app: tauri::AppHandle, game_id: String) -> GameActivationResult {
    #[cfg(windows)]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let ui_app = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            use tauri::Manager;
            let monitor = ui_app.state::<crate::process_monitor::ProcessMonitor>();
            // The monitor lock remains held through validation and activation. JS
            // cannot nominate a PID and a stopped/unregistered game cannot be used.
            let result = monitor
                .with_tracked_game_processes(&game_id, native::activate_game)
                .unwrap_or_else(|| GameActivationResult::denied("该游戏没有由萌游跟踪的运行进程"));
            let _ = sender.send(result);
        }) {
            return GameActivationResult::unavailable(error.to_string());
        }
        receiver
            .await
            .unwrap_or_else(|_| GameActivationResult::unavailable("游戏窗口请求已取消"))
    }
    #[cfg(not(windows))]
    {
        let _ = (app, game_id);
        GameActivationResult::unavailable("仅 Windows 支持返回游戏窗口")
    }
}

#[cfg(windows)]
pub(crate) fn process_identity(pid: u32) -> Option<u64> {
    native::process_identity(pid)
}

/// Called on the window event/UI thread; drops handlers before their HWND is reused.
#[cfg(windows)]
pub(crate) fn window_destroyed(label: &str) {
    native::window_destroyed(label);
}

#[cfg(windows)]
pub(crate) fn window_metrics_changed(window: &tauri::Window) {
    native::window_metrics_changed(window);
}

#[cfg(windows)]
mod native {
    use super::*;
    use crate::process_monitor::TrackedGameProcess;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use tauri::{Emitter, Manager};
    use windows::{
        core::{factory, BOOL},
        Foundation::{Rect, TypedEventHandler},
        Win32::{
            Foundation::{CloseHandle, FILETIME, HANDLE, HWND, LPARAM, WAIT_TIMEOUT},
            System::{
                Threading::{
                    GetProcessTimes, OpenProcess, WaitForSingleObject,
                    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
                },
                WinRT::IInputPaneInterop,
            },
            UI::WindowsAndMessaging::{
                EnumWindows, GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
                IsWindowVisible, SetForegroundWindow, ShowWindowAsync, SW_RESTORE,
            },
        },
        UI::ViewManagement::{InputPane, InputPaneVisibilityEventArgs},
    };

    struct KeyboardSubscription {
        pane: InputPane,
        showing: i64,
        hiding: i64,
    }

    impl Drop for KeyboardSubscription {
        fn drop(&mut self) {
            let _ = self.pane.RemoveShowing(self.showing);
            let _ = self.pane.RemoveHiding(self.hiding);
        }
    }

    thread_local! {
        static KEYBOARDS: RefCell<HashMap<String, KeyboardSubscription>> = RefCell::new(HashMap::new());
    }

    fn occlusion(rect: Rect) -> KeyboardOcclusion {
        KeyboardOcclusion::sanitized(
            rect.X.into(),
            rect.Y.into(),
            rect.Width.into(),
            rect.Height.into(),
        )
    }

    fn emit_state(window: &tauri::WebviewWindow, state: &WindowsHandheldState) {
        let _ = window.emit_to(window.label(), KEYBOARD_STATE_EVENT, state.snapshot());
    }

    fn client_width(window: &tauri::WebviewWindow) -> f64 {
        match (window.inner_size(), window.scale_factor()) {
            (Ok(size), Ok(scale)) if scale.is_finite() && scale > 0.0 => {
                f64::from(size.width) / scale
            }
            _ => 0.0,
        }
    }

    fn ensure_pane(window: &tauri::WebviewWindow) -> Result<InputPane, String> {
        if window.label() != "main" {
            return Err("触摸键盘仅限主窗口".to_owned());
        }
        if let Some(pane) = KEYBOARDS.with(|keyboards| {
            keyboards
                .borrow()
                .get(window.label())
                .map(|subscription| subscription.pane.clone())
        }) {
            return Ok(pane);
        }
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let interop =
            factory::<InputPane, IInputPaneInterop>().map_err(|error| error.to_string())?;
        // GetForWindow requires the top-level application HWND, not the embedded WebView HWND.
        let pane: InputPane =
            unsafe { interop.GetForWindow(HWND(hwnd.0)) }.map_err(|error| error.to_string())?;
        let state = window.state::<WindowsHandheldState>().inner().clone();
        let showing_window = window.clone();
        let showing_state = state.clone();
        let showing = pane
            .Showing(
                &TypedEventHandler::<InputPane, InputPaneVisibilityEventArgs>::new(
                    move |_, args| {
                        let rect = args
                            .as_ref()
                            .and_then(|args| args.OccludedRect().ok())
                            .map(occlusion)
                            .unwrap_or_default();
                        let width = client_width(&showing_window);
                        if let Ok(mut snapshot) = showing_state.keyboard.lock() {
                            snapshot.observe(true, rect);
                            snapshot.client_width = width;
                        }
                        emit_state(&showing_window, &showing_state);
                        Ok(())
                    },
                ),
            )
            .map_err(|error| error.to_string())?;
        let hiding_window = window.clone();
        let hiding_state = state.clone();
        let hiding = match pane.Hiding(
            &TypedEventHandler::<InputPane, InputPaneVisibilityEventArgs>::new(move |_, _| {
                let width = client_width(&hiding_window);
                if let Ok(mut snapshot) = hiding_state.keyboard.lock() {
                    snapshot.observe(false, KeyboardOcclusion::default());
                    snapshot.client_width = width;
                }
                emit_state(&hiding_window, &hiding_state);
                Ok(())
            }),
        ) {
            Ok(token) => token,
            Err(error) => {
                let _ = pane.RemoveShowing(showing);
                return Err(error.to_string());
            }
        };
        let initial_rect = pane.OccludedRect().ok();
        let width = client_width(window);
        if let Ok(mut snapshot) = state.keyboard.lock() {
            snapshot.available = true;
            snapshot.client_width = width;
            snapshot.reason = None;
            if let Some(rect) = initial_rect {
                snapshot.occluded = occlusion(rect);
                if rect.Y > 0.0 && rect.Width > 0.0 && rect.Height > 0.0 {
                    snapshot.observe(true, occlusion(rect));
                }
            }
        }
        KEYBOARDS.with(|keyboards| {
            keyboards.borrow_mut().insert(
                window.label().to_owned(),
                KeyboardSubscription {
                    pane: pane.clone(),
                    showing,
                    hiding,
                },
            )
        });
        Ok(pane)
    }

    pub(super) fn keyboard_status(window: &tauri::WebviewWindow) -> WindowsKeyboardState {
        let state = window.state::<WindowsHandheldState>();
        match ensure_pane(window) {
            Ok(pane) => {
                let width = client_width(window);
                if let Ok(rect) = pane.OccludedRect() {
                    if let Ok(mut snapshot) = state.keyboard.lock() {
                        snapshot.occluded = occlusion(rect);
                        snapshot.client_width = width;
                    }
                }
                state.snapshot()
            }
            Err(reason) => {
                let unavailable = WindowsKeyboardState::unavailable(reason);
                if let Ok(mut snapshot) = state.keyboard.lock() {
                    *snapshot = unavailable.clone();
                }
                unavailable
            }
        }
    }

    pub(super) fn keyboard_request(
        window: &tauri::WebviewWindow,
        show: bool,
    ) -> KeyboardRequestResult {
        let pane = match ensure_pane(window) {
            Ok(pane) => pane,
            Err(reason) => return KeyboardRequestResult::unavailable(reason),
        };
        let result = if show { pane.TryShow() } else { pane.TryHide() };
        match result {
            Ok(accepted) => KeyboardRequestResult::accepted(accepted),
            Err(error) => KeyboardRequestResult::failed(error.to_string()),
        }
    }

    pub(super) fn window_destroyed(label: &str) {
        KEYBOARDS.with(|keyboards| {
            keyboards.borrow_mut().remove(label);
        });
    }

    pub(super) fn window_metrics_changed(window: &tauri::Window) {
        // Do not initialize COM during early setup/resizes. Once subscribed,
        // refresh client DIP dimensions after a monitor/DPI/resolution change.
        if !KEYBOARDS.with(|keyboards| keyboards.borrow().contains_key(window.label())) {
            return;
        }
        if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
            let snapshot = keyboard_status(&webview);
            let _ = webview.emit_to(webview.label(), KEYBOARD_STATE_EVENT, snapshot);
        }
    }

    struct ProcessHandle(HANDLE);

    impl ProcessHandle {
        fn open(pid: u32) -> Option<Self> {
            unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                    false,
                    pid,
                )
            }
            .ok()
            .map(Self)
        }

        fn identity(&self) -> Option<u64> {
            let (mut created, mut exited, mut kernel, mut user) = (
                FILETIME::default(),
                FILETIME::default(),
                FILETIME::default(),
                FILETIME::default(),
            );
            unsafe { GetProcessTimes(self.0, &mut created, &mut exited, &mut kernel, &mut user) }
                .ok()?;
            Some((u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime))
        }

        fn running(&self) -> bool {
            unsafe { WaitForSingleObject(self.0, 0) == WAIT_TIMEOUT }
        }
    }

    impl Drop for ProcessHandle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    pub(super) fn process_identity(pid: u32) -> Option<u64> {
        ProcessHandle::open(pid)?.identity()
    }

    struct WindowSearch {
        pid: u32,
        found: Option<HWND>,
    }

    unsafe extern "system" fn find_game_window(hwnd: HWND, data: LPARAM) -> BOOL {
        // EnumWindows invokes this synchronously while `search` remains on the stack.
        let search = unsafe { &mut *(data.0 as *mut WindowSearch) };
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        if pid == search.pid && unsafe { IsWindowVisible(hwnd).as_bool() } {
            search.found = Some(hwnd);
            return BOOL(0);
        }
        BOOL(1)
    }

    pub(super) fn activate_game(processes: &[TrackedGameProcess]) -> GameActivationResult {
        for tracked in processes {
            let Some(process) = ProcessHandle::open(tracked.pid) else {
                continue;
            };
            // Creation time prevents a stale tracked PID from activating an unrelated reused PID.
            if tracked.identity.is_none()
                || process.identity() != tracked.identity
                || !process.running()
            {
                continue;
            }
            let mut search = WindowSearch {
                pid: tracked.pid,
                found: None,
            };
            unsafe {
                let _ = EnumWindows(
                    Some(find_game_window),
                    LPARAM((&mut search as *mut WindowSearch) as isize),
                );
            }
            let Some(hwnd) = search.found else {
                continue;
            };
            let mut owner = 0;
            unsafe {
                GetWindowThreadProcessId(hwnd, Some(&mut owner));
            }
            if owner != tracked.pid || !process.running() {
                continue;
            }
            unsafe {
                if IsIconic(hwnd).as_bool() {
                    let _ = ShowWindowAsync(hwnd, SW_RESTORE);
                }
                if SetForegroundWindow(hwnd).as_bool() && GetForegroundWindow() == hwnd {
                    return GameActivationResult {
                        status: GameActivationStatus::Activated,
                        reason: None,
                    };
                }
            }
            return GameActivationResult::denied("Windows 未允许切换到游戏窗口，请从任务栏切换");
        }
        GameActivationResult::unavailable("未找到仍在运行且身份匹配的游戏窗口")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepted_keyboard_request_does_not_claim_visible() {
        let state = WindowsKeyboardState::default();
        assert_eq!(
            KeyboardRequestResult::accepted(true).status,
            KeyboardRequestStatus::Requested
        );
        assert!(!state.visible);
        assert!(!state.visibility_known);
        assert_eq!(
            KeyboardRequestResult::accepted(false).status,
            KeyboardRequestStatus::Unavailable
        );
    }

    #[test]
    fn floating_keyboard_can_be_visible_without_occlusion() {
        let mut state = WindowsKeyboardState::default();
        state.observe(true, KeyboardOcclusion::default());
        assert!(state.visible && state.visibility_known);
        assert_eq!(state.occluded.height, 0.0);
        state.observe(
            false,
            KeyboardOcclusion::sanitized(0.0, 400.0, 800.0, 300.0),
        );
        assert!(!state.visible);
        assert_eq!(state.occluded, KeyboardOcclusion::default());
    }

    #[test]
    fn occlusion_is_finite_and_uses_explicit_client_dip_units() {
        let rect = KeyboardOcclusion::sanitized(f64::NAN, -12.0, f64::INFINITY, -3.0);
        assert_eq!(
            rect,
            KeyboardOcclusion {
                x: 0.0,
                y: -12.0,
                width: 0.0,
                height: 0.0
            }
        );
        let serialized = serde_json::to_value(WindowsKeyboardState::default()).unwrap();
        assert_eq!(serialized["coordinateSpace"], "dip");
        assert_eq!(serialized["visibilityKnown"], false);
        assert_eq!(serialized["clientWidth"], 0.0);
    }

    #[test]
    fn keyboard_settings_accept_only_two_fixed_pages() {
        assert_eq!(
            KeyboardSettingsKind::Touch.uri(),
            "ms-settings:personalization-touchkeyboard"
        );
        assert_eq!(
            KeyboardSettingsKind::Accessibility.uri(),
            "ms-settings:easeofaccess-keyboard"
        );
        assert!(serde_json::from_str::<KeyboardSettingsKind>("\"ms-settings:privacy\"").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn activation_rejects_reused_pid_identity_before_window_lookup() {
        let pid = std::process::id();
        let identity = native::process_identity(pid).expect("own process identity is readable");
        let result = native::activate_game(&[crate::process_monitor::TrackedGameProcess {
            pid,
            identity: Some(identity.wrapping_add(1)),
        }]);
        assert_eq!(result.status, GameActivationStatus::Unavailable);
    }
}
