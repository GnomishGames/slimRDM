use keyring::Entry;

pub const SERVICE: &str = "slimrdm";

/// Synchronous keyring fetch for use inside async command handlers.
/// Returns None if the ref is absent or the credential doesn't exist.
pub fn get_credential_sync(ref_key: &str) -> Option<String> {
    Entry::new(SERVICE, ref_key).ok()?.get_password().ok()
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
pub async fn get_credential(ref_key: String) -> std::result::Result<String, String> {
    let entry = Entry::new(SERVICE, &ref_key)
        .map_err(|e| e.to_string())?;
    entry.get_password()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_credential(ref_key: String) -> std::result::Result<(), String> {
    let entry = Entry::new(SERVICE, &ref_key)
        .map_err(|e| e.to_string())?;
    entry.delete_password()
        .map_err(|e| e.to_string())?;
    Ok(())
}
