import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "@solidjs/router";
import { Show } from "solid-js";

interface Label {
  name: string;
  color: string;
}

interface CheckStatus {
  state: string;
  total: number;
  passed: number;
  failed: number;
  pending: number;
}

interface PRCardProps {
  number: number;
  title: string;
  html_url: string;
  repo_owner: string;
  repo_name: string;
  author: string;
  author_avatar: string;
  created_at: string;
  updated_at: string;
  last_viewed_at?: string;
  labels: Label[];
  draft: boolean;
  review_state: string | null;
  total_comments: number;
  new_comments: number;
  new_reviews: number;
  only_own_activity: boolean;
  is_mine: boolean;
  review_requested: boolean;
  check_status?: CheckStatus;
  onViewed?: () => void;
}

function reviewDot(state: string | null, draft: boolean) {
  if (draft) {
    return <span class="w-2 h-2 rounded-full bg-gray-500 flex-shrink-0" title="Draft" />;
  }
  switch (state) {
    case "APPROVED":
      return <span class="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" title="Approved" />;
    case "CHANGES_REQUESTED":
      return <span class="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" title="Changes requested" />;
    default:
      return <span class="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" title="Pending review" />;
  }
}

function checkIcon(status?: CheckStatus) {
  if (!status || status.state === "none") return null;
  switch (status.state) {
    case "success":
      return (
        <span class="flex-shrink-0" title={`${status.passed}/${status.total} checks passed`}>
          <svg class="w-3.5 h-3.5 text-green-400" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M8 16A8 8 0 108 0a8 8 0 000 16zm3.78-9.72a.75.75 0 00-1.06-1.06L7 8.94 5.28 7.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25z" />
          </svg>
        </span>
      );
    case "failure":
      return (
        <span class="flex-shrink-0" title={`${status.failed} check${status.failed !== 1 ? "s" : ""} failed`}>
          <svg class="w-3.5 h-3.5 text-red-400" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M8 16A8 8 0 108 0a8 8 0 000 16zm3.03-11.03a.75.75 0 010 1.06L9.06 8l1.97 1.97a.75.75 0 01-1.06 1.06L8 9.06l-1.97 1.97a.75.75 0 01-1.06-1.06L6.94 8 4.97 6.03a.75.75 0 011.06-1.06L8 6.94l1.97-1.97a.75.75 0 011.06 0z" />
          </svg>
        </span>
      );
    case "pending":
      return (
        <span class="flex-shrink-0" title={`${status.pending} check${status.pending !== 1 ? "s" : ""} pending`}>
          <svg class="w-3.5 h-3.5 text-yellow-400 animate-[spin_3s_linear_infinite]" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M8 16A8 8 0 108 0a8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v3.69L5.22 10.47a.75.75 0 001.06 1.06l2.5-2.5a.75.75 0 00.22-.53V4.75z" />
          </svg>
        </span>
      );
    default:
      return null;
  }
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const secs = Math.floor((now - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function PRCard(props: PRCardProps) {
  const navigate = useNavigate();

  const handleClick = async () => {
    await invoke("mark_pr_viewed", { prUrl: props.html_url });
    props.onViewed?.();
    navigate(`/diff/${props.repo_owner}/${props.repo_name}/${props.number}`);
  };

  const handleExternalLink = async (e: Event) => {
    e.stopPropagation();
    await invoke("mark_pr_viewed", { prUrl: props.html_url });
    await openUrl(props.html_url);
    props.onViewed?.();
  };

  const hasNewActivity = () => props.new_comments > 0 || props.new_reviews > 0;

  const updatedSinceViewed = () => {
    if (!props.last_viewed_at) return false;
    if (props.only_own_activity) return false;
    return props.updated_at > props.last_viewed_at;
  };

  const hasActivity = () => hasNewActivity() || updatedSinceViewed();

  return (
    <div
      class={`bg-gray-900 rounded-lg border px-3 py-2 hover:border-indigo-500 transition-all cursor-pointer ${
        hasActivity() ? "border-indigo-700" : "border-gray-800"
      }`}
      onClick={handleClick}
    >
      <div class="flex items-center gap-2 min-w-0">
        {reviewDot(props.review_state, props.draft)}
        {checkIcon(props.check_status)}
        <img
          src={props.author_avatar}
          alt={props.author}
          class="w-4 h-4 rounded-full flex-shrink-0"
        />
        <span class="text-xs text-gray-500 font-mono flex-shrink-0">
          {props.repo_owner}/{props.repo_name}#{props.number}
        </span>
        <h3 class="text-sm font-medium text-gray-100 truncate flex-1 min-w-0">
          {props.title}
        </h3>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          {props.draft && (
            <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-800 text-gray-400">
              Draft
            </span>
          )}
          {props.is_mine && (
            <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-900 text-blue-300">
              Mine
            </span>
          )}
          {props.review_requested && (
            <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-900 text-purple-300">
              Review
            </span>
          )}
          <Show when={props.total_comments > 0}>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-800 text-gray-400">
              {props.total_comments} comment{props.total_comments !== 1 ? "s" : ""}
            </span>
          </Show>
          <Show when={hasNewActivity()}>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-900 text-indigo-300">
              {props.new_comments + props.new_reviews} new
            </span>
          </Show>
          <Show when={!hasNewActivity() && updatedSinceViewed()}>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-900 text-orange-300">
              Updated
            </span>
          </Show>
          <Show when={props.last_viewed_at && !hasActivity()}>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-800 text-gray-400">
              Viewed {timeAgo(props.last_viewed_at!)}
            </span>
          </Show>
          <span class="text-[10px] text-gray-500" title={`Updated ${props.updated_at}`}>
            {timeAgo(props.updated_at)}
          </span>
          <button
            onClick={handleExternalLink}
            class="p-0.5 rounded hover:bg-gray-800 transition-colors text-gray-500 hover:text-gray-300"
            title="Open on GitHub"
          >
            <svg
              class="w-3 h-3"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"
              />
            </svg>
          </button>
        </div>
      </div>
      <Show when={props.labels.length > 0}>
        <div class="flex flex-wrap gap-1 mt-1 ml-[26px]">
          {props.labels.map((label) => (
            <span
              class="px-1.5 py-0 rounded-full text-[10px] font-medium"
              style={{
                "background-color": `#${label.color}30`,
                color: `#${label.color}`,
                "text-shadow": "0 0 1px rgba(0,0,0,0.5)",
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
      </Show>
    </div>
  );
}

export default PRCard;
