mod commands;
mod store;
mod error;

use tauri::Manager;

fn init_logger(data_dir: std::path::PathBuf) {
    use std::fs::OpenOptions;
    let log_path = data_dir.join("slimrdm.log");
    // Rotate at startup if the log exceeds 5 MB so it doesn't grow unbounded.
    if std::fs::metadata(&log_path).map(|m| m.len()).unwrap_or(0) > 5_000_000 {
        let _ = std::fs::rename(&log_path, data_dir.join("slimrdm.log.1"));
    }
    if let Ok(file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        env_logger::Builder::new()
            .filter_level(log::LevelFilter::Off)
            .filter_module("russh", log::LevelFilter::Debug)
            .filter_module("slimrdm", log::LevelFilter::Debug)
            .target(env_logger::Target::Pipe(Box::new(file)))
            .format_timestamp_secs()
            .init();
    }
}


pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            store::init(app.handle())?;
            if let Ok(data_dir) = app.path().app_data_dir() {
                commands::known_hosts::init(data_dir.clone());
                commands::logging::sweep_orphans(&data_dir.join("session-logs"));
                init_logger(data_dir);
            }
            commands::claude_sessions::sync_on_startup(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Connection management
            commands::connections::list_connections,
            commands::connections::add_connection,
            commands::connections::update_connection,
            commands::connections::delete_connection,
            commands::connections::get_connection,
            // Categories
            commands::categories::list_categories,
            commands::categories::add_category,
            commands::categories::update_category,
            commands::categories::delete_category,
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
            // TRM (local terminal)
            commands::trm::trm_connect,
            commands::trm::trm_disconnect,
            commands::trm::trm_send_input,
            commands::trm::trm_resize,
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
            // Tunnels (runtime)
            commands::tunnels::open_tunnel,
            commands::tunnels::list_tunnels,
            commands::tunnels::close_tunnel,
            // Tunnel configs (persisted)
            commands::tunnels::list_tunnel_configs,
            commands::tunnels::add_tunnel_config,
            commands::tunnels::update_tunnel_config,
            commands::tunnels::delete_tunnel_config,
            // Updates
            commands::updates::check_for_updates,
            commands::updates::download_and_install_update,
            // Claude session journal
            commands::claude_sessions::sync_claude_sessions_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SlimRDM");
}
