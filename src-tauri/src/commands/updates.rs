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
        "windows" => &[".msi", "_setup.exe", "-installer.exe"],
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
