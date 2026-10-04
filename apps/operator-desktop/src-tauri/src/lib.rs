pub mod monitor;
pub mod services;

#[cfg(feature = "desktop")]
mod desktop {
    use super::{
        monitor::{DashboardSnapshot, Monitor},
        services::{self, AutostartState},
    };
    use std::path::PathBuf;
    use tauri::State;

    #[tauri::command]
    async fn get_snapshot(
        monitor: State<'_, Monitor>,
        relay_url: String,
        node_url: String,
        reference_url: Option<String>,
    ) -> Result<DashboardSnapshot, String> {
        monitor
            .snapshot(&relay_url, &node_url, reference_url.as_deref())
            .await
    }

    #[tauri::command]
    async fn get_activity(
        monitor: State<'_, Monitor>,
        relay_url: String,
    ) -> Result<serde_json::Value, String> {
        monitor.activity(&relay_url).await
    }

    #[tauri::command]
    fn get_autostart_status() -> AutostartState {
        services::status()
    }

    #[tauri::command]
    fn install_autostart(relay_directory: String) -> Result<AutostartState, String> {
        services::install(&PathBuf::from(relay_directory)).map_err(|error| error.to_string())
    }

    #[tauri::command]
    fn set_autostart(enabled: bool) -> Result<AutostartState, String> {
        services::set_autostart(enabled).map_err(|error| error.to_string())
    }

    #[tauri::command]
    fn set_relay_running(running: bool) -> Result<AutostartState, String> {
        services::set_relay_running(running).map_err(|error| error.to_string())
    }

    pub fn run() {
        tauri::Builder::default()
            .manage(Monitor::new())
            .invoke_handler(tauri::generate_handler![
                get_snapshot,
                get_activity,
                get_autostart_status,
                install_autostart,
                set_autostart,
                set_relay_running,
            ])
            .run(tauri::generate_context!())
            .expect("failed to run OSSR Operator Desktop");
    }
}

#[cfg(feature = "desktop")]
pub use desktop::run;
