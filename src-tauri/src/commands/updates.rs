use serde::{Deserialize, Serialize};

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const RELEASES_API: &str = "https://api.github.com/repos/GnomishGames/slimRDM/releases/latest";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: Option<String>,
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

fn pick_asset_url(assets: &[GithubAsset]) -> Option<String> {
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
            return Some(asset.browser_download_url.clone());
        }
    }
    None
}

const RELEASE_URL_PREFIX: &str = "https://github.com/GnomishGames/slimRDM/releases/download/";

#[tauri::command]
pub async fn download_and_install_update(url: String) -> Result<(), String> {
    if !url.starts_with(RELEASE_URL_PREFIX) {
        return Err("Invalid update URL: must be a slimRDM GitHub release asset".into());
    }

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

    let filename = url.split('/').last().unwrap_or("installer");
    let tmp_path = std::env::temp_dir().join(filename);

    std::fs::write(&tmp_path, &bytes)
        .map_err(|e| format!("Write failed: {}", e))?;

    launch_installer(&tmp_path, filename)
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
    let download_url = if has_update { pick_asset_url(&release.assets) } else { None };

    Ok(UpdateInfo {
        has_update,
        current_version: CURRENT_VERSION.to_string(),
        latest_version: release.tag_name.trim_start_matches('v').to_string(),
        download_url,
        release_notes: release.body,
    })
}
