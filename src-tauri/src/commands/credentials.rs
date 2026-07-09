use keyring::Entry;

pub const SERVICE: &str = "slimrdm";

/// Synchronous keyring fetch for use inside async command handlers.
/// Returns None if the ref is absent or the credential doesn't exist.
pub fn get_credential_sync(ref_key: &str) -> Option<String> {
    Entry::new(SERVICE, ref_key).ok()?.get_password().ok()
}

/// Async keyring fetch with a 3-second timeout.
/// Returns an error string if the keyring is locked, unavailable, or times out.
/// Call this from async RDP/SSH handlers instead of get_credential_sync to avoid
/// blocking the Tokio executor when the system keyring is locked.
pub async fn get_credential_async(ref_key: &str) -> Result<String, String> {
    let key = ref_key.to_owned();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        tokio::task::spawn_blocking(move || {
            Entry::new(SERVICE, &key)
                .map_err(|e| e.to_string())?
                .get_password()
                .map_err(|e| e.to_string())
        }),
    )
    .await
    .map_err(|_| "Keyring timed out — the system keyring may be locked".to_string())?
    .map_err(|e| format!("Keyring task failed: {e}"))?;

    result
}

#[tauri::command]
pub async fn save_credential(ref_key: String, password: String) -> std::result::Result<(), String> {
    let entry = Entry::new(SERVICE, &ref_key)
        .map_err(|e| e.to_string())?;
    entry.set_password(&password)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_credential(ref_key: String) -> std::result::Result<(), String> {
    let entry = Entry::new(SERVICE, &ref_key)
        .map_err(|e| e.to_string())?;
    entry.delete_password()
        .map_err(|e| e.to_string())?;
    Ok(())
}
