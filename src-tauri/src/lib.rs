mod commands;
mod store;
mod error;


pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            // Initialize the credential store
            store::init(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Connection management
            commands::connections::list_connections,
            commands::connections::add_connection,
            commands::connections::update_connection,
            commands::connections::delete_connection,
            commands::connections::get_connection,
            // Groups
            commands::groups::list_groups,
            commands::groups::add_group,
            commands::groups::update_group,
            commands::groups::delete_group,
            // SSH
            commands::ssh::ssh_connect,
            commands::ssh::ssh_disconnect,
            commands::ssh::ssh_send_input,
            commands::ssh::ssh_resize,
            // RDP
            commands::rdp::rdp_connect,
            commands::rdp::rdp_disconnect,
            commands::rdp::rdp_mouse_event,
            commands::rdp::rdp_key_event,
            commands::rdp::rdp_type_text,
            commands::rdp::rdp_resize,
            // Clipboard
            commands::clipboard::clipboard_get_system,
            commands::clipboard::clipboard_set_system,
            commands::clipboard::clipboard_get_rdp,
            commands::clipboard::clipboard_set_rdp,
            // Credentials
            commands::credentials::save_credential,
            commands::credentials::get_credential,
            commands::credentials::delete_credential,
            // Data
            commands::data::export_data,
            commands::data::import_data,
            // Updates
            commands::updates::check_for_updates,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SlimRDM");
}
