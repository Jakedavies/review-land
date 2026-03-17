import { createSignal, createContext, useContext, onMount, onCleanup, createMemo, type ParentProps, type Accessor } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

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

  const loadData = async () => {
    const s = await invoke<AppSettings>("get_settings");
    setSettings(s);

    if (!s.github_token || s.repos.length === 0) {
      setError("Configure your GitHub token and repos in Settings first.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [fetchedPrs, vs] = await Promise.all([
        invoke<PrWithMeta[]>("get_open_prs", {
          repos: s.repos,
          token: s.github_token,
          username: s.username,
        }),
        invoke<ViewState>("get_last_viewed"),
      ]);

      setPrs(fetchedPrs);
      setLastViewed(vs.last_viewed);

      const activityMap: Record<string, ActivitySummary> = {};
      const activityPromises = fetchedPrs
        .filter((pr) => vs.last_viewed[pr.html_url])
        .map(async (pr) => {
          try {
            const summary = await invoke<ActivitySummary>(
              "get_activity_summary",
              {
                owner: pr.repo_owner,
                repo: pr.repo_name,
                prNumber: pr.number,
                since: vs.last_viewed[pr.html_url],
                token: s.github_token,
              },
            );
            activityMap[pr.html_url] = summary;
          } catch {
            // Ignore individual PR activity fetch failures
          }
        });

      await Promise.all(activityPromises);
      setActivity(activityMap);

      // Fetch check statuses in background, updating incrementally
      setChecks({});
      for (const pr of fetchedPrs) {
        if (!pr.head?.sha) continue;
        invoke<CheckStatus>("get_check_status", {
          owner: pr.repo_owner,
          repo: pr.repo_name,
          gitRef: pr.head.sha,
          token: s.github_token,
        }).then((status) => {
          setChecks((prev) => ({ ...prev, [pr.html_url]: status }));
        }).catch(() => {});
      }
    } catch (e) {
      console.error("Failed to load PRs:", e);
      setError(`Failed to load PRs: ${e}`);
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
