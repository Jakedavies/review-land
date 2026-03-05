import { createSignal, onMount, Show, For } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import DiffViewer, { type PrFile, type InlineComment } from "../components/DiffViewer";
import FileTree from "../components/FileTree";
import ReviewPanel from "../components/ReviewPanel";
import CommentBox, { type Collaborator } from "../components/CommentBox";
import { usePRData } from "../PRDataContext";
import CommentBody from "../components/CommentBody";

interface AppSettings {
  github_token: string;
}

interface IssueComment {
  id: number;
  user: { login: string; avatar_url: string };
  body: string;
  created_at: string;
  html_url?: string;
}

interface ReviewComment {
  id: number;
  user: { login: string; avatar_url: string };
  state: string;
  body?: string;
  submitted_at?: string;
}

function DiffPage() {
  const params = useParams<{ owner: string; repo: string; number: string }>();
  const navigate = useNavigate();
  const [files, setFiles] = createSignal<PrFile[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [token, setToken] = createSignal("");
  const [inlineComments, setInlineComments] = createSignal<InlineComment[]>([]);
  const [headSha, setHeadSha] = createSignal("");
  const [descOpen, setDescOpen] = createSignal(false);
  const [comments, setComments] = createSignal<IssueComment[]>([]);
  const [reviews, setReviews] = createSignal<ReviewComment[]>([]);
  const [collaborators, setCollaborators] = createSignal<Collaborator[]>([]);

  let prDataAvailable = false;
  let matchedPr: ReturnType<typeof usePRData>["prs"] extends () => (infer T)[]
    ? T | undefined
    : undefined;

  try {
    const { prs } = usePRData();
    prDataAvailable = true;
    const found = prs().find(
      (p) =>
        p.repo_owner === params.owner &&
        p.repo_name === params.repo &&
        p.number === parseInt(params.number),
    );
    matchedPr = found;
  } catch {
    // Not inside PRDataProvider — skip description
  }

  const prNumber = () => parseInt(params.number);

  const fetchComments = async () => {
    if (!token()) return;
    try {
      const result = await invoke<IssueComment[]>("get_comments", {
        owner: params.owner,
        repo: params.repo,
        prNumber: prNumber(),
        token: token(),
      });
      setComments(result);
    } catch (e) {
      console.error("Failed to fetch comments:", e);
    }
  };

  const fetchInlineComments = async () => {
    if (!token()) return;
    try {
      const comments = await invoke<InlineComment[]>("get_inline_comments", {
        owner: params.owner,
        repo: params.repo,
        prNumber: prNumber(),
        token: token(),
      });
      setInlineComments(comments);
    } catch (e) {
      console.error("Failed to fetch inline comments:", e);
    }
  };

  onMount(async () => {
    try {
      const settings = await invoke<AppSettings>("get_settings");
      setToken(settings.github_token);

      const [result, sha] = await Promise.all([
        invoke<PrFile[]>("get_pr_files", {
          owner: params.owner,
          repo: params.repo,
          prNumber: prNumber(),
          token: settings.github_token,
        }),
        invoke<string>("get_pr_head_sha", {
          owner: params.owner,
          repo: params.repo,
          prNumber: prNumber(),
          token: settings.github_token,
        }),
      ]);
      setFiles(result);
      setHeadSha(sha);

      // Fetch inline comments
      const comments = await invoke<InlineComment[]>("get_inline_comments", {
        owner: params.owner,
        repo: params.repo,
        prNumber: prNumber(),
        token: settings.github_token,
      });
      setInlineComments(comments);

      // Fetch top-level comments and reviews
      const [topComments, prReviews] = await Promise.all([
        invoke<IssueComment[]>("get_comments", {
          owner: params.owner,
          repo: params.repo,
          prNumber: prNumber(),
          token: settings.github_token,
        }),
        invoke<ReviewComment[]>("get_reviews", {
          owner: params.owner,
          repo: params.repo,
          prNumber: prNumber(),
          token: settings.github_token,
        }),
      ]);
      setComments(topComments);
      setReviews(prReviews);

      // Fetch collaborators for @mention autocomplete
      try {
        const collabs = await invoke<Collaborator[]>("get_collaborators", {
          owner: params.owner,
          repo: params.repo,
          token: settings.github_token,
        });
        setCollaborators(collabs);
      } catch {
        // Non-critical — mentions just won't autocomplete
      }
    } catch (e) {
      console.error("Failed to load diff:", e);
      setError(`Failed to load diff: ${e}`);
    } finally {
      setLoading(false);
    }
  });

  const ghUrl = () =>
    `https://github.com/${params.owner}/${params.repo}/pull/${params.number}`;

  type TimelineItem =
    | { kind: "comment"; user: { login: string; avatar_url: string }; body: string; date: string }
    | { kind: "review"; user: { login: string; avatar_url: string }; state: string; body?: string; date: string };

  const timeline = () => {
    const items: TimelineItem[] = [];
    for (const c of comments()) {
      items.push({ kind: "comment", user: c.user, body: c.body, date: c.created_at });
    }
    for (const r of reviews()) {
      if (r.state === "PENDING") continue;
      items.push({ kind: "review", user: r.user, state: r.state, body: r.body || undefined, date: r.submitted_at || "" });
    }
    items.sort((a, b) => a.date.localeCompare(b.date));
    return items;
  };

  const reviewStateBadge = (state: string) => {
    switch (state) {
      case "APPROVED":
        return <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-900 text-green-300">Approved</span>;
      case "CHANGES_REQUESTED":
        return <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-900 text-red-300">Changes requested</span>;
      case "COMMENTED":
        return <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-800 text-gray-400">Reviewed</span>;
      case "DISMISSED":
        return <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-800 text-gray-500">Dismissed</span>;
      default:
        return <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-800 text-gray-400">{state}</span>;
    }
  };

  const handlePostComment = async (body: string) => {
    await invoke("post_comment", {
      owner: params.owner,
      repo: params.repo,
      prNumber: prNumber(),
      body,
      token: token(),
    });
    await fetchComments();
  };

  return (
    <div>
      <div class="flex items-center gap-3 mb-4 sticky top-[-12px] z-20 bg-gray-950 pb-2 pt-[12px] -mx-3 px-3 -mt-3">
        <button
          onClick={() => navigate("/")}
          class="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-900 border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
        >
          &larr; Back
        </button>
        <h2 class="text-lg font-bold text-gray-100 flex-1 min-w-0 truncate">
          {params.owner}/{params.repo}#{params.number}
        </h2>
        <button
          onClick={() => openUrl(ghUrl())}
          class="p-1.5 rounded hover:bg-gray-800 transition-colors text-gray-400 hover:text-gray-200"
          title="Open on GitHub"
        >
          <svg
            class="w-4 h-4"
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

      <Show when={matchedPr}>
        <div class="mb-4 bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <button
            class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-800 transition-colors"
            onClick={() => setDescOpen(!descOpen())}
          >
            <span class="text-gray-500 text-xs">
              {descOpen() ? "\u25BC" : "\u25B6"}
            </span>
            <img
              src={matchedPr!.user.avatar_url}
              class="w-5 h-5 rounded-full"
              alt=""
            />
            <span class="text-sm font-medium text-gray-200 truncate flex-1">
              {matchedPr!.title}
            </span>
            <span class="text-xs text-gray-500">
              {matchedPr!.user.login}
            </span>
          </button>
          <Show when={descOpen() && matchedPr!.body}>
            <div class="px-3 pb-3 border-t border-gray-800 pt-2">
              <CommentBody body={matchedPr!.body!} class="text-sm text-gray-300 whitespace-pre-wrap font-sans" />
            </div>
          </Show>
        </div>
      </Show>

      <Show when={error()}>
        <div class="bg-red-950 border border-red-800 rounded-lg p-3 text-sm text-red-300">
          {error()}
        </div>
      </Show>

      <Show when={loading()}>
        <div class="text-center py-12 text-gray-500">Loading diff...</div>
      </Show>

      <Show when={!loading() && !error()}>
        <div class="flex gap-3 items-start">
          <div class="w-56 flex-shrink-0 sticky top-[52px] max-h-[calc(100vh-72px)] overflow-y-auto">
            <FileTree files={files()} />
          </div>
          <div class="flex-1 min-w-0 space-y-4">
            <DiffViewer
              files={files()}
              owner={params.owner}
              repo={params.repo}
              prNumber={prNumber()}
              token={token()}
              inlineComments={inlineComments()}
              headSha={headSha()}
              onInlineCommentsChange={fetchInlineComments}
              collaborators={collaborators()}
            />
            <Show when={token()}>
              <ReviewPanel
                owner={params.owner}
                repo={params.repo}
                prNumber={prNumber()}
                token={token()}
                collaborators={collaborators()}
              />
              <div class="bg-gray-900 border border-gray-800 rounded-lg p-3 space-y-3">
                <h3 class="text-sm font-semibold text-gray-200">
                  Activity{timeline().length > 0 ? ` (${timeline().length})` : ""}
                </h3>
                <Show when={timeline().length > 0}>
                  <div class="space-y-2">
                    <For each={timeline()}>
                      {(item) => (
                        <div class={`bg-gray-950 border rounded-lg px-3 py-2 ${
                          item.kind === "review" && item.state === "APPROVED"
                            ? "border-green-900"
                            : item.kind === "review" && item.state === "CHANGES_REQUESTED"
                              ? "border-red-900"
                              : "border-gray-800"
                        }`}>
                          <div class="flex items-center gap-2 mb-1">
                            <img
                              src={item.user.avatar_url}
                              class="w-4 h-4 rounded-full"
                              alt=""
                            />
                            <span class="text-xs font-medium text-gray-200">
                              {item.user.login}
                            </span>
                            {item.kind === "review" && reviewStateBadge(item.state)}
                            <span class="text-xs text-gray-500">
                              {new Date(item.date).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <Show when={item.kind === "comment" ? item.body : item.kind === "review" ? item.body : undefined}>
                            {(body) => (
                              <CommentBody body={body()} />
                            )}
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <CommentBox
                  onSubmit={handlePostComment}
                  placeholder="Leave a comment..."
                  collaborators={collaborators()}
                />
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default DiffPage;
