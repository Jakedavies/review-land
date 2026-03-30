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
  username: string;
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

interface PrCommit {
  sha: string;
  commit: { message: string; author: { name: string; date: string } };
  author: { login: string; avatar_url: string } | null;
}

interface PrDetailCache {
  fetched_at: string;
  head_sha: string;
  files: PrFile[];
  inline_comments: InlineComment[];
  issue_comments: IssueComment[];
  reviews: ReviewComment[];
  check_status: { state: string; total: number; passed: number; failed: number; pending: number } | null;
  collaborators: Collaborator[];
  commits: PrCommit[];
}

function DiffPage() {
  const params = useParams<{ owner: string; repo: string; number: string }>();
  const navigate = useNavigate();
  const [files, setFiles] = createSignal<PrFile[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [token, setToken] = createSignal("");
  const [username, setUsername] = createSignal("");
  const [inlineComments, setInlineComments] = createSignal<InlineComment[]>([]);
  const [headSha, setHeadSha] = createSignal("");
  const [descOpen, setDescOpen] = createSignal(false);
  const [comments, setComments] = createSignal<IssueComment[]>([]);
  const [reviews, setReviews] = createSignal<ReviewComment[]>([]);
  const [collaborators, setCollaborators] = createSignal<Collaborator[]>([]);
  const [activeFileIndex, setActiveFileIndex] = createSignal(0);
  const [viewedFiles, setViewedFiles] = createSignal<Record<string, FileViewEntry>>({});
  const [checkStatus, setCheckStatus] = createSignal<{ state: string; total: number; passed: number; failed: number; pending: number } | null>(null);
  const [commits, setCommits] = createSignal<PrCommit[]>([]);
  const [diffMode, setDiffMode] = createSignal<"full" | "incremental">("full");
  const [incrementalFiles, setIncrementalFiles] = createSignal<PrFile[] | null>(null);
  const [incrementalLoading, setIncrementalLoading] = createSignal(false);

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
        commitSha: headSha() || null,
      });
      setViewedFiles((prev) => ({
        ...prev,
        [filename]: { sha: file.sha, commit_sha: headSha() || undefined },
      }));
    } catch (e) {
      console.error("Failed to mark file viewed:", e);
    }
  };

  let diffAreaRef: HTMLDivElement | undefined;
  const scrollToTop = () => diffAreaRef?.scrollIntoView({ block: "start" });

  const selectFile = (filename: string) => {
    const idx = files().findIndex((f) => f.filename === filename);
    if (idx >= 0) {
      setActiveFileIndex(idx);
      markFileViewed(filename);
      scrollToTop();
    }
  };

  const goNextFile = () => {
    const len = files().length;
    if (len === 0) return;
    const next = Math.min(activeFileIndex() + 1, len - 1);
    setActiveFileIndex(next);
    markFileViewed(files()[next].filename);
    scrollToTop();
  };

  const goPrevFile = () => {
    if (files().length === 0) return;
    const prev = Math.max(activeFileIndex() - 1, 0);
    setActiveFileIndex(prev);
    markFileViewed(files()[prev].filename);
    scrollToTop();
  };

  // Check if any file has been viewed at a previous commit (incremental diff available)
  const hasIncrementalData = () => {
    const viewed = viewedFiles();
    const currentHead = headSha();
    if (!currentHead) return false;
    return files().some((f) => {
      const entry = viewed[f.filename];
      return entry?.commit_sha && entry.commit_sha !== currentHead && entry.sha !== f.sha;
    });
  };

  const fetchIncrementalDiff = async () => {
    // Find the oldest commit_sha among viewed files that differs from current head
    const viewed = viewedFiles();
    const currentHead = headSha();
    if (!currentHead || !token()) return;

    // Use the most common previous commit_sha (they should mostly be the same)
    const commitShas = files()
      .map((f) => viewed[f.filename]?.commit_sha)
      .filter((sha): sha is string => !!sha && sha !== currentHead);

    if (commitShas.length === 0) {
      setIncrementalFiles([]);
      return;
    }

    // Use the oldest (first) viewed commit as the base
    const baseSha = commitShas[0];

    setIncrementalLoading(true);
    try {
      const result = await invoke<PrFile[]>("get_compare_files", {
        owner: params.owner,
        repo: params.repo,
        base: baseSha,
        head: currentHead,
        token: token(),
      });
      setIncrementalFiles(result);
    } catch (e) {
      console.error("Failed to fetch incremental diff:", e);
      setIncrementalFiles(null);
      setDiffMode("full");
    } finally {
      setIncrementalLoading(false);
    }
  };

  const toggleDiffMode = async () => {
    if (diffMode() === "full") {
      if (!incrementalFiles()) {
        await fetchIncrementalDiff();
      }
      setDiffMode("incremental");
    } else {
      setDiffMode("full");
    }
  };

  const displayFiles = () => {
    if (diffMode() === "incremental" && incrementalFiles()) {
      return incrementalFiles()!;
    }
    return files();
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
  let prDataLoadData: (() => Promise<void>) | undefined;
  let prLastViewed: ReturnType<typeof usePRData>["lastViewed"] | undefined;

  try {
    const { prs, loadData: ld, lastViewed: lv } = usePRData();
    prDataAvailable = true;
    prDataLoadData = ld;
    prLastViewed = lv;
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

  const [isDraft, setIsDraft] = createSignal(matchedPr?.draft ?? false);
  const [prClosed, setPrClosed] = createSignal(matchedPr?.state === "closed");
  const [prMerged, setPrMerged] = createSignal(false);

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

  const fetchReviews = async () => {
    if (!token()) return;
    try {
      const result = await invoke<ReviewComment[]>("get_reviews", {
        owner: params.owner, repo: params.repo,
        prNumber: prNumber(), token: token(),
      });
      setReviews(result);
    } catch (e) {
      console.error("Failed to fetch reviews:", e);
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

  const applyDetailData = (detail: PrDetailCache, viewed: Record<string, FileViewEntry>) => {
    setFiles(detail.files);
    setHeadSha(detail.head_sha);
    setInlineComments(detail.inline_comments);
    setComments(detail.issue_comments);
    setReviews(detail.reviews);
    setCheckStatus(detail.check_status);
    setCollaborators(detail.collaborators);
    setCommits(detail.commits || []);
    setViewedFiles(viewed);

    // Default to first unviewed file, or first file if all viewed
    if (detail.files.length > 0) {
      const firstUnviewed = detail.files.findIndex((f) => {
        const entry = viewed[f.filename];
        return !entry || entry.sha !== f.sha;
      });
      const startIdx = firstUnviewed >= 0 ? firstUnviewed : 0;
      setActiveFileIndex(startIdx);
      markFileViewed(detail.files[startIdx].filename);
    }
  };

  onMount(async () => {
    try {
      const settings = await invoke<AppSettings>("get_settings");
      setToken(settings.github_token);
      setUsername(settings.username);

      // Phase 1: Load from cache instantly
      let hasCache = false;
      try {
        const cached = await invoke<PrDetailCache | null>("get_pr_detail_cached", {
          owner: params.owner,
          repo: params.repo,
          prNumber: prNumber(),
        });
        if (cached) {
          hasCache = true;
          let viewed: Record<string, FileViewEntry> = {};
          try {
            viewed = await invoke<Record<string, FileViewEntry>>("get_files_viewed", {
              owner: params.owner,
              repo: params.repo,
              prNumber: prNumber(),
            });
          } catch {}
          applyDetailData(cached, viewed);
          setLoading(false);
        }
      } catch {
        // Cache read failed, proceed to fresh fetch
      }

      // Phase 2: Refresh from GitHub
      try {
        const [detail, viewed] = await Promise.all([
          invoke<PrDetailCache>("refresh_pr_detail", {
            owner: params.owner,
            repo: params.repo,
            prNumber: prNumber(),
            token: settings.github_token,
          }),
          invoke<Record<string, FileViewEntry>>("get_files_viewed", {
            owner: params.owner,
            repo: params.repo,
            prNumber: prNumber(),
          }),
        ]);
        applyDetailData(detail, viewed);
      } catch (e) {
        console.error("Failed to refresh PR detail:", e);
        if (!hasCache) {
          setError(`Failed to load diff: ${e}`);
        }
      }
    } catch (e) {
      console.error("Failed to load diff:", e);
      setError(`Failed to load diff: ${e}`);
    } finally {
      setLoading(false);
    }
  });

  const commentCounts = () => {
    const counts: Record<string, number> = {};
    for (const c of inlineComments()) {
      if (!c.is_resolved) {
        counts[c.path] = (counts[c.path] || 0) + 1;
      }
    }
    return counts;
  };

  const ghUrl = () =>
    `https://github.com/${params.owner}/${params.repo}/pull/${params.number}`;

  type TimelineItem =
    | { kind: "comment"; id: number; user: { login: string; avatar_url: string }; body: string; date: string }
    | { kind: "review"; id: number; user: { login: string; avatar_url: string }; state: string; body?: string; date: string }
    | { kind: "commit"; id: number; sha: string; message: string; user: { login: string; avatar_url: string } | null; authorName: string; date: string }
    | { kind: "last-viewed"; id: number; date: string };

  const timeline = () => {
    const items: TimelineItem[] = [];
    for (const c of comments()) {
      items.push({ kind: "comment", id: c.id, user: c.user, body: c.body, date: c.created_at });
    }
    for (const r of reviews()) {
      if (r.state === "PENDING") continue;
      items.push({ kind: "review", id: r.id, user: r.user, state: r.state, body: r.body || undefined, date: r.submitted_at || "" });
    }
    for (const c of commits()) {
      items.push({
        kind: "commit",
        id: 0, // commits don't have numeric IDs
        sha: c.sha,
        message: c.commit.message.split("\n")[0], // first line only
        user: c.author,
        authorName: c.commit.author.name,
        date: c.commit.author.date,
      });
    }

    // Insert "last viewed" marker
    const prUrl = `https://github.com/${params.owner}/${params.repo}/pull/${params.number}`;
    const viewedAt = prLastViewed?.()?.[prUrl];
    if (viewedAt) {
      items.push({ kind: "last-viewed", id: -1, date: viewedAt });
    }

    items.sort((a, b) => a.date.localeCompare(b.date));
    return items;
  };

  const newItems = () => {
    const items = timeline();
    const markerIdx = items.findIndex((i) => i.kind === "last-viewed");
    if (markerIdx < 0) return [];
    return items.slice(markerIdx + 1).filter((i) => i.kind !== "last-viewed");
  };

  const [newItemIndex, setNewItemIndex] = createSignal(-1);

  const scrollToTimelineItem = (idx: number) => {
    const items = newItems();
    if (idx < 0 || idx >= items.length) return;
    setNewItemIndex(idx);
    const item = items[idx];
    const elId = item.kind === "commit" ? `timeline-commit-${item.sha}` : `timeline-${item.kind}-${item.id}`;
    document.getElementById(elId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const jumpToNextNew = () => {
    const items = newItems();
    if (items.length === 0) return;
    const next = Math.min(newItemIndex() + 1, items.length - 1);
    scrollToTimelineItem(next);
  };

  const jumpToPrevNew = () => {
    const items = newItems();
    if (items.length === 0) return;
    const prev = Math.max(newItemIndex() - 1, 0);
    scrollToTimelineItem(prev);
  };

  const [editingItemId, setEditingItemId] = createSignal<number | null>(null);
  const [editBody, setEditBody] = createSignal("");
  const [editSubmitting, setEditSubmitting] = createSignal(false);

  const startEdit = (item: TimelineItem) => {
    if (item.kind === "commit" || item.kind === "last-viewed") return;
    const body = item.kind === "comment" ? item.body : (item.body || "");
    setEditingItemId(item.id);
    setEditBody(body);
  };

  const cancelEdit = () => {
    setEditingItemId(null);
    setEditBody("");
  };

  const submitEdit = async (item: TimelineItem) => {
    if (editSubmitting()) return;
    setEditSubmitting(true);
    try {
      if (item.kind === "comment") {
        await invoke("edit_comment", {
          owner: params.owner,
          repo: params.repo,
          commentId: item.id,
          body: editBody(),
          token: token(),
        });
      }
      setEditingItemId(null);
      setEditBody("");
      await fetchComments();
    } catch (e) {
      console.error("Failed to edit comment:", e);
    } finally {
      setEditSubmitting(false);
    }
  };

  // PR description editing
  const [editingDesc, setEditingDesc] = createSignal(false);
  const [editDescBody, setEditDescBody] = createSignal("");
  const [editDescSubmitting, setEditDescSubmitting] = createSignal(false);

  const startDescEdit = () => {
    setEditDescBody(matchedPr?.body || "");
    setEditingDesc(true);
  };

  const submitDescEdit = async () => {
    if (editDescSubmitting()) return;
    setEditDescSubmitting(true);
    try {
      await invoke("edit_pr_body", {
        owner: params.owner,
        repo: params.repo,
        prNumber: prNumber(),
        body: editDescBody(),
        token: token(),
      });
      if (matchedPr) {
        matchedPr.body = editDescBody();
      }
      setEditingDesc(false);
    } catch (e) {
      console.error("Failed to edit PR description:", e);
    } finally {
      setEditDescSubmitting(false);
    }
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
      await Promise.all([fetchComments(), fetchReviews()]);
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
        <Show when={checkStatus()}>
          {(cs) => {
            const s = cs();
            if (s.state === "none") return null;
            const color = s.state === "success" ? "text-green-400" : s.state === "failure" ? "text-red-400" : "text-yellow-400";
            const icon = s.state === "success" ? "\u2713" : s.state === "failure" ? "\u2717" : "\u25CB";
            return (
              <span class={`text-xs font-medium ${color}`} title={`${s.passed} passed, ${s.failed} failed, ${s.pending} pending`}>
                {icon} {s.passed}/{s.total}
              </span>
            );
          }}
        </Show>
        <Show when={isDraft() && matchedPr?.user.login === username()}>
          {(() => {
            const [marking, setMarking] = createSignal(false);
            return (
              <button
                class="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-900 border border-green-800 text-green-300 hover:bg-green-800 transition-colors disabled:opacity-50"
                disabled={marking()}
                onClick={async () => {
                  setMarking(true);
                  try {
                    await invoke("mark_ready_for_review", {
                      owner: params.owner,
                      repo: params.repo,
                      prNumber: prNumber(),
                      token: token(),
                    });
                    setIsDraft(false);
                    prDataLoadData?.();
                  } catch (e) {
                    console.error("Failed to mark ready:", e);
                  } finally {
                    setMarking(false);
                  }
                }}
              >
                {marking() ? "Marking ready..." : "Ready for review"}
              </button>
            );
          })()}
        </Show>
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
        <Show when={token() && !prClosed() && !prMerged()}>
          {(() => {
            const [mergeOpen, setMergeOpen] = createSignal(false);
            const [merging, setMerging] = createSignal(false);
            const [closing, setClosing] = createSignal(false);
            const [mergeError, setMergeError] = createSignal("");

            const doMerge = async (method: string) => {
              setMerging(true);
              setMergeError("");
              try {
                await invoke("merge_pr", {
                  owner: params.owner,
                  repo: params.repo,
                  prNumber: prNumber(),
                  mergeMethod: method,
                  token: token(),
                });
                setPrMerged(true);
                setMergeOpen(false);
                prDataLoadData?.();
              } catch (e) {
                setMergeError(`${e}`);
              } finally {
                setMerging(false);
              }
            };

            const doClose = async () => {
              setClosing(true);
              setMergeError("");
              try {
                await invoke("close_pr", {
                  owner: params.owner,
                  repo: params.repo,
                  prNumber: prNumber(),
                  token: token(),
                });
                setPrClosed(true);
                setMergeOpen(false);
                prDataLoadData?.();
              } catch (e) {
                setMergeError(`${e}`);
              } finally {
                setClosing(false);
              }
            };

            return (
              <div class="relative">
                <button
                  onClick={() => setMergeOpen(!mergeOpen())}
                  class="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-800 border border-green-700 text-green-200 hover:bg-green-700 transition-colors"
                >
                  Merge
                </button>
                <Show when={mergeOpen()}>
                  <div class="absolute right-0 top-full mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 p-2 w-52 space-y-1">
                    <button
                      onClick={() => doMerge("merge")}
                      disabled={merging()}
                      class="w-full text-left px-2 py-1.5 rounded text-xs text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                      <div class="font-medium">Create merge commit</div>
                      <div class="text-gray-500 text-[10px]">All commits will be added</div>
                    </button>
                    <button
                      onClick={() => doMerge("squash")}
                      disabled={merging()}
                      class="w-full text-left px-2 py-1.5 rounded text-xs text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                      <div class="font-medium">Squash and merge</div>
                      <div class="text-gray-500 text-[10px]">Commits will be squashed</div>
                    </button>
                    <button
                      onClick={() => doMerge("rebase")}
                      disabled={merging()}
                      class="w-full text-left px-2 py-1.5 rounded text-xs text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                      <div class="font-medium">Rebase and merge</div>
                      <div class="text-gray-500 text-[10px]">Commits will be rebased</div>
                    </button>
                    <div class="border-t border-gray-700 my-1" />
                    <button
                      onClick={doClose}
                      disabled={closing()}
                      class="w-full text-left px-2 py-1.5 rounded text-xs text-red-400 hover:bg-red-950 transition-colors disabled:opacity-50"
                    >
                      {closing() ? "Closing..." : "Close pull request"}
                    </button>
                    <Show when={mergeError()}>
                      <div class="text-[10px] text-red-400 px-2 py-1">{mergeError()}</div>
                    </Show>
                  </div>
                </Show>
              </div>
            );
          })()}
        </Show>
        <Show when={prMerged()}>
          <span class="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-900 border border-purple-800 text-purple-300">
            Merged
          </span>
        </Show>
        <Show when={prClosed() && !prMerged()}>
          <span class="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-900 border border-red-800 text-red-300">
            Closed
          </span>
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
            <Show when={matchedPr!.body || username()}>
              <div class="px-3 pb-3 border-t border-gray-800 pt-2">
                <Show when={editingDesc()} fallback={
                  <div class="group/desc relative">
                    <Show when={matchedPr!.body}>
                      <CommentBody body={matchedPr!.body!} class="text-sm text-gray-300 whitespace-pre-wrap font-sans" />
                    </Show>
                    <Show when={username()}>
                      <button
                        onClick={startDescEdit}
                        class="text-[10px] text-gray-500 hover:text-gray-300 mt-1 transition-colors"
                      >
                        Edit
                      </button>
                    </Show>
                  </div>
                }>
                  <div class="space-y-2">
                    <MentionTextarea
                      value={editDescBody}
                      onValueChange={setEditDescBody}
                      placeholder="PR description..."
                      disabled={editDescSubmitting()}
                      collaborators={collaborators()}
                      class="w-full bg-gray-950 border border-gray-700 rounded-lg p-2 text-sm text-gray-200 placeholder-gray-500 resize-y min-h-[80px] focus:outline-none focus:border-blue-600"
                    />
                    <div class="flex gap-2">
                      <button
                        onClick={submitDescEdit}
                        disabled={editDescSubmitting()}
                        class="px-3 py-1 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
                      >
                        {editDescSubmitting() ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingDesc(false)}
                        class="px-3 py-1 rounded-lg text-xs text-gray-400 hover:text-gray-200 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={token()}>
              <div class="px-3 pb-3 space-y-3">
                <div class="bg-gray-950 border border-gray-800 rounded-lg p-3 space-y-3">
                  <div class="flex items-center gap-2">
                    <h3 class="text-sm font-semibold text-gray-200">
                      Activity{timeline().length > 0 ? ` (${timeline().length})` : ""}
                    </h3>
                    <Show when={newItems().length > 0}>
                      <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-900/50 text-blue-300">
                        {newItems().length} new
                      </span>
                      <div class="flex items-center gap-1 ml-auto">
                        <button
                          onClick={jumpToPrevNew}
                          disabled={newItemIndex() <= 0}
                          class="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          &uarr;
                        </button>
                        <span class="text-[10px] text-gray-500">
                          {newItemIndex() >= 0 ? `${newItemIndex() + 1}/${newItems().length}` : `0/${newItems().length}`}
                        </span>
                        <button
                          onClick={jumpToNextNew}
                          disabled={newItemIndex() >= newItems().length - 1}
                          class="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          &darr;
                        </button>
                      </div>
                    </Show>
                  </div>
                  <Show when={timeline().length > 0}>
                    <div class="space-y-2">
                      <For each={timeline()}>
                        {(item) => {
                          if (item.kind === "last-viewed") {
                            return (
                              <div class="flex items-center gap-2 py-1">
                                <div class="flex-1 border-t border-blue-800" />
                                <span class="text-[10px] font-medium text-blue-400 whitespace-nowrap">Last viewed</span>
                                <div class="flex-1 border-t border-blue-800" />
                              </div>
                            );
                          }
                          if (item.kind === "commit") {
                            const isActive = () => {
                              const ni = newItems();
                              const idx = newItemIndex();
                              return idx >= 0 && ni[idx]?.kind === "commit" && (ni[idx] as any).sha === item.sha;
                            };
                            return (
                              <div id={`timeline-commit-${item.sha}`} class={`flex items-center gap-2 px-3 py-1.5 text-xs rounded transition-colors ${isActive() ? "ring-1 ring-blue-600 bg-blue-950/30" : ""}`}>
                                <Show when={item.user} fallback={
                                  <div class="w-4 h-4 rounded-full bg-gray-700 flex items-center justify-center text-[8px] text-gray-400">C</div>
                                }>
                                  {(user) => <img src={user().avatar_url} class="w-4 h-4 rounded-full" alt="" />}
                                </Show>
                                <span class="text-gray-500 font-mono text-[10px]">{item.sha.slice(0, 7)}</span>
                                <span class="text-gray-300 truncate flex-1">{item.message}</span>
                                <span class="text-gray-600 whitespace-nowrap">
                                  {new Date(item.date).toLocaleDateString(undefined, {
                                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                                  })}
                                </span>
                              </div>
                            );
                          }
                          const isActive = () => {
                            const ni = newItems();
                            const idx = newItemIndex();
                            return idx >= 0 && ni[idx]?.kind === item.kind && ni[idx]?.id === item.id;
                          };
                          return (
                          <div
                            id={`timeline-${item.kind}-${item.id}`}
                            class={`bg-gray-950 border rounded-lg px-3 py-2 transition-colors ${
                            isActive()
                              ? "ring-1 ring-blue-600 bg-blue-950/30"
                              : item.kind === "review" && item.state === "APPROVED"
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
                              <Show when={item.kind === "comment" && item.user.login === username()}>
                                <button
                                  onClick={() => startEdit(item)}
                                  class="text-[10px] text-gray-500 hover:text-gray-300 ml-auto transition-colors"
                                >
                                  Edit
                                </button>
                              </Show>
                            </div>
                            <Show when={editingItemId() === item.id} fallback={
                              <Show when={item.kind === "comment" ? item.body : item.kind === "review" ? item.body : undefined}>
                                {(body) => (
                                  <CommentBody body={body()} />
                                )}
                              </Show>
                            }>
                              <div class="space-y-2 mt-1">
                                <MentionTextarea
                                  value={editBody}
                                  onValueChange={setEditBody}
                                  placeholder="Edit comment..."
                                  disabled={editSubmitting()}
                                  collaborators={collaborators()}
                                  class="w-full bg-gray-950 border border-gray-700 rounded-lg p-2 text-sm text-gray-200 placeholder-gray-500 resize-y min-h-[60px] focus:outline-none focus:border-blue-600"
                                />
                                <div class="flex gap-2">
                                  <button
                                    onClick={() => submitEdit(item)}
                                    disabled={editSubmitting()}
                                    class="px-3 py-1 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
                                  >
                                    {editSubmitting() ? "Saving..." : "Save"}
                                  </button>
                                  <button
                                    onClick={cancelEdit}
                                    class="px-3 py-1 rounded-lg text-xs text-gray-400 hover:text-gray-200 transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </Show>
                          </div>
                          );
                        }}
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
              commentCounts={commentCounts()}
              onSelectFile={selectFile}
            />
          </div>
          <div ref={diffAreaRef} class="flex-1 min-w-0 space-y-4">
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
                <Show when={diffMode() === "incremental" && incrementalFiles()}>
                  {" "}({incrementalFiles()!.length} changed)
                </Show>
              </span>
              <button
                onClick={goNextFile}
                disabled={activeFileIndex() >= files().length - 1}
                class="px-2 py-1 rounded text-xs font-medium bg-gray-900 border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Next file (n)"
              >
                Next &rarr;
              </button>
              <Show when={hasIncrementalData()}>
                <button
                  onClick={toggleDiffMode}
                  disabled={incrementalLoading()}
                  class={`ml-auto px-2 py-1 rounded text-xs font-medium border transition-colors ${
                    diffMode() === "incremental"
                      ? "bg-blue-900/50 border-blue-700 text-blue-300"
                      : "bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800"
                  }`}
                  title="Toggle between full PR diff and changes since last viewed"
                >
                  {incrementalLoading() ? "Loading..." : diffMode() === "incremental" ? "Since last view" : "Since last view"}
                </button>
              </Show>
            </div>
            <DiffViewer
              files={displayFiles()}
              activeFile={activeFile()}
              owner={params.owner}
              repo={params.repo}
              prNumber={prNumber()}
              token={token()}
              inlineComments={inlineComments()}
              headSha={headSha()}
              onInlineCommentsChange={fetchInlineComments}
              collaborators={collaborators()}
              username={username()}
              onEditInlineComment={async (commentId, body) => {
                await invoke("edit_inline_comment", {
                  owner: params.owner,
                  repo: params.repo,
                  commentId,
                  body,
                  token: token(),
                });
                await fetchInlineComments();
              }}
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
