import { For, Show } from "solid-js";
import { createSignal } from "solid-js";
import PRCard from "../components/PRCard";
import { usePRData, type PrWithMeta } from "../PRDataContext";

type Filter = "all" | "mine" | "review_requested";

function Dashboard() {
  const { prs, activity, lastViewed, checks, settings, loading, error, loadData } = usePRData();
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
          {(() => {
            const user = username();
            const prMeta = (pr: PrWithMeta) => {
              const act = activity()[pr.html_url];
              const viewedAt = lastViewed()[pr.html_url];
              const newComments = act?.new_comments?.filter((c) => c.user.login !== user).length ?? 0;
              const newReviews = act?.new_reviews?.filter((r) => r.user.login !== user).length ?? 0;
              const totalActivity = (act?.new_comments?.length ?? 0) + (act?.new_reviews?.length ?? 0);
              const onlyOwn = totalActivity > 0 && newComments + newReviews === 0;
              const hasNew = newComments > 0 || newReviews > 0;
              const updatedSinceViewed = viewedAt && !onlyOwn && pr.updated_at > viewedAt;
              const needsAttention = !viewedAt || hasNew || updatedSinceViewed;
              return { act, viewedAt, newComments, newReviews, onlyOwn, needsAttention };
            };

            const needsAttention = () => filteredPrs().filter((pr) => prMeta(pr).needsAttention);
            const upToDate = () => filteredPrs().filter((pr) => !prMeta(pr).needsAttention);

            const renderPr = (pr: PrWithMeta) => {
              const m = prMeta(pr);
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
                  last_viewed_at={m.viewedAt}
                  labels={pr.labels}
                  draft={pr.draft}
                  review_state={pr.review_state}
                  total_comments={pr.comments}
                  new_comments={m.newComments}
                  new_reviews={m.newReviews}
                  only_own_activity={m.onlyOwn}
                  is_mine={pr.user.login === user}
                  review_requested={pr.requested_reviewers.some(
                    (r) => r.login === user,
                  )}
                  check_status={checks()[pr.html_url]}
                  onViewed={loadData}
                />
              );
            };

            return (
              <>
                <Show when={needsAttention().length > 0}>
                  <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    Needs attention
                    <span class="ml-1.5 px-1.5 py-0.5 rounded-full text-xs normal-case tracking-normal bg-indigo-900 text-indigo-300">
                      {needsAttention().length}
                    </span>
                  </h3>
                  <div class="space-y-1 mb-4">
                    <For each={needsAttention()}>
                      {renderPr}
                    </For>
                  </div>
                </Show>
                <Show when={upToDate().length > 0}>
                  <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    Up to date
                    <span class="ml-1.5 px-1.5 py-0.5 rounded-full text-xs normal-case tracking-normal bg-gray-800 text-gray-400">
                      {upToDate().length}
                    </span>
                  </h3>
                  <div class="space-y-1">
                    <For each={upToDate()}>
                      {renderPr}
                    </For>
                  </div>
                </Show>
                <Show when={filteredPrs().length === 0 && !loading()}>
                  <div class="text-center py-12 text-gray-500">
                    No PRs match this filter.
                  </div>
                </Show>
              </>
            );
          })()}
        </Show>
      </Show>
    </div>
  );
}

export default Dashboard;
