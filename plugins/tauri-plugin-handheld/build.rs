const COMMANDS: &[&str] = &[
    "list_emulators",
    "launch_game",
    "has_all_files_access",
    "request_all_files_access",
    "discover_rom_roots",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
