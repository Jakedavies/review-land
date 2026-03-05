import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "@solidjs/router";
import { Show } from "solid-js";

interface Label {
  name: string;
  color: string;
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
  new_comments: number;
  new_reviews: number;
  is_mine: boolean;
  review_requested: boolean;
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

  const updatedSinceViewed = () => {
    if (!props.last_viewed_at) return false;
    return props.updated_at > props.last_viewed_at;
  };

  const hasActivity = () => props.new_comments > 0 || updatedSinceViewed();

  return (
    <div
      class={`bg-gray-900 rounded-lg border px-3 py-2 hover:border-indigo-500 transition-all cursor-pointer ${
        hasActivity() ? "border-indigo-700" : "border-gray-800"
      }`}
      onClick={handleClick}
    >
      <div class="flex items-center gap-2 min-w-0">
        {reviewDot(props.review_state, props.draft)}
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
          <Show when={props.new_comments > 0}>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-900 text-indigo-300">
              {props.new_comments} comment{props.new_comments !== 1 ? "s" : ""}
            </span>
          </Show>
          <Show when={updatedSinceViewed()}>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-900 text-orange-300">
              Updated
            </span>
          </Show>
          <Show when={props.last_viewed_at && !updatedSinceViewed()}>
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
