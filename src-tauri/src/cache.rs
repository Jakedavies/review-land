use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::fs;

use crate::github::{
    ActivitySummary, CheckStatus, GitHubUser, InlineComment, IssueComment, PrCommit, PrFile,
    PrWithMeta, Review,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardCache {
    pub fetched_at: String,
    pub prs: Vec<PrWithMeta>,
    pub activity: HashMap<String, ActivitySummary>,
    pub checks: HashMap<String, CheckStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrDetailCache {
    pub fetched_at: String,
    pub head_sha: String,
    pub files: Vec<PrFile>,
    pub inline_comments: Vec<InlineComment>,
    pub issue_comments: Vec<IssueComment>,
    pub reviews: Vec<Review>,
    pub check_status: Option<CheckStatus>,
    pub collaborators: Vec<GitHubUser>,
    #[serde(default)]
    pub commits: Vec<PrCommit>,
}

fn cache_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("pr-review-land").join("cache")
}

fn dashboard_cache_path() -> PathBuf {
    cache_dir().join("dashboard.json")
}

fn pr_cache_path(owner: &str, repo: &str, number: u64) -> PathBuf {
    cache_dir().join("pr").join(owner).join(repo).join(format!("{number}.json"))
}

async fn ensure_parent_dir(path: &PathBuf) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create cache dir: {e}"))?;
        }
    }
    Ok(())
}

pub async fn read_dashboard_cache() -> Result<Option<DashboardCache>, String> {
    let path = dashboard_cache_path();
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read dashboard cache: {e}"))?;
    let cache: DashboardCache =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse dashboard cache: {e}"))?;
    Ok(Some(cache))
}

pub async fn write_dashboard_cache(cache: &DashboardCache) -> Result<(), String> {
    let path = dashboard_cache_path();
    ensure_parent_dir(&path).await?;
    let data =
        serde_json::to_string_pretty(cache).map_err(|e| format!("Failed to serialize: {e}"))?;
    fs::write(&path, data)
        .await
        .map_err(|e| format!("Failed to write dashboard cache: {e}"))
}

pub async fn read_pr_cache(
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<Option<PrDetailCache>, String> {
    let path = pr_cache_path(owner, repo, number);
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read PR cache: {e}"))?;
    let cache: PrDetailCache =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse PR cache: {e}"))?;
    Ok(Some(cache))
}

pub async fn write_pr_cache(
    owner: &str,
    repo: &str,
    number: u64,
    cache: &PrDetailCache,
) -> Result<(), String> {
    let path = pr_cache_path(owner, repo, number);
    ensure_parent_dir(&path).await?;
    let data =
        serde_json::to_string_pretty(cache).map_err(|e| format!("Failed to serialize: {e}"))?;
    fs::write(&path, data)
        .await
        .map_err(|e| format!("Failed to write PR cache: {e}"))
}

/// Read-modify-write a PR cache entry. If no cache exists, this is a no-op.
pub async fn update_pr_cache(
    owner: &str,
    repo: &str,
    number: u64,
    mutate: impl FnOnce(&mut PrDetailCache),
) -> Result<(), String> {
    if let Some(mut detail) = read_pr_cache(owner, repo, number).await? {
        mutate(&mut detail);
        write_pr_cache(owner, repo, number, &detail).await?;
    }
    Ok(())
}

/// Remove a PR from the dashboard cache and delete its detail cache.
pub async fn remove_pr_from_cache(owner: &str, repo: &str, number: u64) -> Result<(), String> {
    // Remove from dashboard cache
    if let Some(mut dashboard) = read_dashboard_cache().await? {
        dashboard
            .prs
            .retain(|pr| !(pr.repo_owner == owner && pr.repo_name == repo && pr.pr.number == number));
        write_dashboard_cache(&dashboard).await?;
    }
    // Delete PR detail cache
    let path = pr_cache_path(owner, repo, number);
    if path.exists() {
        let _ = fs::remove_file(&path).await;
    }
    Ok(())
}

pub async fn delete_dashboard_cache() -> Result<(), String> {
    let path = dashboard_cache_path();
    if path.exists() {
        fs::remove_file(&path)
            .await
            .map_err(|e| format!("Failed to delete dashboard cache: {e}"))?;
    }
    Ok(())
}

/// Remove cached PR detail files for PRs no longer in the open list.
pub async fn cleanup_orphaned_pr_caches(open_prs: &[PrWithMeta]) -> Result<(), String> {
    use std::collections::HashSet;

    let open_keys: HashSet<String> = open_prs
        .iter()
        .map(|pr| format!("{}/{}/{}", pr.repo_owner, pr.repo_name, pr.pr.number))
        .collect();

    let pr_dir = cache_dir().join("pr");
    if !pr_dir.exists() {
        return Ok(());
    }

    let mut owners = fs::read_dir(&pr_dir)
        .await
        .map_err(|e| format!("Failed to read pr cache dir: {e}"))?;

    while let Some(owner_entry) = owners
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read dir entry: {e}"))?
    {
        let owner_name = owner_entry.file_name().to_string_lossy().to_string();
        let owner_path = owner_entry.path();
        if !owner_path.is_dir() {
            continue;
        }

        let mut repos = fs::read_dir(&owner_path)
            .await
            .map_err(|e| format!("Failed to read repo dir: {e}"))?;

        while let Some(repo_entry) = repos
            .next_entry()
            .await
            .map_err(|e| format!("Failed to read dir entry: {e}"))?
        {
            let repo_name = repo_entry.file_name().to_string_lossy().to_string();
            let repo_path = repo_entry.path();
            if !repo_path.is_dir() {
                continue;
            }

            let mut files = fs::read_dir(&repo_path)
                .await
                .map_err(|e| format!("Failed to read PR cache dir: {e}"))?;

            while let Some(file_entry) = files
                .next_entry()
                .await
                .map_err(|e| format!("Failed to read dir entry: {e}"))?
            {
                let fname = file_entry.file_name().to_string_lossy().to_string();
                if let Some(num_str) = fname.strip_suffix(".json") {
                    if let Ok(num) = num_str.parse::<u64>() {
                        let key = format!("{owner_name}/{repo_name}/{num}");
                        if !open_keys.contains(&key) {
                            let _ = fs::remove_file(file_entry.path()).await;
                        }
                    }
                }
            }
        }
    }

    Ok(())
}
