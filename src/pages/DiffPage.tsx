import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import DiffViewer, { type PrFile, type InlineComment } from "../components/DiffViewer";
import FileTree, { type FileViewEntry } from "../components/FileTree";
import ThreadReplyBox from "../components/ThreadReplyBox";
import { type Collaborator } from "../components/CommentBox";
import MentionTextarea from "../components/MentionTextarea";
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
  const [activeFileIndex, setActiveFileIndex] = createSignal(0);
  const [viewedFiles, setViewedFiles] = createSignal<Record<string, FileViewEntry>>({});

  const activeFile = () => files()[activeFileIndex()]?.filename;

  const markFileViewed = async (filename: string) => {
    const file = files().find((f) => f.filename === filename);
    if (!file) return;
    try {
      await invoke("mark_file_viewed", {
        owner: params.owner,
        repo: params.repo,
        prNumber: prNumber(),
        filename,
        sha: file.sha,
      });
      setViewedFiles((prev) => ({
        ...prev,
        [filename]: { sha: file.sha },
      }));
    } catch (e) {
      console.error("Failed to mark file viewed:", e);
    }
  };

  const selectFile = (filename: string) => {
    const idx = files().findIndex((f) => f.filename === filename);
    if (idx >= 0) {
      setActiveFileIndex(idx);
      markFileViewed(filename);
    }
  };

  const goNextFile = () => {
    const len = files().length;
    if (len === 0) return;
    const next = Math.min(activeFileIndex() + 1, len - 1);
    setActiveFileIndex(next);
    markFileViewed(files()[next].filename);
  };

  const goPrevFile = () => {
    if (files().length === 0) return;
    const prev = Math.max(activeFileIndex() - 1, 0);
    setActiveFileIndex(prev);
    markFileViewed(files()[prev].filename);
  };

  // Review modal state
  const [reviewModalOpen, setReviewModalOpen] = createSignal(false);
  const [reviewModalBody, setReviewModalBody] = createSignal("");
  const [reviewModalSubmitting, setReviewModalSubmitting] = createSignal(false);
  const [reviewModalResult, setReviewModalResult] = createSignal<"success" | "error" | null>(null);
  const [reviewModalResultMsg, setReviewModalResultMsg] = createSignal("");

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

      // Fetch file viewed state
      let viewed: Record<string, FileViewEntry> = {};
      try {
        viewed = await invoke<Record<string, FileViewEntry>>("get_files_viewed", {
          owner: params.owner,
          repo: params.repo,
          prNumber: prNumber(),
        });
        setViewedFiles(viewed);
      } catch (e) {
        console.error("Failed to fetch file viewed state:", e);
      }

      // Default to first unviewed file, or first file if all viewed
      if (result.length > 0) {
        const firstUnviewed = result.findIndex((f) => {
          const entry = viewed[f.filename];
          return !entry || entry.sha !== f.sha;
        });
        const startIdx = firstUnviewed >= 0 ? firstUnviewed : 0;
        setActiveFileIndex(startIdx);
        markFileViewed(result[startIdx].filename);
      }

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

  const submitModalReview = async (event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES") => {
    const text = reviewModalBody().trim();
    if (event === "REQUEST_CHANGES" && !text) return;

    setReviewModalSubmitting(true);
    setReviewModalResult(null);
    setReviewModalResultMsg("");
    try {
      await invoke("submit_review", {
        owner: params.owner,
        repo: params.repo,
        prNumber: prNumber(),
        event,
        body: text,
        token: token(),
      });
      setReviewModalResult("success");
      setReviewModalResultMsg(
        event === "APPROVE" ? "Approved!" :
        event === "REQUEST_CHANGES" ? "Changes requested!" :
        "Review submitted!"
      );
      setReviewModalBody("");
      setTimeout(() => {
        setReviewModalOpen(false);
        setReviewModalResult(null);
      }, 1200);
    } catch (e) {
      setReviewModalResult("error");
      setReviewModalResultMsg(`${e}`);
    } finally {
      setReviewModalSubmitting(false);
    }
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && reviewModalOpen()) {
      setReviewModalOpen(false);
      return;
    }
    // Skip keybinds when typing in an input/textarea
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

    if (e.key === "n") {
      e.preventDefault();
      goNextFile();
    } else if (e.key === "p") {
      e.preventDefault();
      goPrevFile();
    } else {
      const scroller = document.querySelector("main");
      if (!scroller) return;
      if (e.key === "j") {
        scroller.scrollBy({ top: 60 });
      } else if (e.key === "k") {
        scroller.scrollBy({ top: -60 });
      } else if (e.key === "G") {
        scroller.scrollTo({ top: scroller.scrollHeight });
      } else if (e.key === "g") {
        scroller.scrollTo({ top: 0 });
      }
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", handleKeydown);
    onCleanup(() => window.removeEventListener("keydown", handleKeydown));
  }

  return (
    <div>
      <div class="flex items-center gap-3 mb-4 sticky top-[-12px] z-20 bg-gray-950 pb-2 -mx-3 px-3 -mt-3 pt-3">
        <button
          onClick={() => navigate("/")}
          class="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-900 border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
        >
          &larr; Back
        </button>
        <h2 class="text-lg font-bold text-gray-100 flex-1 min-w-0 truncate">
          {params.owner}/{params.repo}#{params.number}
        </h2>
        <Show when={token()}>
          <button
            class={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              reviewModalOpen()
                ? "bg-green-900 text-green-300"
                : "bg-gray-900 border border-gray-700 text-gray-300 hover:bg-gray-800"
            }`}
            onClick={() => {
              setReviewModalOpen(true);
              setReviewModalResult(null);
              setReviewModalResultMsg("");
            }}
          >
            Submit Review
          </button>
        </Show>
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
          <Show when={descOpen()}>
            <Show when={matchedPr!.body}>
              <div class="px-3 pb-3 border-t border-gray-800 pt-2">
                <CommentBody body={matchedPr!.body!} class="text-sm text-gray-300 whitespace-pre-wrap font-sans" />
              </div>
            </Show>
            <Show when={token()}>
              <div class="px-3 pb-3 space-y-3">
                <div class="bg-gray-950 border border-gray-800 rounded-lg p-3 space-y-3">
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
                  <ThreadReplyBox
                    owner={params.owner}
                    repo={params.repo}
                    prNumber={prNumber()}
                    token={token()}
                    collaborators={collaborators()}
                    onCommented={fetchComments}
                  />
                </div>
              </div>
            </Show>
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
          <div class="w-56 flex-shrink-0 sticky top-[36px] max-h-[calc(100vh-48px)] overflow-y-auto">
            <FileTree
              files={files()}
              activeFile={activeFile()}
              viewedFiles={viewedFiles()}
              onSelectFile={selectFile}
            />
          </div>
          <div class="flex-1 min-w-0 space-y-4">
            <div class="flex items-center gap-2">
              <button
                onClick={goPrevFile}
                disabled={activeFileIndex() === 0}
                class="px-2 py-1 rounded text-xs font-medium bg-gray-900 border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Previous file (p)"
              >
                &larr; Prev
              </button>
              <span class="text-xs text-gray-500">
                {activeFileIndex() + 1} / {files().length}
              </span>
              <button
                onClick={goNextFile}
                disabled={activeFileIndex() >= files().length - 1}
                class="px-2 py-1 rounded text-xs font-medium bg-gray-900 border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Next file (n)"
              >
                Next &rarr;
              </button>
            </div>
            <DiffViewer
              files={files()}
              activeFile={activeFile()}
              owner={params.owner}
              repo={params.repo}
              prNumber={prNumber()}
              token={token()}
              inlineComments={inlineComments()}
              headSha={headSha()}
              onInlineCommentsChange={fetchInlineComments}
              collaborators={collaborators()}
            />
          </div>
        </div>
      </Show>

      {/* Review modal */}
      <Show when={reviewModalOpen()}>
        <div
          class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReviewModalOpen(false);
          }}
        >
          <div class="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg p-4 space-y-3">
            <h3 class="text-sm font-semibold text-gray-200">Submit Review</h3>
            <MentionTextarea
              value={reviewModalBody}
              onValueChange={setReviewModalBody}
              placeholder="Review comment..."
              disabled={reviewModalSubmitting()}
              collaborators={collaborators()}
              class="w-full bg-gray-950 border border-gray-700 rounded-lg p-2 text-sm text-gray-200 placeholder-gray-500 resize-y min-h-[80px] focus:outline-none focus:border-blue-600"
            />
            <div class="flex items-center gap-2">
              <button
                onClick={() => submitModalReview("COMMENT")}
                disabled={reviewModalSubmitting()}
                class="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-700 text-white hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Comment
              </button>
              <button
                onClick={() => submitModalReview("APPROVE")}
                disabled={reviewModalSubmitting()}
                class="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-800 text-green-200 hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Approve
              </button>
              <button
                onClick={() => submitModalReview("REQUEST_CHANGES")}
                disabled={reviewModalSubmitting() || !reviewModalBody().trim()}
                class="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-800 text-red-200 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Request Changes
              </button>
              <button
                onClick={() => setReviewModalOpen(false)}
                class="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 transition-colors ml-auto"
              >
                Cancel
              </button>
            </div>
            <Show when={reviewModalResult() === "success"}>
              <span class="text-xs text-green-400">{reviewModalResultMsg()}</span>
            </Show>
            <Show when={reviewModalResult() === "error"}>
              <span class="text-xs text-red-400">{reviewModalResultMsg()}</span>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default DiffPage;
