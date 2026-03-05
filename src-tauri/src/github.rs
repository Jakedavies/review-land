use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};

const GITHUB_API: &str = "https://api.github.com";

fn client(token: &str) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .default_headers({
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(USER_AGENT, "pr-review-land".parse().unwrap());
            headers.insert(ACCEPT, "application/vnd.github+json".parse().unwrap());
            headers.insert(
                AUTHORIZATION,
                format!("Bearer {token}").parse().unwrap(),
            );
            headers
        })
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubUser {
    pub login: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub html_url: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    pub user: GitHubUser,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub labels: Vec<Label>,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub requested_reviewers: Vec<GitHubUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrWithMeta {
    #[serde(flatten)]
    pub pr: PullRequest,
    pub repo_owner: String,
    pub repo_name: String,
    pub review_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Review {
    pub id: u64,
    pub user: GitHubUser,
    pub state: String,
    #[serde(default)]
    pub body: Option<String>,
    pub submitted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comment {
    pub id: u64,
    pub user: GitHubUser,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivitySummary {
    pub pr_url: String,
    pub new_comments: Vec<Comment>,
    pub new_reviews: Vec<Review>,
}

pub async fn fetch_user_info(token: &str) -> Result<GitHubUser, String> {
    let c = client(token)?;
    let resp = c
        .get(format!("{GITHUB_API}/user"))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }

    resp.json::<GitHubUser>()
        .await
        .map_err(|e| format!("Failed to parse user: {e}"))
}

pub async fn fetch_repo_collaborators(
    owner: &str,
    repo: &str,
    token: &str,
) -> Result<Vec<GitHubUser>, String> {
    let c = client(token)?;
    let resp = c
        .get(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/collaborators?per_page=100"
        ))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        // Fallback: if we don't have permission for collaborators, try assignees
        let resp2 = c
            .get(format!(
                "{GITHUB_API}/repos/{owner}/{repo}/assignees?per_page=100"
            ))
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        if !resp2.status().is_success() {
            return Err(format!("GitHub API error: {}", resp2.status()));
        }

        return resp2
            .json::<Vec<GitHubUser>>()
            .await
            .map_err(|e| format!("Failed to parse assignees: {e}"));
    }

    resp.json::<Vec<GitHubUser>>()
        .await
        .map_err(|e| format!("Failed to parse collaborators: {e}"))
}

// Search API response types
#[derive(Debug, Clone, Deserialize)]
struct SearchResult {
    items: Vec<PullRequest>,
}

pub async fn fetch_involved_prs(
    owner: &str,
    repo: &str,
    username: &str,
    token: &str,
) -> Result<Vec<PrWithMeta>, String> {
    let c = client(token)?;
    let query = format!("repo:{owner}/{repo} is:pr is:open involves:{username}");
    let resp = c
        .get(format!("{GITHUB_API}/search/issues"))
        .query(&[("q", &query), ("per_page", &"100".to_string())])
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "GitHub search API error for {owner}/{repo}: {}",
            resp.status()
        ));
    }

    let search: SearchResult = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse search results: {e}"))?;

    // Fetch review states in parallel
    let review_futures: Vec<_> = search
        .items
        .iter()
        .map(|pr| fetch_latest_review_state(&c, owner, repo, pr.number))
        .collect();
    let review_states = futures::future::join_all(review_futures).await;

    let results: Vec<PrWithMeta> = search
        .items
        .into_iter()
        .zip(review_states)
        .map(|(pr, review_state)| PrWithMeta {
            pr,
            repo_owner: owner.to_string(),
            repo_name: repo.to_string(),
            review_state,
        })
        .collect();

    Ok(results)
}

pub async fn fetch_open_prs(
    owner: &str,
    repo: &str,
    token: &str,
) -> Result<Vec<PrWithMeta>, String> {
    let c = client(token)?;

    // Fetch open PRs
    let resp = c
        .get(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls?state=open&per_page=100"
        ))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "GitHub API error for {owner}/{repo}: {}",
            resp.status()
        ));
    }

    let prs: Vec<PullRequest> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse PRs: {e}"))?;

    // Fetch review states in parallel
    let review_futures: Vec<_> = prs
        .iter()
        .map(|pr| fetch_latest_review_state(&c, owner, repo, pr.number))
        .collect();
    let review_states = futures::future::join_all(review_futures).await;

    let results: Vec<PrWithMeta> = prs
        .into_iter()
        .zip(review_states)
        .map(|(pr, review_state)| PrWithMeta {
            pr,
            repo_owner: owner.to_string(),
            repo_name: repo.to_string(),
            review_state,
        })
        .collect();

    Ok(results)
}

pub async fn fetch_pr_reviews(
    owner: &str,
    repo: &str,
    pr_number: u64,
    token: &str,
) -> Result<Vec<Review>, String> {
    let c = client(token)?;
    let resp = c
        .get(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}/reviews?per_page=100"
        ))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }

    resp.json::<Vec<Review>>()
        .await
        .map_err(|e| format!("Failed to parse reviews: {e}"))
}

async fn fetch_latest_review_state(
    c: &reqwest::Client,
    owner: &str,
    repo: &str,
    pr_number: u64,
) -> Option<String> {
    let resp = c
        .get(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}/reviews?per_page=100"
        ))
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let reviews: Vec<Review> = resp.json().await.ok()?;

    // Find the most recent non-COMMENTED review
    reviews
        .iter()
        .rev()
        .find(|r| r.state != "COMMENTED" && r.state != "PENDING" && r.state != "DISMISSED")
        .map(|r| r.state.clone())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrFile {
    pub sha: String,
    pub filename: String,
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    pub changes: u64,
    pub patch: Option<String>,
    pub previous_filename: Option<String>,
}

pub async fn fetch_pr_files(
    owner: &str,
    repo: &str,
    pr_number: u64,
    token: &str,
) -> Result<Vec<PrFile>, String> {
    let c = client(token)?;
    let resp = c
        .get(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}/files?per_page=100"
        ))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }

    resp.json::<Vec<PrFile>>()
        .await
        .map_err(|e| format!("Failed to parse PR files: {e}"))
}

pub async fn fetch_pr_activity(
    owner: &str,
    repo: &str,
    pr_number: u64,
    since: Option<&str>,
    token: &str,
) -> Result<ActivitySummary, String> {
    let c = client(token)?;

    let mut comments_url = format!(
        "{GITHUB_API}/repos/{owner}/{repo}/issues/{pr_number}/comments?per_page=100"
    );
    if let Some(since_ts) = since {
        comments_url.push_str(&format!("&since={since_ts}"));
    }

    let reviews_url = format!(
        "{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}/reviews?per_page=100"
    );

    let (comments_resp, reviews_resp) = tokio::join!(
        c.get(&comments_url).send(),
        c.get(&reviews_url).send(),
    );

    let new_comments: Vec<Comment> = async {
        let r = comments_resp.ok()?;
        if !r.status().is_success() { return None; }
        r.json::<Vec<Comment>>().await.ok()
    }.await.unwrap_or_default();

    let all_reviews: Vec<Review> = async {
        let r = reviews_resp.ok()?;
        if !r.status().is_success() { return None; }
        r.json::<Vec<Review>>().await.ok()
    }.await.unwrap_or_default();

    // Filter reviews by since timestamp
    let new_reviews: Vec<Review> = if let Some(since_ts) = since {
        all_reviews
            .into_iter()
            .filter(|r| {
                r.submitted_at
                    .as_deref()
                    .map(|t| t > since_ts)
                    .unwrap_or(false)
            })
            .collect()
    } else {
        all_reviews
    };

    Ok(ActivitySummary {
        pr_url: format!("https://github.com/{owner}/{repo}/pull/{pr_number}"),
        new_comments,
        new_reviews,
    })
}

// --- Review submission ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewResponse {
    pub id: u64,
    pub state: String,
    #[serde(default)]
    pub html_url: Option<String>,
}

pub async fn submit_pr_review(
    owner: &str,
    repo: &str,
    pr_number: u64,
    event: &str,
    body: &str,
    token: &str,
) -> Result<ReviewResponse, String> {
    let c = client(token)?;
    let resp = c
        .post(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}/reviews"
        ))
        .json(&serde_json::json!({ "event": event, "body": body }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub API error {status}: {text}"));
    }

    resp.json::<ReviewResponse>()
        .await
        .map_err(|e| format!("Failed to parse review response: {e}"))
}

// --- Issue comments (general PR comments) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueComment {
    pub id: u64,
    pub user: GitHubUser,
    pub body: String,
    pub created_at: String,
    #[serde(default)]
    pub html_url: Option<String>,
}

pub async fn fetch_issue_comments(
    owner: &str,
    repo: &str,
    pr_number: u64,
    token: &str,
) -> Result<Vec<IssueComment>, String> {
    let c = client(token)?;
    let resp = c
        .get(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/issues/{pr_number}/comments?per_page=100"
        ))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }

    resp.json::<Vec<IssueComment>>()
        .await
        .map_err(|e| format!("Failed to parse comments: {e}"))
}

pub async fn post_issue_comment(
    owner: &str,
    repo: &str,
    pr_number: u64,
    body: &str,
    token: &str,
) -> Result<IssueComment, String> {
    let c = client(token)?;
    let resp = c
        .post(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/issues/{pr_number}/comments"
        ))
        .json(&serde_json::json!({ "body": body }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub API error {status}: {text}"));
    }

    resp.json::<IssueComment>()
        .await
        .map_err(|e| format!("Failed to parse comment response: {e}"))
}

// --- Inline PR comments (review comments on specific lines) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InlineComment {
    pub id: u64,
    pub user: GitHubUser,
    pub body: String,
    pub path: String,
    #[serde(default)]
    pub line: Option<u64>,
    #[serde(default)]
    pub side: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub html_url: Option<String>,
    #[serde(default)]
    pub commit_id: Option<String>,
}

pub async fn fetch_pr_inline_comments(
    owner: &str,
    repo: &str,
    pr_number: u64,
    token: &str,
) -> Result<Vec<InlineComment>, String> {
    let c = client(token)?;
    let resp = c
        .get(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}/comments?per_page=100"
        ))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }

    resp.json::<Vec<InlineComment>>()
        .await
        .map_err(|e| format!("Failed to parse inline comments: {e}"))
}

pub async fn post_pr_inline_comment(
    owner: &str,
    repo: &str,
    pr_number: u64,
    body: &str,
    commit_id: &str,
    path: &str,
    line: u64,
    token: &str,
) -> Result<InlineComment, String> {
    let c = client(token)?;
    let resp = c
        .post(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}/comments"
        ))
        .json(&serde_json::json!({
            "body": body,
            "commit_id": commit_id,
            "path": path,
            "line": line,
            "side": "RIGHT"
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub API error {status}: {text}"));
    }

    resp.json::<InlineComment>()
        .await
        .map_err(|e| format!("Failed to parse inline comment response: {e}"))
}

// --- PR head SHA ---

#[derive(Debug, Clone, Deserialize)]
struct PrDetail {
    head: PrHead,
}

#[derive(Debug, Clone, Deserialize)]
struct PrHead {
    sha: String,
}

pub async fn fetch_pr_head_sha(
    owner: &str,
    repo: &str,
    pr_number: u64,
    token: &str,
) -> Result<String, String> {
    let c = client(token)?;
    let resp = c
        .get(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}"
        ))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }

    let detail: PrDetail = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse PR detail: {e}"))?;

    Ok(detail.head.sha)
}
