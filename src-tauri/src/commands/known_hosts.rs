use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

static KNOWN_HOSTS_PATH: OnceLock<PathBuf> = OnceLock::new();

lazy_static::lazy_static! {
    static ref KNOWN_HOSTS: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
}

pub fn init(app_data_dir: PathBuf) {
    let path = app_data_dir.join("known_hosts.json");
    KNOWN_HOSTS_PATH.get_or_init(|| path.clone());
    if let Ok(data) = std::fs::read_to_string(&path) {
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&data) {
            *KNOWN_HOSTS.lock().unwrap() = map;
        }
    }
}

fn save(hosts: &HashMap<String, String>) {
    if let Some(path) = KNOWN_HOSTS_PATH.get() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(data) = serde_json::to_string(hosts) {
            let _ = std::fs::write(path, data);
        }
    }
}

/// Trust-on-first-use host key check.
/// - Unknown host: stores the fingerprint and returns Ok(true).
/// - Known host, key matches: returns Ok(true).
/// - Known host, key changed: returns Err with a warning message.
pub fn check_or_store(host: &str, fingerprint: &str) -> Result<bool, String> {
    let mut hosts = KNOWN_HOSTS.lock().unwrap();
    match hosts.get(host) {
        None => {
            hosts.insert(host.to_string(), fingerprint.to_string());
            save(&hosts);
            Ok(true)
        }
        Some(stored) if stored == fingerprint => Ok(true),
        Some(stored) => Err(format!(
            "Host key mismatch for '{host}'! \
             Stored: {stored}, Got: {fingerprint}. \
             Connection refused to prevent a potential MITM attack. \
             If the host key legitimately changed, remove it from known_hosts.json in the app data directory."
        )),
    }
}
