use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::fs;

fn default_filter_mode() -> String {
    "all".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoConfig {
    pub owner: String,
    pub repo: String,
    #[serde(default = "default_filter_mode")]
    pub filter_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    #[serde(default)]
    pub github_token: String,
    #[serde(default)]
    pub repos: Vec<RepoConfig>,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub refresh_interval_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ViewState {
    /// Maps PR URL to the last time the user viewed it (ISO 8601)
    #[serde(default)]
    pub last_viewed: HashMap<String, String>,
}

fn data_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("pr-review-land")
}

fn settings_path() -> PathBuf {
    data_dir().join("settings.json")
}

fn view_state_path() -> PathBuf {
    data_dir().join("view_state.json")
}

async fn ensure_data_dir() -> Result<(), String> {
    let dir = data_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .await
            .map_err(|e| format!("Failed to create data dir: {e}"))?;
    }
    Ok(())
}

pub async fn read_settings() -> Result<AppSettings, String> {
    let path = settings_path();
    if !path.exists() {
        return Ok(AppSettings {
            refresh_interval_secs: 300,
            ..Default::default()
        });
    }
    let data = fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read settings: {e}"))?;
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse settings: {e}"))
}

pub async fn write_settings(settings: &AppSettings) -> Result<(), String> {
    ensure_data_dir().await?;
    let data =
        serde_json::to_string_pretty(settings).map_err(|e| format!("Failed to serialize: {e}"))?;
    fs::write(settings_path(), data)
        .await
        .map_err(|e| format!("Failed to write settings: {e}"))
}

pub async fn read_view_state() -> Result<ViewState, String> {
    let path = view_state_path();
    if !path.exists() {
        return Ok(ViewState::default());
    }
    let data = fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read view state: {e}"))?;
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse view state: {e}"))
}

pub async fn write_view_state(state: &ViewState) -> Result<(), String> {
    ensure_data_dir().await?;
    let data =
        serde_json::to_string_pretty(state).map_err(|e| format!("Failed to serialize: {e}"))?;
    fs::write(view_state_path(), data)
        .await
        .map_err(|e| format!("Failed to write view state: {e}"))
}
