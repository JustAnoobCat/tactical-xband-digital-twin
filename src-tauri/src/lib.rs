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

#[tauri::command]
fn list_offline_tiles(app: tauri::AppHandle) -> Result<Vec<tile_protocol::OfflineTileEntry>, String> {
    let dir = tile_protocol::resolve_writable_tiles_dir(&app)?;
    tile_protocol::list_offline_tiles_in_dir(&dir)
}

#[tauri::command]
fn save_offline_tile(
    app: tauri::AppHandle,
    name: String,
    bytes: Vec<u8>,
) -> Result<tile_protocol::OfflineTileEntry, String> {
    let dir = tile_protocol::resolve_writable_tiles_dir(&app)?;
    tile_protocol::save_offline_tile_in_dir(&dir, &name, &bytes)
}

#[tauri::command]
fn delete_offline_tile(app: tauri::AppHandle, name: String) -> Result<bool, String> {
    let dir = tile_protocol::resolve_writable_tiles_dir(&app)?;
    tile_protocol::delete_offline_tile_in_dir(&dir, &name)
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
            get_tiles_directory,
            list_offline_tiles,
            save_offline_tile,
            delete_offline_tile
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tactical X-Band Digital Twin desktop shell");
}
