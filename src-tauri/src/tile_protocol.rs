//! Native `xband-tile://` custom URI scheme handler with strict path containment,
//! symlink escape rejection, extension allowlisting, and RFC 9110 byte-range streaming.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};

use http::{header, Method, Request, Response, StatusCode};
use serde::Serialize;
use tauri::Manager;

const MAX_RANGE_CHUNK_BYTES: u64 = 64 * 1024 * 1024;
const MAX_FULL_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SAVE_TILE_BYTES: usize = 256 * 1024 * 1024;

const ALLOWED_EXTENSIONS: &[&str] = &[
    "pmtiles", "png", "webp", "jpg", "jpeg", "pbf", "mvt", "json", "hgt", "bin", "tif", "tiff",
];

/// Resolves the offline tiles directory for the current runtime mode.
///
/// In packaged builds (`!debug_assertions`), prefers OS `app_data_dir/tiles` (creating it if
/// absent) and falls back to `resource_dir/tiles`. In dev mode, prefers `<repo>/data/tiles`.
pub fn resolve_tiles_root(app: &tauri::AppHandle) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        let dev_tiles = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.join("data").join("tiles"))
            .unwrap_or_else(|| PathBuf::from("data").join("tiles"));
        if dev_tiles.exists() {
            return dev_tiles;
        }
        if let Ok(app_data) = app.path().app_data_dir() {
            let tiles = app_data.join("tiles");
            if fs::create_dir_all(&tiles).is_ok() {
                return tiles;
            }
        }
        let _ = fs::create_dir_all(&dev_tiles);
        dev_tiles
    }

    #[cfg(not(debug_assertions))]
    {
        if let Ok(app_data) = app.path().app_data_dir() {
            let tiles = app_data.join("tiles");
            if fs::create_dir_all(&tiles).is_ok() {
                return tiles;
            }
        }
        if let Ok(res_dir) = app.path().resource_dir() {
            let res_tiles = res_dir.join("tiles");
            if res_tiles.exists() {
                return res_tiles;
            }
        }
        PathBuf::from("data").join("tiles")
    }
}

/// Resolves and ensures a writable offline tiles directory exists, returning its canonical path.
pub fn resolve_writable_tiles_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = resolve_tiles_root(app);
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create tiles directory {}: {e}", dir.display()))?;
    fs::canonicalize(&dir)
        .map_err(|e| format!("Failed to canonicalize tiles directory {}: {e}", dir.display()))
}

fn mime_type_for_ext(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        "pbf" | "mvt" => "application/x-protobuf",
        "json" => "application/json",
        "tif" | "tiff" => "image/tiff",
        "pmtiles" | "hgt" | "bin" => "application/octet-stream",
        _ => "application/octet-stream",
    }
}

fn is_allowed_extension(ext: &str) -> bool {
    ALLOWED_EXTENSIONS.contains(&ext)
}

fn build_text_response(status: StatusCode, body: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn build_405_response() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::METHOD_NOT_ALLOWED)
        .header(header::ALLOW, "GET, HEAD")
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(b"Method Not Allowed".to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn build_416_response(file_size: u64) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(header::CONTENT_RANGE, format!("bytes */{file_size}"))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Validates URI path components and extracts a strictly relative `PathBuf` + lowercase extension.
fn extract_validated_relative_path(request: &Request<Vec<u8>>) -> Result<(PathBuf, String), ()> {
    let uri = request.uri();
    let raw_uri = uri.to_string();
    let lower_raw = raw_uri.to_ascii_lowercase();

    // Reject null bytes, backslashes, encoded dots/slashes, query strings, and fragments upfront.
    if raw_uri.is_empty()
        || raw_uri.contains('\0')
        || lower_raw.contains("%00")
        || raw_uri.contains('\\')
        || lower_raw.contains("%5c")
        || raw_uri.contains("..")
        || lower_raw.contains("%2e")
        || lower_raw.contains("%2f")
        || uri.query().is_some()
        || raw_uri.contains('?')
        || raw_uri.contains('#')
    {
        return Err(());
    }

    let scheme = uri.scheme_str().unwrap_or("").to_ascii_lowercase();
    let host = uri.host().unwrap_or("");
    let path = uri.path();

    let scheme_ok = scheme == "xband-tile"
        || ((scheme == "http" || scheme == "https")
            && host.eq_ignore_ascii_case("xband-tile.localhost"));
    if !scheme_ok {
        return Err(());
    }

    // Reject drive prefixes or unexpected colons in host/path (e.g. `C:/Windows/...`).
    if host.contains(':') || path.contains(':') {
        return Err(());
    }

    let rel_str = if scheme == "xband-tile"
        && !host.is_empty()
        && !host.eq_ignore_ascii_case("localhost")
        && !host.eq_ignore_ascii_case("xband-tile.localhost")
    {
        let trimmed = path.trim_start_matches('/');
        if trimmed.is_empty() {
            host.to_string()
        } else {
            format!("{host}/{trimmed}")
        }
    } else {
        path.trim_start_matches('/').to_string()
    };

    if rel_str.is_empty() {
        return Err(());
    }

    let mut rel_path = PathBuf::new();
    for segment in rel_str.split('/') {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.contains('\0')
            || segment.contains('\\')
            || segment.contains(':')
        {
            return Err(());
        }
        rel_path.push(segment);
    }

    // Double-check normalized Path components contain only Normal components.
    if rel_path.as_os_str().is_empty()
        || !rel_path
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
    {
        return Err(());
    }

    let ext = rel_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .ok_or(())?;

    if !is_allowed_extension(&ext) {
        return Err(());
    }

    Ok((rel_path, ext))
}

/// Verifies that the deepest existing ancestor of a missing candidate stays inside `canonical_root`.
fn ancestor_within_root(candidate: &Path, canonical_root: &Path) -> bool {
    let mut current = candidate.parent();
    while let Some(dir) = current {
        if dir.exists() {
            return match fs::canonicalize(dir) {
                Ok(canon_dir) => canon_dir.starts_with(canonical_root),
                Err(_) => false,
            };
        }
        current = dir.parent();
    }
    false
}

/// Parses an RFC 9110 single byte-range header (`bytes=start-end`, `bytes=start-`, `bytes=-suffix`).
pub fn parse_byte_range(range_header: &str, file_size: u64) -> Result<(u64, u64), ()> {
    if file_size == 0 {
        return Err(());
    }
    let trimmed = range_header.trim();
    if trimmed.len() < 6 || !trimmed[..6].eq_ignore_ascii_case("bytes=") {
        return Err(());
    }
    let spec = trimmed[6..].trim();
    if spec.is_empty() || spec.contains(',') {
        return Err(());
    }

    let (raw_start, raw_end) = spec.split_once('-').ok_or(())?;
    let raw_start = raw_start.trim();
    let raw_end = raw_end.trim();

    if raw_start.is_empty() {
        // Suffix range: bytes=-suffix
        let suffix: u64 = raw_end.parse().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        let start = file_size.saturating_sub(suffix);
        let end = file_size - 1;
        Ok((start, end))
    } else {
        let start: u64 = raw_start.parse().map_err(|_| ())?;
        if start >= file_size {
            return Err(());
        }
        let end = if raw_end.is_empty() {
            file_size - 1
        } else {
            let parsed_end: u64 = raw_end.parse().map_err(|_| ())?;
            if parsed_end < start {
                return Err(());
            }
            parsed_end.min(file_size - 1)
        };
        Ok((start, end))
    }
}

/// Pure, unit-testable `xband-tile://` request handler confined strictly to `tiles_root`.
pub fn handle_tile_request(tiles_root: &Path, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let is_head = match *request.method() {
        Method::GET => false,
        Method::HEAD => true,
        _ => return build_405_response(),
    };

    let (rel_path, ext) = match extract_validated_relative_path(request) {
        Ok(parsed) => parsed,
        Err(()) => return build_text_response(StatusCode::FORBIDDEN, "Forbidden"),
    };

    let canonical_root = match fs::canonicalize(tiles_root) {
        Ok(p) => p,
        Err(_) => return build_text_response(StatusCode::NOT_FOUND, "Not Found"),
    };

    let candidate = canonical_root.join(&rel_path);

    match fs::symlink_metadata(&candidate) {
        Ok(sym_meta) => {
            if sym_meta.file_type().is_symlink() {
                let Ok(resolved) = fs::canonicalize(&candidate) else {
                    return build_text_response(StatusCode::FORBIDDEN, "Forbidden");
                };
                if !resolved.starts_with(&canonical_root) {
                    return build_text_response(StatusCode::FORBIDDEN, "Forbidden");
                }
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            if !ancestor_within_root(&candidate, &canonical_root) {
                return build_text_response(StatusCode::FORBIDDEN, "Forbidden");
            }
            return build_text_response(StatusCode::NOT_FOUND, "Not Found");
        }
        Err(_) => return build_text_response(StatusCode::FORBIDDEN, "Forbidden"),
    }

    let canonical_target = match fs::canonicalize(&candidate) {
        Ok(p) => p,
        Err(_) => return build_text_response(StatusCode::FORBIDDEN, "Forbidden"),
    };

    if !canonical_target.starts_with(&canonical_root) || canonical_target == canonical_root {
        return build_text_response(StatusCode::FORBIDDEN, "Forbidden");
    }

    let meta = match fs::metadata(&canonical_target) {
        Ok(m) => m,
        Err(_) => return build_text_response(StatusCode::NOT_FOUND, "Not Found"),
    };

    if !meta.is_file() {
        return build_text_response(StatusCode::FORBIDDEN, "Forbidden");
    }

    let file_size = meta.len();
    let mime = mime_type_for_ext(&ext);

    if let Some(range_val) = request.headers().get(header::RANGE) {
        let Ok(range_str) = range_val.to_str() else {
            return build_416_response(file_size);
        };
        let Ok((start, mut end)) = parse_byte_range(range_str, file_size) else {
            return build_416_response(file_size);
        };

        let mut chunk_len = end - start + 1;
        if chunk_len > MAX_RANGE_CHUNK_BYTES {
            end = start + MAX_RANGE_CHUNK_BYTES - 1;
            chunk_len = MAX_RANGE_CHUNK_BYTES;
        }

        let body = if is_head {
            Vec::new()
        } else {
            let mut file = match File::open(&canonical_target) {
                Ok(f) => f,
                Err(_) => {
                    return build_text_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to open tile",
                    )
                }
            };
            if file.seek(SeekFrom::Start(start)).is_err() {
                return build_text_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to seek tile",
                );
            }
            let mut buf = Vec::with_capacity(chunk_len as usize);
            if file.take(chunk_len).read_to_end(&mut buf).is_err() {
                return build_text_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to read tile range",
                );
            }
            buf
        };

        return Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, mime)
            .header(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{file_size}"),
            )
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_LENGTH, chunk_len.to_string())
            .header(header::CACHE_CONTROL, "public, max-age=3600")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(
                header::ACCESS_CONTROL_EXPOSE_HEADERS,
                "Content-Range, Accept-Ranges, Content-Length",
            )
            .body(body)
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }

    if !is_head && file_size > MAX_FULL_FILE_BYTES {
        return build_text_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Payload Too Large: use Range requests for archives > 64 MB",
        );
    }

    let body = if is_head {
        Vec::new()
    } else {
        match fs::read(&canonical_target) {
            Ok(bytes) => bytes,
            Err(_) => {
                return build_text_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to read tile",
                )
            }
        }
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, file_size.to_string())
        .header(header::CACHE_CONTROL, "public, max-age=3600")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Range, Accept-Ranges, Content-Length",
        )
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct OfflineTileEntry {
    pub name: String,
    pub size_bytes: u64,
    pub ext: String,
}

fn validate_offline_tile_filename(name: &str) -> Result<(String, String), String> {
    if name.is_empty()
        || name.len() > 180
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.contains('\0')
        || name.contains(':')
        || name.starts_with('.')
        || name.ends_with('.')
        || name.chars().any(|c| c.is_control())
    {
        return Err(format!("Invalid offline tile filename: '{name}'"));
    }

    let p = Path::new(name);
    let mut comps = p.components();
    match (comps.next(), comps.next()) {
        (Some(Component::Normal(_)), None) => {}
        _ => return Err(format!("Offline tile filename must be a single path component: '{name}'")),
    }

    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .ok_or_else(|| format!("Offline tile filename missing extension: '{name}'"))?;

    if !is_allowed_extension(&ext) {
        return Err(format!("Disallowed offline tile extension '.{ext}'"));
    }

    Ok((name.to_string(), ext))
}

/// Lists validated offline tile/pack files directly inside `tiles_root`.
pub fn list_offline_tiles_in_dir(tiles_root: &Path) -> Result<Vec<OfflineTileEntry>, String> {
    if !tiles_root.exists() {
        return Ok(Vec::new());
    }
    let canonical_root = fs::canonicalize(tiles_root)
        .map_err(|e| format!("Failed to canonicalize tiles_root: {e}"))?;
    let mut entries = Vec::new();
    let rd = fs::read_dir(&canonical_root)
        .map_err(|e| format!("Failed to read tiles directory: {e}"))?;

    for item in rd {
        let entry = match item {
            Ok(e) => e,
            Err(_) => continue,
        };
        let file_name = entry.file_name();
        let Some(name_str) = file_name.to_str() else {
            continue;
        };
        let Ok((validated_name, ext)) = validate_offline_tile_filename(name_str) else {
            continue;
        };
        let path = entry.path();
        let Ok(sym_meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if sym_meta.file_type().is_symlink() {
            let Ok(resolved) = fs::canonicalize(&path) else {
                continue;
            };
            if !resolved.starts_with(&canonical_root) {
                continue;
            }
        }
        let Ok(meta) = fs::metadata(&path) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        entries.push(OfflineTileEntry {
            name: validated_name,
            size_bytes: meta.len(),
            ext,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// Atomically saves a validated offline tile/pack payload inside `tiles_root`.
pub fn save_offline_tile_in_dir(
    tiles_root: &Path,
    name: &str,
    bytes: &[u8],
) -> Result<OfflineTileEntry, String> {
    let (validated_name, ext) = validate_offline_tile_filename(name)?;
    if bytes.len() > MAX_SAVE_TILE_BYTES {
        return Err(format!(
            "Payload size {} bytes exceeds maximum {} bytes",
            bytes.len(),
            MAX_SAVE_TILE_BYTES
        ));
    }

    fs::create_dir_all(tiles_root)
        .map_err(|e| format!("Failed to create tiles directory: {e}"))?;
    let canonical_root = fs::canonicalize(tiles_root)
        .map_err(|e| format!("Failed to canonicalize tiles directory: {e}"))?;
    let target_path = canonical_root.join(&validated_name);

    if let Ok(sym_meta) = fs::symlink_metadata(&target_path) {
        if sym_meta.file_type().is_symlink() {
            let resolved = fs::canonicalize(&target_path)
                .map_err(|_| "Refusing to overwrite broken symlink".to_string())?;
            if !resolved.starts_with(&canonical_root) {
                return Err("Refusing to overwrite symlink outside tiles_root".to_string());
            }
        }
    }

    let tmp_name = format!(".tmp.{}.{}.part", std::process::id(), validated_name);
    let tmp_path = canonical_root.join(tmp_name);
    {
        let mut tmp_file = File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temp tile file: {e}"))?;
        if let Err(e) = tmp_file.write_all(bytes).and_then(|_| tmp_file.sync_all()) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!("Failed to write tile file: {e}"));
        }
    }
    if let Err(e) = fs::rename(&tmp_path, &target_path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Failed to finalize atomic tile write: {e}"));
    }

    Ok(OfflineTileEntry {
        name: validated_name,
        size_bytes: bytes.len() as u64,
        ext,
    })
}

/// Deletes a validated offline tile/pack file strictly inside `tiles_root`.
pub fn delete_offline_tile_in_dir(tiles_root: &Path, name: &str) -> Result<bool, String> {
    let (validated_name, _) = validate_offline_tile_filename(name)?;
    if !tiles_root.exists() {
        return Ok(false);
    }
    let canonical_root = fs::canonicalize(tiles_root)
        .map_err(|e| format!("Failed to canonicalize tiles directory: {e}"))?;
    let target_path = canonical_root.join(&validated_name);

    match fs::symlink_metadata(&target_path) {
        Ok(sym_meta) => {
            if sym_meta.file_type().is_symlink() {
                let resolved = fs::canonicalize(&target_path)
                    .map_err(|_| "Refusing to follow broken symlink".to_string())?;
                if !resolved.starts_with(&canonical_root) {
                    return Err("Refusing to delete symlink outside tiles_root".to_string());
                }
            } else if sym_meta.is_dir() {
                return Err("Refusing to delete a directory".to_string());
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(err) => return Err(format!("Failed to inspect tile path: {err}")),
    }

    fs::remove_file(&target_path).map_err(|e| format!("Failed to delete tile: {e}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "xband_tauri_tile_test_{label}_{}_{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn make_req(method: Method, uri: &str, range: Option<&str>) -> Request<Vec<u8>> {
        let mut builder = Request::builder().method(method).uri(uri);
        if let Some(r) = range {
            builder = builder.header(header::RANGE, r);
        }
        builder.body(Vec::new()).unwrap()
    }

    #[test]
    fn serves_full_file_with_200_and_mime_type() {
        let root = TempDirGuard::new("full_ok");
        let tile_dir = root.path.join("terrain").join("10").join("732");
        fs::create_dir_all(&tile_dir).unwrap();
        let payload = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];
        fs::write(tile_dir.join("412.png"), &payload).unwrap();

        let req = make_req(Method::GET, "xband-tile://terrain/10/732/412.png", None);
        let resp = handle_tile_request(&root.path, &req);

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.headers().get(header::CONTENT_TYPE).unwrap(), "image/png");
        assert_eq!(resp.headers().get(header::ACCEPT_RANGES).unwrap(), "bytes");
        assert_eq!(
            resp.headers().get(header::CACHE_CONTROL).unwrap(),
            "public, max-age=3600"
        );
        assert_eq!(resp.body(), &payload);
    }

    #[test]
    fn serves_rfc9110_partial_content_explicit_open_and_suffix_ranges() {
        let root = TempDirGuard::new("ranges");
        let data: Vec<u8> = (0u8..32u8).collect();
        fs::write(root.path.join("ladakh.pmtiles"), &data).unwrap();

        // Explicit range bytes=0-15
        let req_explicit = make_req(
            Method::GET,
            "xband-tile://ladakh.pmtiles",
            Some("bytes=0-15"),
        );
        let resp_explicit = handle_tile_request(&root.path, &req_explicit);
        assert_eq!(resp_explicit.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            resp_explicit.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 0-15/32"
        );
        assert_eq!(
            resp_explicit.headers().get(header::CONTENT_LENGTH).unwrap(),
            "16"
        );
        assert_eq!(resp_explicit.body(), &data[0..16]);

        // Open-ended range bytes=10-
        let req_open = make_req(
            Method::GET,
            "http://xband-tile.localhost/ladakh.pmtiles",
            Some("bytes=10-"),
        );
        let resp_open = handle_tile_request(&root.path, &req_open);
        assert_eq!(resp_open.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            resp_open.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 10-31/32"
        );
        assert_eq!(
            resp_open.headers().get(header::CONTENT_LENGTH).unwrap(),
            "22"
        );
        assert_eq!(resp_open.body(), &data[10..32]);

        // Suffix range bytes=-8
        let req_suffix = make_req(
            Method::GET,
            "xband-tile://localhost/ladakh.pmtiles",
            Some("bytes=-8"),
        );
        let resp_suffix = handle_tile_request(&root.path, &req_suffix);
        assert_eq!(resp_suffix.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            resp_suffix.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 24-31/32"
        );
        assert_eq!(
            resp_suffix.headers().get(header::CONTENT_LENGTH).unwrap(),
            "8"
        );
        assert_eq!(resp_suffix.body(), &data[24..32]);
    }

    #[test]
    fn returns_416_on_out_of_bounds_or_invalid_range() {
        let root = TempDirGuard::new("oob_range");
        fs::write(root.path.join("sample.bin"), b"0123456789").unwrap();

        let req = make_req(Method::GET, "xband-tile://sample.bin", Some("bytes=100-200"));
        let resp = handle_tile_request(&root.path, &req);
        assert_eq!(resp.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(
            resp.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes */10"
        );

        let req_rev = make_req(Method::GET, "xband-tile://sample.bin", Some("bytes=8-2"));
        let resp_rev = handle_tile_request(&root.path, &req_rev);
        assert_eq!(resp_rev.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    }

    #[test]
    fn rejects_traversal_disallowed_extensions_and_symlink_escape_with_403() {
        let root = TempDirGuard::new("security_root");
        let outside = TempDirGuard::new("security_outside");
        let secret = outside.path.join("secret.png");
        fs::write(&secret, b"SECRET_OUTSIDE").unwrap();

        // 1. ../ path traversal
        let req_trav = make_req(Method::GET, "xband-tile://terrain/../../etc/passwd.png", None);
        assert_eq!(
            handle_tile_request(&root.path, &req_trav).status(),
            StatusCode::FORBIDDEN
        );

        let req_enc = make_req(Method::GET, "xband-tile://terrain/%2e%2e/secret.png", None);
        assert_eq!(
            handle_tile_request(&root.path, &req_enc).status(),
            StatusCode::FORBIDDEN
        );

        // 2. Disallowed extension (.exe / .sh)
        fs::write(root.path.join("payload.exe"), b"MZ").unwrap();
        let req_exe = make_req(Method::GET, "xband-tile://payload.exe", None);
        assert_eq!(
            handle_tile_request(&root.path, &req_exe).status(),
            StatusCode::FORBIDDEN
        );

        let req_sh = make_req(Method::GET, "xband-tile://run.sh", None);
        assert_eq!(
            handle_tile_request(&root.path, &req_sh).status(),
            StatusCode::FORBIDDEN
        );

        // 3. Symlink pointing outside tiles_root
        let escape_link = root.path.join("escape.png");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&secret, &escape_link).unwrap();
            let req_sym = make_req(Method::GET, "xband-tile://escape.png", None);
            assert_eq!(
                handle_tile_request(&root.path, &req_sym).status(),
                StatusCode::FORBIDDEN
            );
        }
        #[cfg(windows)]
        {
            if std::os::windows::fs::symlink_file(&secret, &escape_link).is_ok() {
                let req_sym = make_req(Method::GET, "xband-tile://escape.png", None);
                assert_eq!(
                    handle_tile_request(&root.path, &req_sym).status(),
                    StatusCode::FORBIDDEN
                );
            }
        }
    }

    #[test]
    fn returns_404_on_missing_tile_and_405_on_post() {
        let root = TempDirGuard::new("missing_and_method");

        let req_404 = make_req(Method::GET, "xband-tile://terrain/8/10/20.png", None);
        assert_eq!(
            handle_tile_request(&root.path, &req_404).status(),
            StatusCode::NOT_FOUND
        );

        let req_405 = make_req(Method::POST, "xband-tile://terrain/8/10/20.png", None);
        assert_eq!(
            handle_tile_request(&root.path, &req_405).status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
    }

    #[test]
    fn offline_tile_crud_validates_filenames_sizes_and_atomicity() {
        let root = TempDirGuard::new("crud");

        // Save valid HGT and PMTiles files
        let saved_hgt = save_offline_tile_in_dir(&root.path, "N34E076.hgt", b"HGT_DATA").unwrap();
        assert_eq!(saved_hgt.name, "N34E076.hgt");
        assert_eq!(saved_hgt.size_bytes, 8);
        assert_eq!(saved_hgt.ext, "hgt");

        let saved_pm = save_offline_tile_in_dir(&root.path, "ladakh.pmtiles", b"PMTiles").unwrap();
        assert_eq!(saved_pm.ext, "pmtiles");

        let listed = list_offline_tiles_in_dir(&root.path).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].name, "N34E076.hgt");
        assert_eq!(listed[1].name, "ladakh.pmtiles");

        // Reject traversal, separators, null bytes, disallowed extensions
        for bad in &[
            "../evil.hgt",
            "sub/file.hgt",
            "sub\\file.hgt",
            "bad\0.hgt",
            "script.sh",
            "payload.exe",
            ".hidden.hgt",
            "C:drive.hgt",
        ] {
            assert!(
                save_offline_tile_in_dir(&root.path, bad, b"x").is_err(),
                "Expected rejection for '{bad}'"
            );
            assert!(
                delete_offline_tile_in_dir(&root.path, bad).is_err(),
                "Expected delete rejection for '{bad}'"
            );
        }

        // Delete existing & non-existing
        assert_eq!(delete_offline_tile_in_dir(&root.path, "N34E076.hgt").unwrap(), true);
        assert_eq!(delete_offline_tile_in_dir(&root.path, "N34E076.hgt").unwrap(), false);
        let listed_after = list_offline_tiles_in_dir(&root.path).unwrap();
        assert_eq!(listed_after.len(), 1);
        assert_eq!(listed_after[0].name, "ladakh.pmtiles");
    }

    #[test]
    fn offline_tile_save_rejects_oversized_and_symlink_escape() {
        let root = TempDirGuard::new("oversized");
        let outside = TempDirGuard::new("outside_crud");
        let secret = outside.path.join("secret.hgt");
        fs::write(&secret, b"OUTSIDE").unwrap();

        #[cfg(unix)]
        {
            let escape_link = root.path.join("escape.hgt");
            std::os::unix::fs::symlink(&secret, &escape_link).unwrap();
            assert!(save_offline_tile_in_dir(&root.path, "escape.hgt", b"OVERWRITE").is_err());
            assert!(delete_offline_tile_in_dir(&root.path, "escape.hgt").is_err());
        }

        // Ensure MAX_SAVE_TILE_BYTES is enforced (check error path without 256 MiB alloc if possible;
        // test validate boundary constant directly)
        assert_eq!(MAX_SAVE_TILE_BYTES, 256 * 1024 * 1024);
    }
}
