//! Tactical X-Band Air-to-Ground Network Digital Twin — Tauri v2 Desktop Host.

pub mod lan_bridge;
pub mod tile_protocol;

use serde::Serialize;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub const RESEARCH_DOCS_WINDOW_LABEL: &str = "research-docs";
pub const RESEARCH_DOCS_URL_PATH: &str = "docs.html";
pub const RESEARCH_DOCS_WINDOW_TITLE: &str =
    "Research & Mathematical Reference — Tactical X-Band Digital Twin";
pub const RESEARCH_DOCS_WINDOW_SIZE: (f64, f64) = (1100.0, 820.0);
pub const RESEARCH_DOCS_WINDOW_MIN_SIZE: (f64, f64) = (760.0, 560.0);

pub fn research_docs_window_config() -> (
    &'static str,
    &'static str,
    &'static str,
    f64,
    f64,
    f64,
    f64,
) {
    (
        RESEARCH_DOCS_WINDOW_LABEL,
        RESEARCH_DOCS_URL_PATH,
        RESEARCH_DOCS_WINDOW_TITLE,
        RESEARCH_DOCS_WINDOW_SIZE.0,
        RESEARCH_DOCS_WINDOW_SIZE.1,
        RESEARCH_DOCS_WINDOW_MIN_SIZE.0,
        RESEARCH_DOCS_WINDOW_MIN_SIZE.1,
    )
}

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

#[tauri::command]
fn send_atak_cot_udp(target_addr: String, cot_xml: String) -> Result<usize, String> {
    lan_bridge::send_atak_cot_udp_payload(&target_addr, &cot_xml)
}

#[tauri::command]
fn send_mavlink_telemetry_udp(
    target_addr: String,
    params: lan_bridge::MavlinkGlobalPositionParams,
) -> Result<usize, String> {
    lan_bridge::send_mavlink_telemetry_udp_payload(&target_addr, &params)
}

#[tauri::command]
fn open_research_docs_window(app: tauri::AppHandle) -> Result<(), String> {
    let (label, url_path, title, width, height, min_w, min_h) = research_docs_window_config();
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.unminimize();
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url_path.into()))
        .title(title)
        .inner_size(width, height)
        .min_inner_size(min_w, min_h)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
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
            delete_offline_tile,
            send_atak_cot_udp,
            send_mavlink_telemetry_udp,
            open_research_docs_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tactical X-Band Digital Twin desktop shell");
}

#[cfg(test)]
mod tests {
    use super::research_docs_window_config;

    #[test]
    fn research_docs_window_config_is_valid() {
        let (label, url_path, title, width, height, min_w, min_h) = research_docs_window_config();
        assert_eq!(label, "research-docs");
        assert_eq!(url_path, "docs.html");
        assert!(title.contains("Research & Mathematical Reference"));
        assert_eq!(width, 1100.0);
        assert_eq!(height, 820.0);
        assert_eq!(min_w, 760.0);
        assert_eq!(min_h, 560.0);
        assert!(width >= min_w && height >= min_h);
    }
}
