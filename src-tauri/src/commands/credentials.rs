use keyring::Entry;

const SERVICE: &str = "slimrdm";

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
