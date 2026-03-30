mod cache;
mod github;
mod storage;

use chrono::Utc;
use std::collections::HashMap;
use storage::{AppSettings, FileViewEntry, RepoConfig, ViewState};

// --- Settings commands ---

#[tauri::command]
async fn get_settings() -> Result<AppSettings, String> {
    storage::read_settings().await
}

#[tauri::command]
async fn save_settings(settings: AppSettings) -> Result<(), String> {
    storage::write_settings(&settings).await
}

// --- View state commands ---

#[tauri::command]
async fn get_last_viewed() -> Result<ViewState, String> {
    storage::read_view_state().await
}

#[tauri::command]
async fn mark_pr_viewed(pr_url: String) -> Result<(), String> {
    let mut state = storage::read_view_state().await?;
    state
        .last_viewed
        .insert(pr_url, Utc::now().to_rfc3339());
    storage::write_view_state(&state).await
}

// --- File viewed state commands ---

#[tauri::command]
async fn mark_file_viewed(
    owner: String,
    repo: String,
    pr_number: u64,
    filename: String,
    sha: String,
    commit_sha: Option<String>,
) -> Result<(), String> {
    let mut state = storage::read_view_state().await?;
    let key = format!("{owner}/{repo}/{pr_number}/{filename}");
    state.file_viewed.insert(
        key,
        FileViewEntry {
            sha,
            viewed_at: Utc::now().to_rfc3339(),
            commit_sha,
        },
    );
    storage::write_view_state(&state).await
}

#[tauri::command]
async fn get_files_viewed(
    owner: String,
    repo: String,
    pr_number: u64,
) -> Result<HashMap<String, FileViewEntry>, String> {
    let state = storage::read_view_state().await?;
    let prefix = format!("{owner}/{repo}/{pr_number}/");
    let filtered: HashMap<String, FileViewEntry> = state
        .file_viewed
        .into_iter()
        .filter(|(k, _)| k.starts_with(&prefix))
        .map(|(k, v)| (k[prefix.len()..].to_string(), v))
        .collect();
    Ok(filtered)
}

// --- GitHub commands ---

#[tauri::command]
async fn get_github_user(token: String) -> Result<github::GitHubUser, String> {
    github::fetch_user_info(&token).await
}

#[tauri::command]
async fn get_collaborators(
    owner: String,
    repo: String,
    token: String,
) -> Result<Vec<github::GitHubUser>, String> {
    github::fetch_repo_collaborators(&owner, &repo, &token).await
}

#[tauri::command]
async fn get_open_prs(
    repos: Vec<RepoConfig>,
    token: String,
    username: String,
) -> Result<Vec<github::PrWithMeta>, String> {
    let mut all_prs = Vec::new();

    // Split repos by filter mode
    let all_repos: Vec<_> = repos.iter().filter(|r| r.filter_mode != "involved").collect();
    let involved_repos: Vec<_> = repos.iter().filter(|r| r.filter_mode == "involved").collect();

    if !involved_repos.is_empty() && username.is_empty() {
        return Err("Username is required for 'Mine + Tagged' filter mode. Set it in Settings.".to_string());
    }

    // Fetch "all" repos normally
    let all_fetches: Vec<_> = all_repos
        .iter()
        .map(|repo| github::fetch_open_prs(&repo.owner, &repo.repo, &token))
        .collect();
    // Fetch "involved" repos via search API
    let involved_fetches: Vec<_> = involved_repos
        .iter()
        .map(|repo| github::fetch_involved_prs(&repo.owner, &repo.repo, &username, &token))
        .collect();

    let (all_results, involved_results) = tokio::join!(
        futures::future::join_all(all_fetches),
        futures::future::join_all(involved_fetches),
    );

    for (repo, result) in all_repos.iter().zip(all_results) {
        match result {
            Ok(prs) => all_prs.extend(prs),
            Err(e) => eprintln!("Error fetching {}/{}: {e}", repo.owner, repo.repo),
        }
    }

    for (repo, result) in involved_repos.iter().zip(involved_results) {
        match result {
            Ok(prs) => all_prs.extend(prs),
            Err(e) => eprintln!("Error fetching {}/{}: {e}", repo.owner, repo.repo),
        }
    }
    // Deduplicate by (repo_owner, repo_name, number)
    all_prs.sort_by(|a, b| b.pr.updated_at.cmp(&a.pr.updated_at));
    all_prs.dedup_by(|a, b| {
        a.repo_owner == b.repo_owner && a.repo_name == b.repo_name && a.pr.number == b.pr.number
    });
    Ok(all_prs)
}

#[tauri::command]
async fn get_pr_files(
    owner: String,
    repo: String,
    pr_number: u64,
    token: String,
) -> Result<Vec<github::PrFile>, String> {
    github::fetch_pr_files(&owner, &repo, pr_number, &token).await
}

#[tauri::command]
async fn get_compare_files(
    owner: String,
    repo: String,
    base: String,
    head: String,
    token: String,
) -> Result<Vec<github::PrFile>, String> {
    github::fetch_compare(&owner, &repo, &base, &head, &token).await
}

#[tauri::command]
async fn get_activity_summary(
    owner: String,
    repo: String,
    pr_number: u64,
    since: Option<String>,
    token: String,
) -> Result<github::ActivitySummary, String> {
    github::fetch_pr_activity(&owner, &repo, pr_number, since.as_deref(), &token).await
}

// --- Review commands ---

#[tauri::command]
async fn get_reviews(
    owner: String,
    repo: String,
    pr_number: u64,
    token: String,
) -> Result<Vec<github::Review>, String> {
    let result = github::fetch_pr_reviews(&owner, &repo, pr_number, &token).await?;
    let reviews = result.clone();
    let _ = cache::update_pr_cache(&owner, &repo, pr_number, |c| c.reviews = reviews).await;
    Ok(result)
}

#[tauri::command]
async fn submit_review(
    owner: String,
    repo: String,
    pr_number: u64,
    event: String,
    body: String,
    token: String,
) -> Result<github::ReviewResponse, String> {
    github::submit_pr_review(&owner, &repo, pr_number, &event, &body, &token).await
}

// --- Comment commands ---

#[tauri::command]
async fn get_comments(
    owner: String,
    repo: String,
    pr_number: u64,
    token: String,
) -> Result<Vec<github::IssueComment>, String> {
    let result = github::fetch_issue_comments(&owner, &repo, pr_number, &token).await?;
    let comments = result.clone();
    let _ = cache::update_pr_cache(&owner, &repo, pr_number, |c| c.issue_comments = comments).await;
    Ok(result)
}

#[tauri::command]
async fn post_comment(
    owner: String,
    repo: String,
    pr_number: u64,
    body: String,
    token: String,
) -> Result<github::IssueComment, String> {
    github::post_issue_comment(&owner, &repo, pr_number, &body, &token).await
}

#[tauri::command]
async fn get_inline_comments(
    owner: String,
    repo: String,
    pr_number: u64,
    token: String,
) -> Result<Vec<github::InlineComment>, String> {
    let result = github::fetch_pr_inline_comments(&owner, &repo, pr_number, &token).await?;
    let comments = result.clone();
    let _ = cache::update_pr_cache(&owner, &repo, pr_number, |c| c.inline_comments = comments).await;
    Ok(result)
}

#[tauri::command]
async fn post_inline_comment(
    owner: String,
    repo: String,
    pr_number: u64,
    body: String,
    commit_id: String,
    path: String,
    line: u64,
    token: String,
) -> Result<github::InlineComment, String> {
    github::post_pr_inline_comment(&owner, &repo, pr_number, &body, &commit_id, &path, line, &token).await
}

#[tauri::command]
async fn merge_pr(
    owner: String,
    repo: String,
    pr_number: u64,
    merge_method: String,
    token: String,
) -> Result<github::MergeResult, String> {
    let result = github::merge_pr(&owner, &repo, pr_number, &merge_method, &token).await?;
    let _ = cache::remove_pr_from_cache(&owner, &repo, pr_number).await;
    Ok(result)
}

#[tauri::command]
async fn close_pr(
    owner: String,
    repo: String,
    pr_number: u64,
    token: String,
) -> Result<(), String> {
    github::close_pr(&owner, &repo, pr_number, &token).await?;
    let _ = cache::remove_pr_from_cache(&owner, &repo, pr_number).await;
    Ok(())
}

#[tauri::command]
async fn reply_to_inline_comment(
    owner: String,
    repo: String,
    pr_number: u64,
    body: String,
    comment_id: u64,
    token: String,
) -> Result<github::InlineComment, String> {
    github::reply_to_inline_comment(&owner, &repo, pr_number, &body, comment_id, &token).await
}

#[tauri::command]
async fn mark_ready_for_review(
    owner: String,
    repo: String,
    pr_number: u64,
    token: String,
) -> Result<(), String> {
    github::mark_pr_ready_for_review(&owner, &repo, pr_number, &token).await
}

#[tauri::command]
async fn edit_pr_body(
    owner: String,
    repo: String,
    pr_number: u64,
    body: String,
    token: String,
) -> Result<(), String> {
    github::edit_pr_body(&owner, &repo, pr_number, &body, &token).await
}

#[tauri::command]
async fn edit_comment(
    owner: String,
    repo: String,
    comment_id: u64,
    body: String,
    token: String,
) -> Result<github::IssueComment, String> {
    github::edit_issue_comment(&owner, &repo, comment_id, &body, &token).await
}

#[tauri::command]
async fn edit_inline_comment(
    owner: String,
    repo: String,
    comment_id: u64,
    body: String,
    token: String,
) -> Result<github::InlineComment, String> {
    github::edit_inline_comment(&owner, &repo, comment_id, &body, &token).await
}

#[tauri::command]
async fn get_check_status(
    owner: String,
    repo: String,
    git_ref: String,
    token: String,
) -> Result<github::CheckStatus, String> {
    github::fetch_check_status(&owner, &repo, &git_ref, &token).await
}

#[tauri::command]
async fn get_pr_head_sha(
    owner: String,
    repo: String,
    pr_number: u64,
    token: String,
) -> Result<String, String> {
    github::fetch_pr_head_sha(&owner, &repo, pr_number, &token).await
}

#[tauri::command]
async fn proxy_image(url: String, token: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "pr-review-land")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{content_type};base64,{b64}"))
}

// --- Cache commands ---

#[tauri::command]
async fn get_dashboard_cached() -> Result<Option<cache::DashboardCache>, String> {
    cache::read_dashboard_cache().await
}

#[tauri::command]
async fn get_pr_detail_cached(
    owner: String,
    repo: String,
    pr_number: u64,
) -> Result<Option<cache::PrDetailCache>, String> {
    cache::read_pr_cache(&owner, &repo, pr_number).await
}

#[tauri::command]
async fn refresh_dashboard(
    repos: Vec<RepoConfig>,
    token: String,
    username: String,
) -> Result<cache::DashboardCache, String> {
    // Fetch PRs (reuse the same logic as get_open_prs)
    let mut all_prs = Vec::new();

    let all_repos: Vec<_> = repos.iter().filter(|r| r.filter_mode != "involved").collect();
    let involved_repos: Vec<_> = repos.iter().filter(|r| r.filter_mode == "involved").collect();

    if !involved_repos.is_empty() && username.is_empty() {
        return Err(
            "Username is required for 'Mine + Tagged' filter mode. Set it in Settings.".to_string(),
        );
    }

    let all_fetches: Vec<_> = all_repos
        .iter()
        .map(|repo| github::fetch_open_prs(&repo.owner, &repo.repo, &token))
        .collect();
    let involved_fetches: Vec<_> = involved_repos
        .iter()
        .map(|repo| github::fetch_involved_prs(&repo.owner, &repo.repo, &username, &token))
        .collect();

    let (all_results, involved_results) = tokio::join!(
        futures::future::join_all(all_fetches),
        futures::future::join_all(involved_fetches),
    );

    for (repo, result) in all_repos.iter().zip(all_results) {
        match result {
            Ok(prs) => all_prs.extend(prs),
            Err(e) => eprintln!("Error fetching {}/{}: {e}", repo.owner, repo.repo),
        }
    }
    for (repo, result) in involved_repos.iter().zip(involved_results) {
        match result {
            Ok(prs) => all_prs.extend(prs),
            Err(e) => eprintln!("Error fetching {}/{}: {e}", repo.owner, repo.repo),
        }
    }

    all_prs.sort_by(|a, b| b.pr.updated_at.cmp(&a.pr.updated_at));
    all_prs.dedup_by(|a, b| {
        a.repo_owner == b.repo_owner && a.repo_name == b.repo_name && a.pr.number == b.pr.number
    });

    // Fetch view state for activity
    let vs = storage::read_view_state().await?;

    // Fetch activity summaries in parallel
    let activity_futures: Vec<_> = all_prs
        .iter()
        .filter(|pr| vs.last_viewed.contains_key(&pr.pr.html_url))
        .map(|pr| {
            let url = pr.pr.html_url.clone();
            let since = vs.last_viewed.get(&pr.pr.html_url).cloned();
            let owner = pr.repo_owner.clone();
            let repo_name = pr.repo_name.clone();
            let number = pr.pr.number;
            let token = token.clone();
            async move {
                let result = github::fetch_pr_activity(
                    &owner,
                    &repo_name,
                    number,
                    since.as_deref(),
                    &token,
                )
                .await;
                (url, result)
            }
        })
        .collect();

    let activity_results = futures::future::join_all(activity_futures).await;
    let mut activity_map: HashMap<String, github::ActivitySummary> = HashMap::new();
    for (url, result) in activity_results {
        if let Ok(summary) = result {
            activity_map.insert(url, summary);
        }
    }

    // Fetch check statuses in parallel
    let check_futures: Vec<_> = all_prs
        .iter()
        .filter_map(|pr| {
            pr.pr.head.as_ref().map(|head| {
                let url = pr.pr.html_url.clone();
                let owner = pr.repo_owner.clone();
                let repo_name = pr.repo_name.clone();
                let sha = head.sha.clone();
                let token = token.clone();
                async move {
                    let result =
                        github::fetch_check_status(&owner, &repo_name, &sha, &token).await;
                    (url, result)
                }
            })
        })
        .collect();

    let check_results = futures::future::join_all(check_futures).await;
    let mut checks_map: HashMap<String, github::CheckStatus> = HashMap::new();
    for (url, result) in check_results {
        if let Ok(status) = result {
            checks_map.insert(url, status);
        }
    }

    let dashboard = cache::DashboardCache {
        fetched_at: Utc::now().to_rfc3339(),
        prs: all_prs.clone(),
        activity: activity_map,
        checks: checks_map,
    };

    // Write cache, then clean up orphaned PR caches
    cache::write_dashboard_cache(&dashboard).await?;
    let _ = cache::cleanup_orphaned_pr_caches(&all_prs).await;

    Ok(dashboard)
}

#[tauri::command]
async fn refresh_pr_detail(
    owner: String,
    repo: String,
    pr_number: u64,
    token: String,
) -> Result<cache::PrDetailCache, String> {
    // Fetch everything in parallel
    let (files_res, sha_res, inline_res, comments_res, reviews_res, collabs_res, commits_res) = tokio::join!(
        github::fetch_pr_files(&owner, &repo, pr_number, &token),
        github::fetch_pr_head_sha(&owner, &repo, pr_number, &token),
        github::fetch_pr_inline_comments(&owner, &repo, pr_number, &token),
        github::fetch_issue_comments(&owner, &repo, pr_number, &token),
        github::fetch_pr_reviews(&owner, &repo, pr_number, &token),
        github::fetch_repo_collaborators(&owner, &repo, &token),
        github::fetch_pr_commits(&owner, &repo, pr_number, &token),
    );

    let files = files_res?;
    let head_sha = sha_res?;
    let inline_comments = inline_res?;
    let issue_comments = comments_res?;
    let reviews = reviews_res?;
    let collaborators = collabs_res.unwrap_or_default();
    let commits = commits_res.unwrap_or_default();

    // Fetch check status using the head SHA
    let check_status = github::fetch_check_status(&owner, &repo, &head_sha, &token)
        .await
        .ok();

    let detail = cache::PrDetailCache {
        fetched_at: Utc::now().to_rfc3339(),
        head_sha,
        files,
        inline_comments,
        issue_comments,
        reviews,
        check_status,
        collaborators,
        commits,
    };

    cache::write_pr_cache(&owner, &repo, pr_number, &detail).await?;

    Ok(detail)
}

#[tauri::command]
async fn clear_dashboard_cache() -> Result<(), String> {
    cache::delete_dashboard_cache().await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_last_viewed,
            mark_pr_viewed,
            mark_file_viewed,
            get_files_viewed,
            get_github_user,
            get_collaborators,
            get_open_prs,
            get_pr_files,
            get_compare_files,
            get_activity_summary,
            submit_review,
            get_reviews,
            get_comments,
            post_comment,
            get_inline_comments,
            post_inline_comment,
            reply_to_inline_comment,
            merge_pr,
            close_pr,
            get_pr_head_sha,
            get_check_status,
            mark_ready_for_review,
            edit_pr_body,
            edit_comment,
            edit_inline_comment,
            proxy_image,
            get_dashboard_cached,
            get_pr_detail_cached,
            refresh_dashboard,
            refresh_pr_detail,
            clear_dashboard_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
