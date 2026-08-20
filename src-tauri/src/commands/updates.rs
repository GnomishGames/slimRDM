use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const RELEASES_API: &str = "https://api.github.com/repos/GnomishGames/slimRDM/releases/latest";

/// Minisign public key used to verify release update signatures, generated via
/// `npx tauri signer generate`. The matching private key is held outside the repo;
/// CI signs each release asset with it (see .github/workflows/release.yml).
///
/// Key id `6090565b549ea78f`, in use from 1.7.8. It replaced the placeholder key
/// `eb7630ffc599df8f` that shipped in 1.7.7 while the feature was being built;
/// that key's private half was never held by the maintainer, so 1.7.7 cannot
/// verify any later release and is withdrawn in favour of a direct install.
/// Rotating this constant strands every already-installed build that embeds the
/// previous key, so it is not a routine change.
const UPDATE_PUBLIC_KEY: &str = "RWRgkFZbVJ6nj0xUuXSV2i2M7e9btz2Ys2YFx0oMcT7Lc+U2qKF/gbP/";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: Option<String>,
    pub expected_sha256: Option<String>,
    pub expected_signature: Option<String>,
    pub release_notes: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    body: Option<String>,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

fn parse_version(v: &str) -> Option<(u32, u32, u32)> {
    let v = v.trim_start_matches('v');
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() < 3 { return None; }
    Some((parts[0].parse().ok()?, parts[1].parse().ok()?, parts[2].parse().ok()?))
}

fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

fn validate_release_url(raw: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw).map_err(|_| "Invalid URL".to_string())?;

    if parsed.scheme() != "https" {
        return Err("URL must use HTTPS".to_string());
    }
    if parsed.host_str() != Some("github.com") {
        return Err("URL must point to github.com".to_string());
    }

    let segments: Vec<&str> = parsed
        .path_segments()
        .map(|s| s.filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();

    if segments.len() < 5
        || segments[0] != "GnomishGames"
        || segments[1] != "slimRDM"
        || segments[2] != "releases"
        || segments[3] != "download"
    {
        return Err("URL must be a slimRDM GitHub release asset".to_string());
    }

    if segments.iter().any(|s| *s == "." || *s == "..") {
        return Err("URL contains forbidden path segments".to_string());
    }

    Ok(parsed)
}

fn sanitize_filename(url: &Url) -> String {
    let name = url
        .path_segments()
        .and_then(|mut s| s.next_back())
        .filter(|s| !s.is_empty() && s.find(|c: char| c.is_ascii_control() || c == '/' || c == '\\').is_none())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "installer".to_string());
    name
}

fn pick_asset(assets: &[GithubAsset]) -> Option<&GithubAsset> {
    let running_appimage = std::env::var("APPIMAGE").is_ok();
    let preferred: &[&str] = match std::env::consts::OS {
        "linux" if running_appimage => &[".appimage", ".deb"],
        "linux"                     => &[".deb", ".appimage"],
        "windows" => &["setup.exe", "-installer.exe", ".exe"],
        "macos"   => &[".dmg"],
        _ => return None,
    };
    for ext in preferred {
        if let Some(asset) = assets.iter().find(|a| a.name.to_lowercase().ends_with(ext)) {
            return Some(asset);
        }
    }
    None
}

async fn fetch_expected_sha256(
    client: &reqwest::Client,
    assets: &[GithubAsset],
    asset_name: &str,
) -> Option<String> {
    let sidecar_name = format!("{}.sha256", asset_name);
    let asset = assets.iter().find(|a| a.name == sidecar_name)?;
    let body = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    parse_sha256_sidecar(&body)
}

/// Pulls the digest out of a `sha256sum` / `shasum -a 256` sidecar, whose first
/// field is the hex digest (`<digest>  <filename>`). Anything that isn't a
/// 64-character hex digest is treated as no checksum rather than as a mismatch:
/// the sidecar is unsigned, so it is a corruption check layered behind the
/// Minisign signature, and a malformed one must not wedge updates.
fn parse_sha256_sidecar(body: &str) -> Option<String> {
    let digest = body.split_whitespace().next()?;
    if digest.len() == 64 && digest.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(digest.to_ascii_lowercase())
    } else {
        None
    }
}

/// Fetches the `.sig` sidecar produced by `tauri signer sign` (base64-encoded
/// minisign signature) for the given release asset, if one was published.
async fn fetch_expected_signature(
    client: &reqwest::Client,
    assets: &[GithubAsset],
    asset_name: &str,
) -> Option<String> {
    let sidecar_name = format!("{}.sig", asset_name);
    let asset = assets.iter().find(|a| a.name == sidecar_name)?;
    client
        .get(&asset.browser_download_url)
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()
}

/// Verifies `bytes` against a base64-encoded minisign signature (as produced by
/// `tauri signer sign`) using the embedded `UPDATE_PUBLIC_KEY`.
fn verify_update_signature(bytes: &[u8], signature_b64: &str) -> Result<(), String> {
    let decoded = BASE64
        .decode(signature_b64.trim())
        .map_err(|_| "Malformed update signature".to_string())?;
    let sig_text = String::from_utf8(decoded).map_err(|_| "Malformed update signature".to_string())?;
    let signature =
        Signature::decode(&sig_text).map_err(|_| "Malformed update signature".to_string())?;
    let public_key = PublicKey::from_base64(UPDATE_PUBLIC_KEY)
        .map_err(|_| "Invalid embedded update public key".to_string())?;
    public_key
        .verify(bytes, &signature, false)
        .map_err(|_| "Update signature verification failed".to_string())
}

#[tauri::command]
pub async fn download_and_install_update(
    url: String,
    signature: String,
    expected_sha256: Option<String>,
) -> Result<(), String> {
    let parsed = validate_release_url(&url)?;

    let client = reqwest::Client::builder()
        .user_agent(concat!("slimrdm/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;

    let bytes = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Download error: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Read failed: {}", e))?;

    verify_update_signature(&bytes, &signature)?;

    if let Some(expected) = expected_sha256 {
        let actual = Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<String>();
        if !actual.eq_ignore_ascii_case(&expected) {
            return Err(format!(
                "SHA-256 mismatch: expected {expected}, got {actual}"
            ));
        }
    }

    let filename = sanitize_filename(&parsed);
    let tmp_path = std::env::temp_dir().join(&filename);

    std::fs::write(&tmp_path, &bytes)
        .map_err(|e| format!("Write failed: {}", e))?;

    launch_installer(&tmp_path, &filename)
}

#[cfg(target_os = "windows")]
fn launch_installer(path: &std::path::Path, _filename: &str) -> Result<(), String> {
    std::process::Command::new(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Launch failed: {}", e))
}

#[cfg(target_os = "linux")]
fn launch_installer(path: &std::path::Path, filename: &str) -> Result<(), String> {
    if filename.to_lowercase().ends_with(".appimage") {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("chmod failed: {}", e))?;
    }
    std::process::Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Launch failed: {}", e))
}

#[cfg(target_os = "macos")]
fn launch_installer(path: &std::path::Path, _filename: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Launch failed: {}", e))
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn launch_installer(_path: &std::path::Path, _filename: &str) -> Result<(), String> {
    Err("Unsupported platform".to_string())
}

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("slimrdm/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;

    let release: GithubRelease = client
        .get(RELEASES_API)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("GitHub API error: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Parse failed: {}", e))?;

    let has_update = is_newer(&release.tag_name, CURRENT_VERSION);

    // Only offer an in-app install when a signature sidecar is published for the
    // asset; otherwise fall back to pointing the user at the releases page.
    let (download_url, expected_sha256, expected_signature) = if has_update {
        match pick_asset(&release.assets) {
            Some(a) => {
                let sha = fetch_expected_sha256(&client, &release.assets, &a.name).await;
                let sig = fetch_expected_signature(&client, &release.assets, &a.name).await;
                match sig {
                    Some(sig) => (Some(a.browser_download_url.clone()), sha, Some(sig)),
                    None => (None, None, None),
                }
            }
            None => (None, None, None),
        }
    } else {
        (None, None, None)
    };

    Ok(UpdateInfo {
        has_update,
        current_version: CURRENT_VERSION.to_string(),
        latest_version: release.tag_name.trim_start_matches('v').to_string(),
        download_url,
        expected_sha256,
        expected_signature,
        release_notes: release.body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_release_url() {
        let url = "https://github.com/GnomishGames/slimRDM/releases/download/v1.7.2/SlimRDM-1.7.2-setup.exe";
        assert!(validate_release_url(url).is_ok());
    }

    #[test]
    fn test_wrong_host() {
        let url = "https://evil.com/GnomishGames/slimRDM/releases/download/v1.7.2/evil.exe";
        assert!(validate_release_url(url).is_err());
    }

    #[test]
    fn test_path_traversal() {
        let url = "https://github.com/GnomishGames/slimRDM/releases/download/../../../Attacker/repo/releases/download/v1/evil.exe";
        assert!(validate_release_url(url).is_err());
    }

    #[test]
    fn test_wrong_repo() {
        let url = "https://github.com/OtherOrg/otherRDM/releases/download/v1.0/installer.exe";
        assert!(validate_release_url(url).is_err());
    }

    #[test]
    fn test_http_rejected() {
        let url = "http://github.com/GnomishGames/slimRDM/releases/download/v1.0/installer.exe";
        assert!(validate_release_url(url).is_err());
    }

    #[test]
    fn test_sanitize_filename_normal() {
        let url = Url::parse("https://github.com/GnomishGames/slimRDM/releases/download/v1.7.2/SlimRDM-1.7.2-setup.exe").unwrap();
        assert_eq!(sanitize_filename(&url), "SlimRDM-1.7.2-setup.exe");
    }

    #[test]
    fn test_sanitize_filename_fallback() {
        let url = Url::parse("https://github.com/GnomishGames/slimRDM/releases/download/v1.7.2/").unwrap();
        assert_eq!(sanitize_filename(&url), "installer");
    }

    // The exact shape CI publishes: `sha256sum <file> > <file>.sha256`
    // (.github/workflows/release.yml). macOS uses `shasum -a 256`, which emits
    // the same two-field format.
    const SIDECAR_DIGEST: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

    #[test]
    fn test_parse_sha256_sidecar_gnu_format() {
        let body = format!("{SIDECAR_DIGEST}  SlimRDM_1.7.7_x64-setup.exe\n");
        assert_eq!(parse_sha256_sidecar(&body).as_deref(), Some(SIDECAR_DIGEST));
    }

    #[test]
    fn test_parse_sha256_sidecar_bsd_shasum_format() {
        // `shasum -a 256` on macOS separates with a space and a mode marker.
        let body = format!("{SIDECAR_DIGEST} *SlimRDM_1.7.7_universal.dmg\n");
        assert_eq!(parse_sha256_sidecar(&body).as_deref(), Some(SIDECAR_DIGEST));
    }

    #[test]
    fn test_parse_sha256_sidecar_bare_digest() {
        assert_eq!(
            parse_sha256_sidecar(SIDECAR_DIGEST).as_deref(),
            Some(SIDECAR_DIGEST)
        );
    }

    #[test]
    fn test_parse_sha256_sidecar_uppercase_is_normalized() {
        let body = SIDECAR_DIGEST.to_ascii_uppercase();
        assert_eq!(parse_sha256_sidecar(&body).as_deref(), Some(SIDECAR_DIGEST));
    }

    #[test]
    fn test_parse_sha256_sidecar_rejects_non_digest() {
        // An error page or truncated upload must read as "no checksum", not as a
        // mismatch that blocks the update.
        assert_eq!(parse_sha256_sidecar("<!DOCTYPE html><html>404"), None);
        assert_eq!(parse_sha256_sidecar(""), None);
        assert_eq!(parse_sha256_sidecar("   \n"), None);
        assert_eq!(parse_sha256_sidecar("deadbeef  short.exe"), None);
        assert_eq!(parse_sha256_sidecar(&"z".repeat(64)), None);
    }

    #[test]
    fn test_parse_version() {
        assert_eq!(parse_version("v1.7.2"), Some((1, 7, 2)));
        assert_eq!(parse_version("1.7.2"), Some((1, 7, 2)));
        assert_eq!(parse_version("invalid"), None);
    }

    #[test]
    fn test_is_newer() {
        assert!(is_newer("v1.8.0", "v1.7.2"));
        assert!(!is_newer("v1.7.2", "v1.8.0"));
        assert!(!is_newer("v1.7.2", "v1.7.2"));
    }

    // Fixture: "slimrdm-update-signature-test-fixture" signed with the real
    // UPDATE_PUBLIC_KEY's private key via `tauri signer sign`. Signatures don't
    // reveal the private key, so pinning one here is safe and gives real
    // regression coverage for the embedded production key.
    //
    // Regenerate both this and RETIRED_KEY_SIGNATURE_B64's role whenever
    // UPDATE_PUBLIC_KEY changes:
    //   printf '%s' 'slimrdm-update-signature-test-fixture' > fixture.bin
    //   npx tauri signer sign -f ~/.tauri/slimrdm-updater.key fixture.bin
    // then paste the contents of fixture.bin.sig below.
    const FIXTURE_PAYLOAD: &[u8] = b"slimrdm-update-signature-test-fixture";
    const FIXTURE_SIGNATURE_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSZ2tGWmJWSjZuank1OTgwTWs3MlUvQnkxL09SdkRob2VMMXh3dlVwOGJ3VU80UjVLbzkxSUJ4dEtCVWxYQ25TOUV1QkZ5VlJrMHBsWnhmYnZ0ZFJBNXl4amdqMzA5REFJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg3MjI5MTA0CWZpbGU6Zml4dHVyZS5iaW4Kdnc0RHlabU9uVE1NSy9raHNzNnQyYXBaRUVwUHNkc2pkMlZubUk1c0ttVXoxbW9rcnJ5V0NLNDVMYUZTbTNBbVNRdzRZa0tULzFSLzBudTVCdGVzQVE9PQo=";

    #[test]
    fn test_verify_update_signature_valid() {
        assert!(verify_update_signature(FIXTURE_PAYLOAD, FIXTURE_SIGNATURE_B64).is_ok());
    }

    #[test]
    fn test_verify_update_signature_tampered_payload() {
        let tampered = b"slimrdm-update-signature-test-fixturE";
        assert!(verify_update_signature(tampered, FIXTURE_SIGNATURE_B64).is_err());
    }

    #[test]
    fn test_verify_update_signature_missing() {
        assert!(verify_update_signature(FIXTURE_PAYLOAD, "").is_err());
    }

    #[test]
    fn test_verify_update_signature_malformed() {
        assert!(verify_update_signature(FIXTURE_PAYLOAD, "not-a-real-signature").is_err());
    }

    // FIXTURE_PAYLOAD signed by the retired 1.7.7 placeholder key
    // (id eb7630ffc599df8f). The rotation is only real if this no longer
    // verifies, so pin it rather than deleting it.
    const RETIRED_KEY_SIGNATURE_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUcmRqRC94Wm5mai92U2FEbkFoSXNjVXNHZml5MkFBU1ZQWjduREZmcVB2d2N4S0w0NGxoYlJ2K3BRUHlrcEJYblNXczBYUGxlWUtVMXMwY0Z6RWJLQTRPOGtORndiUFFJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg0OTM1NjQyCWZpbGU6Zml4dHVyZS5iaW4KSGNwd2NBRW1xdHhxclA2eGNuaGF3Rk9EQytmNW5oTXBQZEw2azlLM2VxdTNIOVJqZjVXZ050MUY4WG1VK1dBb2tlLzM0Rm9XTk1rQkxUbzJydjNLQkE9PQo=";

    #[test]
    fn test_verify_update_signature_rejects_retired_key() {
        assert!(verify_update_signature(FIXTURE_PAYLOAD, RETIRED_KEY_SIGNATURE_B64).is_err());
    }

    #[test]
    fn test_verify_update_signature_wrong_key() {
        // Signed with the unrelated throwaway test key generated during development,
        // not UPDATE_PUBLIC_KEY — must be rejected.
        let other_key_signature_b64 = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTQnFoZktnRWlTRHdMSGNaK3d1NlMvZ2xZYmx3SW1tUStTQ0dmN3h4eEtZdE9SRDJFdVlGRlZHN1hOaWM0R0JZYmJWblZvR0FWaDU1cG5LeGN6V0VTZDljODdlYzFzYWdvPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg0OTM1NTY4CWZpbGU6cGF5bG9hZC5iaW4KNDZaWlBVeXFHV2RwczlPd3Fud0RrUlVyaXN0Sk9FMmRCd3BJQzF0T3ZpNHVMaklZU0h2L0VnVnd2YUFxSjV5ZW1FSGRUL2dGYzV1N0ZnckZZcm1HQ2c9PQo=";
        assert!(verify_update_signature(b"test-payload", other_key_signature_b64).is_err());
    }
}
