import { createSignal, createContext, useContext, onMount, onCleanup, createMemo, type ParentProps, type Accessor } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

interface RepoConfig {
  owner: string;
  repo: string;
  filter_mode: string;
}

export interface AppSettings {
  github_token: string;
  repos: RepoConfig[];
  username: string;
  refresh_interval_secs: number;
}

interface Label {
  name: string;
  color: string;
}

interface GitHubUser {
  login: string;
  avatar_url: string;
}

export interface PrWithMeta {
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  updated_at: string;
  user: GitHubUser;
  body?: string;
  labels: Label[];
  draft: boolean;
  requested_reviewers: GitHubUser[];
  comments: number;
  repo_owner: string;
  repo_name: string;
  review_state: string | null;
  head?: { sha: string };
}

export interface CheckStatus {
  state: string; // "success" | "failure" | "pending" | "none"
  total: number;
  passed: number;
  failed: number;
  pending: number;
}

interface ViewState {
  last_viewed: Record<string, string>;
}

export interface ActivitySummary {
  pr_url: string;
  new_comments: { id: number; user: { login: string } }[];
  new_reviews: { id: number; user: { login: string }; state: string }[];
}

interface DashboardCache {
  fetched_at: string;
  prs: PrWithMeta[];
  activity: Record<string, ActivitySummary>;
  checks: Record<string, CheckStatus>;
}

interface PRDataContextValue {
  prs: Accessor<PrWithMeta[]>;
  activity: Accessor<Record<string, ActivitySummary>>;
  lastViewed: Accessor<Record<string, string>>;
  checks: Accessor<Record<string, CheckStatus>>;
  settings: Accessor<AppSettings | null>;
  loading: Accessor<boolean>;
  error: Accessor<string>;
  loadData: () => Promise<void>;
}

const PRDataCtx = createContext<PRDataContextValue>();

export function PRDataProvider(props: ParentProps) {
  const [prs, setPrs] = createSignal<PrWithMeta[]>([]);
  const [activity, setActivity] = createSignal<Record<string, ActivitySummary>>({});
  const [lastViewed, setLastViewed] = createSignal<Record<string, string>>({});
  const [checks, setChecks] = createSignal<Record<string, CheckStatus>>({});
  const [settings, setSettings] = createSignal<AppSettings | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  let refreshTimer: ReturnType<typeof setInterval>;
  let isFirstLoad = true;

  const notify = async (title: string, body: string) => {
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === "granted";
      }
      if (granted) {
        sendNotification({ title, body });
      }
    } catch {
      // Notifications not available
    }
  };

  const checkForNotifications = (oldPrs: PrWithMeta[], newPrs: PrWithMeta[], username: string) => {
    const oldByUrl = new Map(oldPrs.map((pr) => [pr.html_url, pr]));

    for (const pr of newPrs) {
      const old = oldByUrl.get(pr.html_url);
      if (!old) {
        // New PR opened
        notify(
          "New PR opened",
          `${pr.repo_owner}/${pr.repo_name}#${pr.number}: ${pr.title}`,
        );
      } else if (old.review_state !== "APPROVED" && pr.review_state === "APPROVED" && username && pr.user.login === username) {
        // My PR got approved by someone else
        notify(
          "PR approved",
          `${pr.repo_owner}/${pr.repo_name}#${pr.number}: ${pr.title}`,
        );
      } else if (username && pr.user.login === username && pr.comments > old.comments) {
        // New comments on a PR I authored
        const newCount = pr.comments - old.comments;
        notify(
          `${newCount} new comment${newCount > 1 ? "s" : ""} on your PR`,
          `${pr.repo_owner}/${pr.repo_name}#${pr.number}: ${pr.title}`,
        );
      }
    }
  };

  // Expose for testing: call window.__testNotification() in dev console
  (window as any).__testNotification = () => notify("Test Notification", "PR Review Land notifications are working!");

  const loadData = async () => {
    const s = await invoke<AppSettings>("get_settings");
    setSettings(s);

    if (!s.github_token || s.repos.length === 0) {
      setError("Configure your GitHub token and repos in Settings first.");
      return;
    }

    // Phase 1: Load from cache instantly
    let hasCache = false;
    try {
      const cached = await invoke<DashboardCache | null>("get_dashboard_cached");
      if (cached) {
        hasCache = true;
        const vs = await invoke<ViewState>("get_last_viewed");
        setPrs(cached.prs);
        setActivity(cached.activity);
        setChecks(cached.checks);
        setLastViewed(vs.last_viewed);
        setLoading(false);
      }
    } catch {
      // Cache read failed, proceed to fresh fetch
    }

    if (!hasCache) {
      setLoading(true);
    }
    setError("");

    // Phase 2: Refresh from GitHub in background
    try {
      const [dashboard, vs] = await Promise.all([
        invoke<DashboardCache>("refresh_dashboard", {
          repos: s.repos,
          token: s.github_token,
          username: s.username,
        }),
        invoke<ViewState>("get_last_viewed"),
      ]);

      if (!isFirstLoad) {
        checkForNotifications(prs(), dashboard.prs, s.username);
      }
      isFirstLoad = false;

      setPrs(dashboard.prs);
      setActivity(dashboard.activity);
      setChecks(dashboard.checks);
      setLastViewed(vs.last_viewed);
    } catch (e) {
      if (!hasCache) {
        console.error("Failed to load PRs:", e);
        setError(`Failed to load PRs: ${e}`);
      }
      // If we have cache, silently use stale data
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    loadData();
  });

  const setupRefresh = () => {
    if (refreshTimer) clearInterval(refreshTimer);
    const s = settings();
    const interval = (s?.refresh_interval_secs || 300) * 1000;
    refreshTimer = setInterval(loadData, interval);
  };

  createMemo(() => {
    const s = settings();
    if (s) setupRefresh();
  });

  onCleanup(() => {
    if (refreshTimer) clearInterval(refreshTimer);
  });

  return (
    <PRDataCtx.Provider value={{ prs, activity, lastViewed, checks, settings, loading, error, loadData }}>
      {props.children}
    </PRDataCtx.Provider>
  );
}

export function usePRData() {
  const ctx = useContext(PRDataCtx);
  if (!ctx) throw new Error("usePRData must be used within PRDataProvider");
  return ctx;
}
