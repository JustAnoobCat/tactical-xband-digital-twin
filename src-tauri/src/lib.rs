//! Tactical X-Band Air-to-Ground Network Digital Twin — Tauri v2 Desktop Host.

pub mod tile_protocol;

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct RuntimeDiagnostics {
    pub runtime: &'static str,
    pub os: &'static str,
    pub arch: &'static str,
    pub pid: u32,
    pub tiles_root: String,
    pub airgap_enforced: bool,
}

#[tauri::command]
fn get_runtime_diagnostics(app: tauri::AppHandle) -> Result<RuntimeDiagnostics, String> {
    let tiles_root = tile_protocol::resolve_writable_tiles_dir(&app)?;
    Ok(RuntimeDiagnostics {
        runtime: "tauri-v2",
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        pid: std::process::id(),
        tiles_root: tiles_root.to_string_lossy().into_owned(),
        airgap_enforced: true,
    })
}

#[tauri::command]
fn get_tiles_directory(app: tauri::AppHandle) -> Result<String, String> {
    let dir = tile_protocol::resolve_writable_tiles_dir(&app)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("xband-tile", |ctx, request| {
            let tiles_root = tile_protocol::resolve_tiles_root(ctx.app_handle());
            tile_protocol::handle_tile_request(&tiles_root, &request)
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_diagnostics,
            get_tiles_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tactical X-Band Digital Twin desktop shell");
}
