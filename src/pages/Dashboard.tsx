import { For, Show } from "solid-js";
import { createSignal } from "solid-js";
import PRCard from "../components/PRCard";
import { usePRData } from "../PRDataContext";

type Filter = "all" | "mine" | "review_requested";

function Dashboard() {
  const { prs, activity, lastViewed, settings, loading, error, loadData } = usePRData();
  const [filter, setFilter] = createSignal<Filter>("all");

  const username = () => settings()?.username || "";

  const filteredPrs = () => {
    const all = prs();
    const user = username();
    switch (filter()) {
      case "mine":
        return all.filter((pr) => pr.user.login === user);
      case "review_requested":
        return all.filter((pr) =>
          pr.requested_reviewers.some((r) => r.login === user),
        );
      default:
        return all;
    }
  };

  const counts = () => {
    const all = prs();
    const user = username();
    return {
      all: all.length,
      mine: all.filter((pr) => pr.user.login === user).length,
      review_requested: all.filter((pr) =>
        pr.requested_reviewers.some((r) => r.login === user),
      ).length,
    };
  };

  const filterBtn = (f: Filter, label: string, count: number) => (
    <button
      onClick={() => setFilter(f)}
      class={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        filter() === f
          ? "bg-indigo-600 text-white"
          : "bg-gray-900 text-gray-300 hover:bg-gray-800 border border-gray-700"
      }`}
    >
      {label}
      <span
        class={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
          filter() === f
            ? "bg-indigo-500 text-white"
            : "bg-gray-800 text-gray-400"
        }`}
      >
        {count}
      </span>
    </button>
  );

  return (
    <div>
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-lg font-bold">Dashboard</h2>
        <button
          onClick={loadData}
          disabled={loading()}
          class="px-3 py-1 bg-gray-900 border border-gray-700 rounded-lg text-xs font-medium text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {loading() ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <Show when={error()}>
        <div class="bg-red-950 border border-red-800 rounded-lg p-3 mb-2 text-sm text-red-300">
          {error()}
        </div>
      </Show>

      <Show when={!error()}>
        {/* Filters */}
        <div class="flex gap-2 mb-2">
          {filterBtn("all", "All PRs", counts().all)}
          {filterBtn("mine", "Created by me", counts().mine)}
          {filterBtn(
            "review_requested",
            "Review requested",
            counts().review_requested,
          )}
        </div>

        {/* PR List */}
        <Show
          when={!loading() || prs().length > 0}
          fallback={
            <div class="text-center py-12 text-gray-500">Loading PRs...</div>
          }
        >
          <div class="space-y-1">
            <For each={filteredPrs()}>
              {(pr) => {
                const act = () => activity()[pr.html_url];
                const viewedAt = () => lastViewed()[pr.html_url];
                return (
                  <PRCard
                    number={pr.number}
                    title={pr.title}
                    html_url={pr.html_url}
                    repo_owner={pr.repo_owner}
                    repo_name={pr.repo_name}
                    author={pr.user.login}
                    author_avatar={pr.user.avatar_url}
                    created_at={pr.created_at}
                    updated_at={pr.updated_at}
                    last_viewed_at={viewedAt()}
                    labels={pr.labels}
                    draft={pr.draft}
                    review_state={pr.review_state}
                    new_comments={act()?.new_comments?.length ?? 0}
                    new_reviews={act()?.new_reviews?.length ?? 0}
                    is_mine={pr.user.login === username()}
                    review_requested={pr.requested_reviewers.some(
                      (r) => r.login === username(),
                    )}
                    onViewed={loadData}
                  />
                );
              }}
            </For>
          </div>
          <Show when={filteredPrs().length === 0 && !loading()}>
            <div class="text-center py-12 text-gray-500">
              No PRs match this filter.
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

export default Dashboard;
