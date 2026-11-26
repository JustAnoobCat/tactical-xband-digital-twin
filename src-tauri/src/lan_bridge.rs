//! Air-gapped private-LAN UDP bridge for ATAK Cursor-on-Target (CoT) XML
//! and MAVLink v2 (`GLOBAL_POSITION_INT`, msg ID 33) telemetry frames.
//!
//! Security invariant:
//! - Pure `std::net` implementation with zero external network dependencies.
//! - Hard-blocks ALL public/routable internet IP addresses (permitting ONLY
//!   loopback, RFC 1918 private LANs, RFC 3927 link-local, IPv6 ULA/link-local,
//!   and IPv4 local multicast with `TTL = 1`).
//! - Enforces unprivileged UDP destination ports (`1024..=65535`).
//! - Never spawns background beacons or transmits unsolicited packets.

use serde::Deserialize;
use std::net::{IpAddr, SocketAddr, UdpSocket};

/// Maximum permitted ATAK CoT XML datagram payload size in bytes.
pub const MAX_COT_XML_BYTES: usize = 65_000;

/// Minimum allowed UDP destination port (unprivileged ports only).
pub const MIN_UDP_PORT: u16 = 1024;

/// MAVLink v2 packet start byte (STX).
pub const MAVLINK_V2_STX: u8 = 0xFD;

/// MAVLink `GLOBAL_POSITION_INT` message ID.
pub const MAVLINK_MSG_ID_GLOBAL_POSITION_INT: u32 = 33;

/// MAVLink `GLOBAL_POSITION_INT` payload length in bytes.
pub const MAVLINK_GLOBAL_POSITION_INT_LEN: usize = 28;

/// MAVLink `GLOBAL_POSITION_INT` CRC_EXTRA seed byte.
pub const MAVLINK_GLOBAL_POSITION_INT_CRC_EXTRA: u8 = 104;

/// Total serialized MAVLink v2 `GLOBAL_POSITION_INT` frame size (10 header + 28 payload + 2 CRC).
pub const MAVLINK_GLOBAL_POSITION_INT_FRAME_LEN: usize = 40;

fn default_mavlink_id() -> u8 {
    1
}

/// Physical kinematics input for framing a MAVLink v2 `GLOBAL_POSITION_INT` packet.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MavlinkGlobalPositionParams {
    #[serde(alias = "time_boot_ms")]
    pub time_boot_ms: u32,
    #[serde(alias = "lat_deg")]
    pub lat_deg: f64,
    #[serde(alias = "lon_deg")]
    pub lon_deg: f64,
    #[serde(alias = "alt_msl_m")]
    pub alt_msl_m: f64,
    #[serde(alias = "relative_alt_m")]
    pub relative_alt_m: f64,
    #[serde(alias = "vx_mps")]
    pub vx_mps: f64,
    #[serde(alias = "vy_mps")]
    pub vy_mps: f64,
    #[serde(alias = "vz_mps")]
    pub vz_mps: f64,
    #[serde(alias = "heading_deg")]
    pub heading_deg: f64,
    #[serde(default = "default_mavlink_id", alias = "system_id")]
    pub system_id: u8,
    #[serde(default = "default_mavlink_id", alias = "component_id")]
    pub component_id: u8,
    #[serde(default, alias = "seq")]
    pub seq: u8,
}

/// Returns `true` ONLY for air-gap-safe local/private/multicast IP addresses:
/// - IPv4: loopback (`127.0.0.0/8`), RFC 1918 private (`10.0.0.0/8`, `172.16.0.0/12`,
///   `192.168.0.0/16`), RFC 3927 link-local (`169.254.0.0/16`), multicast (`224.0.0.0/4`).
/// - IPv6: loopback (`::1`), unique local (`fc00::/7`), link-local (`fe80::/10`).
pub fn is_allowed_airgap_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_multicast()
        }
        IpAddr::V6(v6) => {
            let seg0 = v6.segments()[0];
            let is_unique_local = (seg0 & 0xfe00) == 0xfc00;
            let is_link_local = (seg0 & 0xffc0) == 0xfe80;
            v6.is_loopback() || is_unique_local || is_link_local
        }
    }
}

/// Parses and validates a UDP destination socket address against air-gap LAN policy.
/// Rejects public/routable internet IPs and privileged ports (`< 1024`).
pub fn validate_airgap_udp_target(target_addr: &str) -> Result<SocketAddr, String> {
    let trimmed = target_addr.trim();
    let addr = trimmed
        .parse::<SocketAddr>()
        .map_err(|err| format!("Invalid UDP socket address '{trimmed}': {err}"))?;

    if !is_allowed_airgap_ip(addr.ip()) {
        return Err(format!(
            "Air-gap security policy blocked non-LAN / public IP address: {}",
            addr.ip()
        ));
    }

    if addr.port() < MIN_UDP_PORT {
        return Err(format!(
            "Air-gap UDP policy blocked privileged port {} (allowed range: {MIN_UDP_PORT}..=65535)",
            addr.port()
        ));
    }

    Ok(addr)
}

/// Accumulates one byte into an X.25 / MCRF4XX CRC-16 checksum (MAVLink standard).
#[inline]
pub fn mavlink_crc_accumulate(byte: u8, crc: u16) -> u16 {
    let mut tmp = byte ^ (crc & 0x00ff) as u8;
    tmp ^= tmp << 4;
    (crc >> 8) ^ ((tmp as u16) << 8) ^ ((tmp as u16) << 3) ^ ((tmp as u16) >> 4)
}

/// Computes the MAVLink X.25 / MCRF4XX CRC-16 over a byte slice plus optional `crc_extra`.
pub fn compute_mavlink_crc16(bytes: &[u8], crc_extra: Option<u8>) -> u16 {
    let mut crc: u16 = 0xffff;
    for &b in bytes {
        crc = mavlink_crc_accumulate(b, crc);
    }
    if let Some(extra) = crc_extra {
        crc = mavlink_crc_accumulate(extra, crc);
    }
    crc
}

fn finite_scaled_i32(value: f64, scale: f64) -> i32 {
    if !value.is_finite() {
        return 0;
    }
    (value * scale)
        .round()
        .clamp(i32::MIN as f64, i32::MAX as f64) as i32
}

fn finite_scaled_i16(value: f64, scale: f64) -> i16 {
    if !value.is_finite() {
        return 0;
    }
    (value * scale)
        .round()
        .clamp(i16::MIN as f64, i16::MAX as f64) as i16
}

fn encode_heading_cdeg(heading_deg: f64) -> u16 {
    if !heading_deg.is_finite() {
        return u16::MAX;
    }
    let wrapped = heading_deg.rem_euclid(360.0);
    let cdeg = (wrapped * 100.0).round();
    if cdeg >= 36000.0 {
        0
    } else {
        cdeg.clamp(0.0, 35999.0) as u16
    }
}

/// Builds a 40-byte MAVLink v2 `GLOBAL_POSITION_INT` (message ID `33`, `CRC_EXTRA = 104`) frame.
pub fn build_mavlink_v2_global_position_int(
    params: &MavlinkGlobalPositionParams,
) -> [u8; MAVLINK_GLOBAL_POSITION_INT_FRAME_LEN] {
    let mut frame = [0u8; MAVLINK_GLOBAL_POSITION_INT_FRAME_LEN];
    let msg_id_bytes = MAVLINK_MSG_ID_GLOBAL_POSITION_INT.to_le_bytes();

    // 10-byte MAVLink v2 header
    frame[0] = MAVLINK_V2_STX;
    frame[1] = MAVLINK_GLOBAL_POSITION_INT_LEN as u8;
    frame[2] = 0x00; // incompat_flags
    frame[3] = 0x00; // compat_flags
    frame[4] = params.seq;
    frame[5] = params.system_id;
    frame[6] = params.component_id;
    frame[7] = msg_id_bytes[0];
    frame[8] = msg_id_bytes[1];
    frame[9] = msg_id_bytes[2];

    // 28-byte GLOBAL_POSITION_INT payload (fields ordered by MAVLink wire spec)
    let lat_e7 = finite_scaled_i32(params.lat_deg, 1e7);
    let lon_e7 = finite_scaled_i32(params.lon_deg, 1e7);
    let alt_mm = finite_scaled_i32(params.alt_msl_m, 1000.0);
    let rel_alt_mm = finite_scaled_i32(params.relative_alt_m, 1000.0);
    let vx_cms = finite_scaled_i16(params.vx_mps, 100.0);
    let vy_cms = finite_scaled_i16(params.vy_mps, 100.0);
    let vz_cms = finite_scaled_i16(params.vz_mps, 100.0);
    let hdg_cdeg = encode_heading_cdeg(params.heading_deg);

    frame[10..14].copy_from_slice(&params.time_boot_ms.to_le_bytes());
    frame[14..18].copy_from_slice(&lat_e7.to_le_bytes());
    frame[18..22].copy_from_slice(&lon_e7.to_le_bytes());
    frame[22..26].copy_from_slice(&alt_mm.to_le_bytes());
    frame[26..30].copy_from_slice(&rel_alt_mm.to_le_bytes());
    frame[30..32].copy_from_slice(&vx_cms.to_le_bytes());
    frame[32..34].copy_from_slice(&vy_cms.to_le_bytes());
    frame[34..36].copy_from_slice(&vz_cms.to_le_bytes());
    frame[36..38].copy_from_slice(&hdg_cdeg.to_le_bytes());

    // 2-byte X.25/MCRF4XX CRC-16 over header[1..10] + payload[10..38] + CRC_EXTRA(104)
    let crc = compute_mavlink_crc16(
        &frame[1..38],
        Some(MAVLINK_GLOBAL_POSITION_INT_CRC_EXTRA),
    );
    frame[38..40].copy_from_slice(&crc.to_le_bytes());
    frame
}

fn send_airgap_udp_bytes(addr: SocketAddr, payload: &[u8]) -> Result<usize, String> {
    let bind_addr = match addr {
        SocketAddr::V4(_) => "0.0.0.0:0",
        SocketAddr::V6(_) => "[::]:0",
    };

    let socket = UdpSocket::bind(bind_addr)
        .map_err(|err| format!("Failed to bind ephemeral UDP socket '{bind_addr}': {err}"))?;

    if let SocketAddr::V4(v4_target) = addr {
        if v4_target.ip().is_multicast() {
            socket
                .set_multicast_ttl_v4(1)
                .map_err(|err| format!("Failed to set multicast TTL=1: {err}"))?;
        }
    }

    socket
        .send_to(payload, addr)
        .map_err(|err| format!("UDP send_to({addr}) failed: {err}"))
}

/// Validates target + ATAK CoT `<event` XML payload (`<= 65,000` bytes) and transmits once over local LAN UDP.
pub fn send_atak_cot_udp_payload(target_addr: &str, cot_xml: &str) -> Result<usize, String> {
    let addr = validate_airgap_udp_target(target_addr)?;
    let trimmed = cot_xml.trim();
    if trimmed.is_empty() || !trimmed.contains("<event") {
        return Err("ATAK CoT payload must be non-empty XML containing an <event element".to_string());
    }
    let bytes = cot_xml.as_bytes();
    if bytes.len() > MAX_COT_XML_BYTES {
        return Err(format!(
            "ATAK CoT payload exceeds maximum size ({} > {MAX_COT_XML_BYTES} bytes)",
            bytes.len()
        ));
    }
    send_airgap_udp_bytes(addr, bytes)
}

/// Validates target + kinematics and transmits one 40-byte MAVLink v2 `GLOBAL_POSITION_INT` UDP datagram.
pub fn send_mavlink_telemetry_udp_payload(
    target_addr: &str,
    params: &MavlinkGlobalPositionParams,
) -> Result<usize, String> {
    if !params.lat_deg.is_finite()
        || !params.lon_deg.is_finite()
        || !params.alt_msl_m.is_finite()
        || !params.relative_alt_m.is_finite()
        || !params.vx_mps.is_finite()
        || !params.vy_mps.is_finite()
        || !params.vz_mps.is_finite()
    {
        return Err("MAVLink telemetry kinematics must contain finite values".to_string());
    }
    let addr = validate_airgap_udp_target(target_addr)?;
    let frame = build_mavlink_v2_global_position_int(params);
    send_airgap_udp_bytes(addr, &frame)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn rejects_public_ips_and_privileged_ports() {
        let blocked_targets = [
            "8.8.8.8:6969",
            "1.1.1.1:14550",
            "203.0.113.10:6969",
            "9.9.9.9:8080",
            "0.0.0.0:6969",
            "255.255.255.255:6969",
            "[2001:4860:4860::8888]:6969",
            "127.0.0.1:80",
            "192.168.1.50:443",
            "127.0.0.1:0",
            "127.0.0.1:1023",
        ];

        for target in blocked_targets {
            let res = validate_airgap_udp_target(target);
            assert!(res.is_err(), "Expected target '{target}' to be rejected");
        }
    }

    #[test]
    fn accepts_loopback_private_link_local_and_multicast_targets() {
        let allowed_targets = [
            "127.0.0.1:6969",
            "192.168.1.50:14550",
            "10.0.0.2:6969",
            "172.16.5.4:14550",
            "172.31.255.254:1024",
            "169.254.10.20:6969",
            "239.2.3.1:6969",
            "[::1]:6969",
            "[fd00::1]:14550",
            "[fe80::1]:6969",
        ];

        for target in allowed_targets {
            let res = validate_airgap_udp_target(target);
            assert!(res.is_ok(), "Expected target '{target}' to be accepted, got {res:?}");
        }
    }

    #[test]
    fn rejects_invalid_cot_payloads_and_oversized_xml() {
        assert!(send_atak_cot_udp_payload("8.8.8.8:6969", "<event/>").is_err());
        assert!(send_atak_cot_udp_payload("127.0.0.1:6969", "").is_err());
        assert!(send_atak_cot_udp_payload("127.0.0.1:6969", "<not_an_event/>").is_err());

        let oversized = format!("<event>{}</event>", "A".repeat(MAX_COT_XML_BYTES + 1));
        assert!(send_atak_cot_udp_payload("127.0.0.1:6969", &oversized).is_err());
    }

    #[test]
    fn verifies_x25_mcrf4xx_crc16_standard_vector() {
        let crc = compute_mavlink_crc16(b"123456789", None);
        assert_eq!(crc, 0x6F91, "X.25/MCRF4XX CRC-16 check vector mismatch");
    }

    #[test]
    fn loopback_udp_roundtrip_atak_cot_and_mavlink_v2() {
        let rx_socket = UdpSocket::bind("127.0.0.1:0").expect("bind ephemeral loopback receiver");
        rx_socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("set read timeout");
        let rx_addr = rx_socket.local_addr().expect("get local addr").to_string();

        // 1. ATAK CoT XML round-trip
        let cot_xml = r#"<event version="2.0" uid="VIPER-01" type="a-f-A-M-F-Q" time="2026-01-01T00:00:00Z" start="2026-01-01T00:00:00Z" stale="2026-01-01T00:01:00Z" how="m-g"><point lat="34.5" lon="76.5" hae="5000" ce="10" le="10"/></event>"#;
        let cot_sent =
            send_atak_cot_udp_payload(&rx_addr, cot_xml).expect("send ATAK CoT to loopback");
        assert_eq!(cot_sent, cot_xml.len());

        let mut cot_buf = [0u8; 2048];
        let (cot_recv_len, _) = rx_socket.recv_from(&mut cot_buf).expect("recv ATAK CoT");
        assert_eq!(
            std::str::from_utf8(&cot_buf[..cot_recv_len]).expect("utf8 CoT"),
            cot_xml
        );

        // 2. MAVLink v2 GLOBAL_POSITION_INT round-trip
        let params = MavlinkGlobalPositionParams {
            time_boot_ms: 12_345,
            lat_deg: 34.5123456,
            lon_deg: 76.5432109,
            alt_msl_m: 5123.456,
            relative_alt_m: 1420.25,
            vx_mps: 32.5,
            vy_mps: -14.25,
            vz_mps: 1.75,
            heading_deg: 135.5,
            system_id: 1,
            component_id: 1,
            seq: 7,
        };

        let mav_sent = send_mavlink_telemetry_udp_payload(&rx_addr, &params)
            .expect("send MAVLink v2 to loopback");
        assert_eq!(mav_sent, MAVLINK_GLOBAL_POSITION_INT_FRAME_LEN);

        let mut mav_buf = [0u8; 128];
        let (mav_recv_len, _) = rx_socket.recv_from(&mut mav_buf).expect("recv MAVLink v2");
        assert_eq!(mav_recv_len, 40);

        let pkt = &mav_buf[..40];
        assert_eq!(pkt[0], 0xFD, "MAVLink v2 STX must be 0xFD");
        assert_eq!(pkt[1], 28, "GLOBAL_POSITION_INT payload length must be 28");
        assert_eq!(pkt[4], 7, "sequence byte must match");
        let msg_id = u32::from_le_bytes([pkt[7], pkt[8], pkt[9], 0]);
        assert_eq!(msg_id, 33, "MAVLink msg_id must be 33 (GLOBAL_POSITION_INT)");

        // Verify exact little-endian payload fields
        let rx_time_boot_ms = u32::from_le_bytes(pkt[10..14].try_into().unwrap());
        let rx_lat = i32::from_le_bytes(pkt[14..18].try_into().unwrap());
        let rx_lon = i32::from_le_bytes(pkt[18..22].try_into().unwrap());
        let rx_alt = i32::from_le_bytes(pkt[22..26].try_into().unwrap());
        let rx_rel_alt = i32::from_le_bytes(pkt[26..30].try_into().unwrap());
        let rx_vx = i16::from_le_bytes(pkt[30..32].try_into().unwrap());
        let rx_vy = i16::from_le_bytes(pkt[32..34].try_into().unwrap());
        let rx_vz = i16::from_le_bytes(pkt[34..36].try_into().unwrap());
        let rx_hdg = u16::from_le_bytes(pkt[36..38].try_into().unwrap());

        assert_eq!(rx_time_boot_ms, 12_345);
        assert_eq!(rx_lat, 345_123_456);
        assert_eq!(rx_lon, 765_432_109);
        assert_eq!(rx_alt, 5_123_456);
        assert_eq!(rx_rel_alt, 1_420_250);
        assert_eq!(rx_vx, 3250);
        assert_eq!(rx_vy, -1425);
        assert_eq!(rx_vz, 175);
        assert_eq!(rx_hdg, 13_550);

        // Verify X.25 CRC-16 with CRC_EXTRA = 104
        let rx_crc = u16::from_le_bytes(pkt[38..40].try_into().unwrap());
        let expected_crc = compute_mavlink_crc16(&pkt[1..38], Some(104));
        assert_eq!(rx_crc, expected_crc, "MAVLink v2 X.25 CRC-16 mismatch");
    }
}
