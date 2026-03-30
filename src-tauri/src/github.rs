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
pub struct PrHeadRef {
    pub sha: String,
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
    #[serde(default)]
    pub comments: u64,
    #[serde(default)]
    pub head: Option<PrHeadRef>,
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
pub struct PrCommit {
    pub sha: String,
    pub commit: CommitDetail,
    pub author: Option<GitHubUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitDetail {
    pub message: String,
    pub author: CommitAuthor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitAuthor {
    pub name: String,
    pub date: String,
}

pub async fn fetch_pr_commits(
    owner: &str,
    repo: &str,
    pr_number: u64,
    token: &str,
) -> Result<Vec<PrCommit>, String> {
    let c = client(token)?;
    let resp = c
        .get(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}/commits?per_page=100"
        ))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }

    resp.json::<Vec<PrCommit>>()
        .await
        .map_err(|e| format!("Failed to parse PR commits: {e}"))
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

/// Compare two commits and return per-file diffs.
pub async fn fetch_compare(
    owner: &str,
    repo: &str,
    base: &str,
    head: &str,
    token: &str,
) -> Result<Vec<PrFile>, String> {
    let c = client(token)?;
    let resp = c
        .get(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/compare/{base}...{head}?per_page=100"
        ))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }

    #[derive(Deserialize)]
    struct CompareResponse {
        files: Option<Vec<PrFile>>,
    }

    let compare: CompareResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse compare response: {e}"))?;

    Ok(compare.files.unwrap_or_default())
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
    #[serde(default)]
    pub in_reply_to_id: Option<u64>,
    /// Whether this comment belongs to a resolved thread (populated via GraphQL)
    #[serde(default)]
    pub is_resolved: bool,
}

/// Fetch resolved thread root comment IDs via GraphQL.
async fn fetch_resolved_thread_ids(
    c: &reqwest::Client,
    owner: &str,
    repo: &str,
    pr_number: u64,
) -> std::collections::HashSet<u64> {
    let query = r#"
        query($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
                pullRequest(number: $number) {
                    reviewThreads(first: 100) {
                        nodes {
                            isResolved
                            comments(first: 1) {
                                nodes { databaseId }
                            }
                        }
                    }
                }
            }
        }
    "#;

    #[derive(Deserialize)]
    struct GqlResponse {
        data: Option<GqlData>,
    }
    #[derive(Deserialize)]
    struct GqlData {
        repository: Option<GqlRepo>,
    }
    #[derive(Deserialize)]
    struct GqlRepo {
        #[serde(rename = "pullRequest")]
        pull_request: Option<GqlPr>,
    }
    #[derive(Deserialize)]
    struct GqlPr {
        #[serde(rename = "reviewThreads")]
        review_threads: GqlConnection<GqlThread>,
    }
    #[derive(Deserialize)]
    struct GqlConnection<T> {
        nodes: Vec<T>,
    }
    #[derive(Deserialize)]
    struct GqlThread {
        #[serde(rename = "isResolved")]
        is_resolved: bool,
        comments: GqlConnection<GqlComment>,
    }
    #[derive(Deserialize)]
    struct GqlComment {
        #[serde(rename = "databaseId")]
        database_id: Option<u64>,
    }

    let body = serde_json::json!({
        "query": query,
        "variables": {
            "owner": owner,
            "repo": repo,
            "number": pr_number as i64,
        }
    });

    let resp = match c
        .post("https://api.github.com/graphql")
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return std::collections::HashSet::new(),
    };

    let gql: GqlResponse = match resp.json().await {
        Ok(g) => g,
        Err(_) => return std::collections::HashSet::new(),
    };

    let mut resolved_ids = std::collections::HashSet::new();
    if let Some(data) = gql.data {
        if let Some(repo) = data.repository {
            if let Some(pr) = repo.pull_request {
                for thread in pr.review_threads.nodes {
                    if thread.is_resolved {
                        for comment in thread.comments.nodes {
                            if let Some(id) = comment.database_id {
                                resolved_ids.insert(id);
                            }
                        }
                    }
                }
            }
        }
    }
    resolved_ids
}

pub async fn fetch_pr_inline_comments(
    owner: &str,
    repo: &str,
    pr_number: u64,
    token: &str,
) -> Result<Vec<InlineComment>, String> {
    let c = client(token)?;

    let (comments_resp, resolved_ids) = tokio::join!(
        c.get(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}/comments?per_page=100"
        ))
        .send(),
        fetch_resolved_thread_ids(&c, owner, repo, pr_number),
    );

    let resp = comments_resp.map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }

    let mut comments: Vec<InlineComment> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse inline comments: {e}"))?;

    // Mark comments as resolved: a comment is resolved if its thread root is in resolved_ids.
    // Thread root = the comment itself (if no in_reply_to_id) or the in_reply_to_id.
    for comment in &mut comments {
        let thread_root = comment.in_reply_to_id.unwrap_or(comment.id);
        if resolved_ids.contains(&thread_root) {
            comment.is_resolved = true;
        }
    }

    Ok(comments)
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

pub async fn reply_to_inline_comment(
    owner: &str,
    repo: &str,
    pr_number: u64,
    body: &str,
    comment_id: u64,
    token: &str,
) -> Result<InlineComment, String> {
    let c = client(token)?;
    let resp = c
        .post(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}/comments/{comment_id}/replies"
        ))
        .json(&serde_json::json!({
            "body": body,
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

// --- Merge / Close PR ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub sha: Option<String>,
    pub merged: bool,
    pub message: String,
}

pub async fn merge_pr(
    owner: &str,
    repo: &str,
    pr_number: u64,
    merge_method: &str,
    token: &str,
) -> Result<MergeResult, String> {
    let c = client(token)?;
    let resp = c
        .put(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}/merge"
        ))
        .json(&serde_json::json!({
            "merge_method": merge_method,
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub API error {status}: {text}"));
    }

    resp.json::<MergeResult>()
        .await
        .map_err(|e| format!("Failed to parse merge response: {e}"))
}

pub async fn close_pr(
    owner: &str,
    repo: &str,
    pr_number: u64,
    token: &str,
) -> Result<(), String> {
    let c = client(token)?;
    let resp = c
        .patch(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}"
        ))
        .json(&serde_json::json!({
            "state": "closed",
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub API error {status}: {text}"));
    }

    Ok(())
}

// --- Draft / Ready for review ---

pub async fn mark_pr_ready_for_review(
    owner: &str,
    repo: &str,
    pr_number: u64,
    token: &str,
) -> Result<(), String> {
    // This requires the GraphQL API — no REST endpoint exists for this
    let c = client(token)?;
    // First get the node ID of the PR
    let query = r#"
        query($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
                pullRequest(number: $number) { id }
            }
        }
    "#;

    #[derive(Deserialize)]
    struct GqlResp {
        data: Option<GqlData>,
    }
    #[derive(Deserialize)]
    struct GqlData {
        repository: Option<GqlRepo>,
    }
    #[derive(Deserialize)]
    struct GqlRepo {
        #[serde(rename = "pullRequest")]
        pull_request: Option<GqlPr>,
    }
    #[derive(Deserialize)]
    struct GqlPr {
        id: String,
    }

    let resp = c
        .post("https://api.github.com/graphql")
        .json(&serde_json::json!({
            "query": query,
            "variables": { "owner": owner, "repo": repo, "number": pr_number as i64 }
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let gql: GqlResp = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse GraphQL response: {e}"))?;

    let pr_id = gql
        .data
        .and_then(|d| d.repository)
        .and_then(|r| r.pull_request)
        .map(|p| p.id)
        .ok_or("Could not find PR node ID")?;

    // Now call the markPullRequestReadyForReview mutation
    let mutation = r#"
        mutation($prId: ID!) {
            markPullRequestReadyForReview(input: { pullRequestId: $prId }) {
                pullRequest { isDraft }
            }
        }
    "#;

    let resp2 = c
        .post("https://api.github.com/graphql")
        .json(&serde_json::json!({
            "query": mutation,
            "variables": { "prId": pr_id }
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp2.status().is_success() {
        let text = resp2.text().await.unwrap_or_default();
        return Err(format!("GitHub API error: {text}"));
    }

    // Check for GraphQL errors
    let body: serde_json::Value = resp2
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    if let Some(errors) = body.get("errors") {
        return Err(format!("GraphQL error: {errors}"));
    }

    Ok(())
}

// --- Editing ---

pub async fn edit_pr_body(
    owner: &str,
    repo: &str,
    pr_number: u64,
    body: &str,
    token: &str,
) -> Result<(), String> {
    let c = client(token)?;
    let resp = c
        .patch(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}"
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
    Ok(())
}

pub async fn edit_issue_comment(
    owner: &str,
    repo: &str,
    comment_id: u64,
    body: &str,
    token: &str,
) -> Result<IssueComment, String> {
    let c = client(token)?;
    let resp = c
        .patch(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/issues/comments/{comment_id}"
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

pub async fn edit_inline_comment(
    owner: &str,
    repo: &str,
    comment_id: u64,
    body: &str,
    token: &str,
) -> Result<InlineComment, String> {
    let c = client(token)?;
    let resp = c
        .patch(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/pulls/comments/{comment_id}"
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

// --- Check / CI status ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckRun {
    pub name: String,
    /// queued, in_progress, completed
    pub status: String,
    /// success, failure, neutral, cancelled, skipped, timed_out, action_required, null
    pub conclusion: Option<String>,
    #[serde(default)]
    pub html_url: Option<String>,
}

/// Overall check status for a PR
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckStatus {
    /// success, failure, pending
    pub state: String,
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub pending: usize,
    pub runs: Vec<CheckRun>,
}

#[derive(Debug, Clone, Deserialize)]
struct CombinedStatus {
    statuses: Vec<StatusEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct StatusEntry {
    state: String,
    context: String,
    #[serde(default)]
    target_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct CheckRunsResponse {
    check_runs: Vec<CheckRun>,
}

pub async fn fetch_check_status(
    owner: &str,
    repo: &str,
    git_ref: &str,
    token: &str,
) -> Result<CheckStatus, String> {
    let c = client(token)?;

    let (status_resp, checks_resp) = tokio::join!(
        c.get(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/commits/{git_ref}/status"
        ))
        .send(),
        c.get(format!(
            "{GITHUB_API}/repos/{owner}/{repo}/commits/{git_ref}/check-runs"
        ))
        .send(),
    );

    // Parse commit statuses
    let statuses: Vec<StatusEntry> = match status_resp {
        Ok(r) if r.status().is_success() => {
            r.json::<CombinedStatus>()
                .await
                .map(|s| s.statuses)
                .unwrap_or_default()
        }
        _ => Vec::new(),
    };

    // Parse check runs
    let check_runs: Vec<CheckRun> = match checks_resp {
        Ok(r) if r.status().is_success() => {
            r.json::<CheckRunsResponse>()
                .await
                .map(|s| s.check_runs)
                .unwrap_or_default()
        }
        _ => Vec::new(),
    };

    // Convert commit statuses into CheckRun-like entries
    let mut all_runs: Vec<CheckRun> = statuses
        .into_iter()
        .map(|s| {
            let (status, conclusion) = match s.state.as_str() {
                "success" => ("completed".to_string(), Some("success".to_string())),
                "failure" | "error" => ("completed".to_string(), Some("failure".to_string())),
                _ => ("in_progress".to_string(), None),
            };
            CheckRun {
                name: s.context,
                status,
                conclusion,
                html_url: s.target_url,
            }
        })
        .collect();

    all_runs.extend(check_runs);

    let total = all_runs.len();
    let passed = all_runs
        .iter()
        .filter(|r| r.conclusion.as_deref() == Some("success") || r.conclusion.as_deref() == Some("skipped"))
        .count();
    let failed = all_runs
        .iter()
        .filter(|r| matches!(r.conclusion.as_deref(), Some("failure") | Some("timed_out") | Some("cancelled") | Some("action_required")))
        .count();
    let pending = total - passed - failed;

    let state = if total == 0 {
        "none".to_string()
    } else if failed > 0 {
        "failure".to_string()
    } else if pending > 0 {
        "pending".to_string()
    } else {
        "success".to_string()
    };

    Ok(CheckStatus {
        state,
        total,
        passed,
        failed,
        pending,
        runs: all_runs,
    })
}
