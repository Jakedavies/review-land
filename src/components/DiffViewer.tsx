import { For, Show, createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { createHighlighter, type Highlighter } from "shiki";
import CommentBox, { type Collaborator } from "./CommentBox";
import CommentBody from "./CommentBody";

let highlighterInstance: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: [
        "typescript",
        "javascript",
        "tsx",
        "jsx",
        "css",
        "html",
        "json",
        "markdown",
        "python",
        "rust",
        "go",
        "yaml",
        "toml",
        "bash",
        "sql",
        "graphql",
        "dockerfile",
        "xml",
        "java",
        "c",
        "cpp",
      ],
    }).then((h) => {
      highlighterInstance = h;
      return h;
    });
  }
  return highlighterPromise;
}

const extToLang: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  css: "css",
  html: "html",
  htm: "html",
  json: "json",
  md: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  xml: "xml",
  svg: "xml",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
};

function langFromFilename(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (filename.toLowerCase() === "dockerfile") return "dockerfile";
  return extToLang[ext] ?? null;
}

function highlightLine(code: string, lang: string): string {
  if (!highlighterInstance) return "";
  try {
    const html = highlighterInstance.codeToHtml(code, {
      lang,
      theme: "github-dark",
    });
    const match = html.match(/<code[^>]*>([\s\S]*)<\/code>/);
    if (!match) return "";
    const inner = match[1]
      .replace(/^<span class="line">/, "")
      .replace(/<\/span>$/, "");
    return inner;
  } catch {
    return "";
  }
}

interface PrFile {
  sha: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  previous_filename: string | null;
}

export interface InlineComment {
  id: number;
  user: { login: string; avatar_url: string };
  body: string;
  path: string;
  line?: number;
  side?: string;
  created_at: string;
  html_url?: string;
  commit_id?: string;
  in_reply_to_id?: number;
  is_resolved: boolean;
}

interface DiffViewerProps {
  files: PrFile[];
  activeFile?: string;
  owner?: string;
  repo?: string;
  prNumber?: number;
  token?: string;
  inlineComments?: InlineComment[];
  headSha?: string;
  onInlineCommentsChange?: () => void;
  collaborators?: Collaborator[];
  username?: string;
  onEditInlineComment?: (commentId: number, body: string) => Promise<void>;
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    added: "bg-green-900 text-green-300",
    removed: "bg-red-900 text-red-300",
    modified: "bg-yellow-900 text-yellow-300",
    renamed: "bg-blue-900 text-blue-300",
  };
  return (
    <span
      class={`px-1.5 py-0.5 rounded text-xs font-semibold ${styles[status] || "bg-gray-800 text-gray-300"}`}
    >
      {status}
    </span>
  );
}

// Global signal for highlighter readiness
const [highlighterReady, setHighlighterReady] = createSignal(false);
getHighlighter().then(() => setHighlighterReady(true));

interface ParsedLine {
  raw: string;
  rightLineNum: number | null;
  leftLineNum: number | null;
}

function parsePatchLines(patch: string): ParsedLine[] {
  const lines = patch.split("\n");
  const result: ParsedLine[] = [];
  let rightLine = 0;
  let leftLine = 0;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      leftLine = parseInt(hunkMatch[1], 10);
      rightLine = parseInt(hunkMatch[2], 10);
      result.push({ raw: line, rightLineNum: null, leftLineNum: null });
      continue;
    }

    if (line.startsWith("-")) {
      result.push({ raw: line, rightLineNum: null, leftLineNum: leftLine });
      leftLine++;
    } else if (line.startsWith("+")) {
      result.push({ raw: line, rightLineNum: rightLine, leftLineNum: null });
      rightLine++;
    } else {
      // context line
      result.push({ raw: line, rightLineNum: rightLine, leftLineNum: leftLine });
      rightLine++;
      leftLine++;
    }
  }

  return result;
}

function ResolvedThread(props: { comments: InlineComment[] }) {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="border border-gray-700/50 rounded text-xs">
      <button
        class="w-full flex items-center gap-1.5 px-2 py-1 text-left text-gray-500 hover:text-gray-400 transition-colors"
        onClick={() => setOpen(!open())}
      >
        <span class="text-[10px]">{open() ? "\u25BC" : "\u25B6"}</span>
        <span class="px-1 py-0.5 rounded text-[9px] font-medium bg-purple-900/50 text-purple-400">Resolved</span>
        <span>{props.comments.length} comment{props.comments.length !== 1 ? "s" : ""}</span>
      </button>
      <Show when={open()}>
        <div class="px-2 pb-1.5 space-y-1 opacity-70">
          <For each={props.comments}>
            {(comment) => (
              <div class="bg-gray-800/50 border border-gray-700/50 rounded px-2 py-1.5">
                <div class="flex items-center gap-1.5 mb-1">
                  <img
                    src={comment.user.avatar_url}
                    class="w-4 h-4 rounded-full"
                    alt=""
                  />
                  <span class="font-medium text-gray-400">
                    {comment.user.login}
                  </span>
                  <span class="text-gray-600">
                    {new Date(comment.created_at).toLocaleDateString()}
                  </span>
                </div>
                <CommentBody body={comment.body} class="text-gray-400 whitespace-pre-wrap text-xs" />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function HighlightedLine(props: {
  line: string;
  lang: string | null;
  lineNum: number | null;
  onAddComment?: (lineNum: number) => void;
  existingComments?: InlineComment[];
  username?: string;
  onEditComment?: (commentId: number, body: string) => Promise<void>;
}) {
  const [hovered, setHovered] = createSignal(false);
  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [editText, setEditText] = createSignal("");
  const [editSaving, setEditSaving] = createSignal(false);
  const prefix = () => props.line[0] ?? "";
  const code = () => (props.line.length > 0 ? props.line.slice(1) : "");

  const bg = () => {
    if (props.line.startsWith("@@")) return "bg-blue-950";
    if (props.line.startsWith("+")) return "bg-green-950";
    if (props.line.startsWith("-")) return "bg-red-950";
    return "";
  };

  const isHunkHeader = () => props.line.startsWith("@@");

  const highlighted = () => {
    if (!highlighterReady() || !props.lang || isHunkHeader()) return null;
    return highlightLine(code(), props.lang);
  };

  return (
    <>
      <div
        class={`px-3 flex items-start group relative ${bg()}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Show when={props.lineNum !== null && props.lineNum !== undefined}>
          <span class="text-gray-600 text-right w-8 flex-shrink-0 select-none mr-2 inline-block">
            {props.lineNum}
          </span>
        </Show>
        <Show when={props.lineNum === null || props.lineNum === undefined}>
          <span class="w-8 flex-shrink-0 mr-2 inline-block" />
        </Show>
        <Show when={hovered() && props.onAddComment && props.lineNum != null}>
          <button
            class="absolute left-0 w-6 h-5 flex items-center justify-center text-blue-400 hover:text-blue-300 bg-gray-800 rounded text-xs font-bold"
            onClick={() => props.onAddComment!(props.lineNum!)}
            title="Add comment"
          >
            +
          </button>
        </Show>
        <span class="flex-1 min-w-0">
          <Show
            when={highlighted()}
            fallback={
              <span
                class={
                  isHunkHeader()
                    ? "text-blue-400"
                    : props.line.startsWith("+")
                      ? "text-green-400"
                      : props.line.startsWith("-")
                        ? "text-red-400"
                        : "text-gray-300"
                }
              >
                {props.line || " "}
              </span>
            }
          >
            {(html) => (
              <>
                <span
                  class={
                    props.line.startsWith("+")
                      ? "text-green-400"
                      : props.line.startsWith("-")
                        ? "text-red-400"
                        : "text-gray-300"
                  }
                >
                  {prefix()}
                </span>
                <span class="shiki-line" innerHTML={html()} />
              </>
            )}
          </Show>
        </span>
      </div>
      <Show when={props.existingComments && props.existingComments.length > 0}>
        {(() => {
          const active = () => props.existingComments!.filter((c) => !c.is_resolved);
          const resolved = () => props.existingComments!.filter((c) => c.is_resolved);
          return (
            <div class="ml-10 mr-3 my-1 space-y-1">
              <For each={active()}>
                {(comment) => (
                  <div class="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs">
                    <div class="flex items-center gap-1.5 mb-1">
                      <img
                        src={comment.user.avatar_url}
                        class="w-4 h-4 rounded-full"
                        alt=""
                      />
                      <span class="font-medium text-gray-200">
                        {comment.user.login}
                      </span>
                      <span class="text-gray-500">
                        {new Date(comment.created_at).toLocaleDateString()}
                      </span>
                      <Show when={props.username && comment.user.login === props.username && props.onEditComment}>
                        <button
                          onClick={() => {
                            setEditingId(comment.id);
                            setEditText(comment.body);
                          }}
                          class="text-[10px] text-gray-500 hover:text-gray-300 ml-auto transition-colors"
                        >
                          Edit
                        </button>
                      </Show>
                    </div>
                    <Show when={editingId() === comment.id} fallback={
                      <CommentBody body={comment.body} class="text-gray-300 whitespace-pre-wrap text-xs" />
                    }>
                      <div class="space-y-1.5 mt-1">
                        <textarea
                          value={editText()}
                          onInput={(e) => setEditText(e.currentTarget.value)}
                          disabled={editSaving()}
                          class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-gray-200 placeholder-gray-500 resize-y min-h-[40px] focus:outline-none focus:border-blue-600"
                        />
                        <div class="flex gap-1.5">
                          <button
                            onClick={async () => {
                              setEditSaving(true);
                              try {
                                await props.onEditComment!(comment.id, editText());
                                setEditingId(null);
                              } finally {
                                setEditSaving(false);
                              }
                            }}
                            disabled={editSaving()}
                            class="px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
                          >
                            {editSaving() ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            class="px-2 py-0.5 rounded text-[10px] text-gray-400 hover:text-gray-200 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
              <Show when={resolved().length > 0}>
                <ResolvedThread comments={resolved()} />
              </Show>
            </div>
          );
        })()}
      </Show>
    </>
  );
}

function FileSection(props: {
  file: PrFile;
  owner?: string;
  repo?: string;
  prNumber?: number;
  token?: string;
  inlineComments?: InlineComment[];
  headSha?: string;
  onInlineCommentsChange?: () => void;
  collaborators?: Collaborator[];
  username?: string;
  onEditInlineComment?: (commentId: number, body: string) => Promise<void>;
}) {
  const [open, setOpen] = createSignal(true);
  const [activeCommentLine, setActiveCommentLine] = createSignal<number | null>(
    null,
  );
  const f = props.file;
  const lang = () => langFromFilename(f.filename);

  const parsedLines = () => (f.patch ? parsePatchLines(f.patch) : []);

  const commentsForFile = () =>
    (props.inlineComments ?? []).filter((c) => c.path === f.filename);

  const commentsForLine = (lineNum: number, side: "LEFT" | "RIGHT") =>
    commentsForFile().filter((c) => {
      if (side === "LEFT") {
        return c.line === lineNum && c.side === "LEFT";
      }
      // RIGHT side: match comments with no explicit side (legacy) or side=RIGHT
      return c.line === lineNum && c.side !== "LEFT";
    });

  const canComment = () =>
    props.owner && props.repo && props.prNumber && props.token && props.headSha;

  const handlePostInlineComment = async (body: string) => {
    const lineNum = activeCommentLine();
    if (!lineNum || !canComment()) return;
    await invoke("post_inline_comment", {
      owner: props.owner,
      repo: props.repo,
      prNumber: props.prNumber,
      body,
      commitId: props.headSha,
      path: f.filename,
      line: lineNum,
      token: props.token,
    });
    setActiveCommentLine(null);
    props.onInlineCommentsChange?.();
  };

  return (
    <div
      id={`file-${encodeURIComponent(f.filename)}`}
      class="border border-gray-800 rounded"
    >
      <button
        class="w-full flex items-center gap-2 px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-left text-xs rounded-t sticky top-[36px] z-10"
        onClick={() => setOpen(!open())}
      >
        <span class="text-gray-500">{open() ? "\u25BC" : "\u25B6"}</span>
        {statusBadge(f.status)}
        <span class="font-mono text-gray-200 truncate flex-1">
          {f.previous_filename && f.previous_filename !== f.filename
            ? `${f.previous_filename} \u2192 ${f.filename}`
            : f.filename}
        </span>
        <span class="text-green-400 font-mono">+{f.additions}</span>
        <span class="text-red-400 font-mono">-{f.deletions}</span>
      </button>
      <Show when={open()}>
        <Show
          when={f.patch}
          fallback={
            <div class="px-3 py-2 text-xs text-gray-500 italic">
              Binary file or diff too large
            </div>
          }
        >
          <div class="overflow-x-auto">
            <pre class="text-[13px] font-mono leading-snug">
              <For each={parsedLines()}>
                {(parsed) => (
                  <>
                    <HighlightedLine
                      line={parsed.raw}
                      lang={lang()}
                      lineNum={parsed.rightLineNum}
                      onAddComment={
                        canComment()
                          ? (ln) => setActiveCommentLine(ln)
                          : undefined
                      }
                      existingComments={
                        parsed.rightLineNum != null
                          ? commentsForLine(parsed.rightLineNum, "RIGHT")
                          : parsed.leftLineNum != null
                            ? commentsForLine(parsed.leftLineNum, "LEFT")
                            : undefined
                      }
                      username={props.username}
                      onEditComment={props.onEditInlineComment}
                    />
                    <Show
                      when={
                        activeCommentLine() !== null &&
                        activeCommentLine() === parsed.rightLineNum
                      }
                    >
                      <div class="ml-10 mr-3 my-1">
                        <CommentBox
                          onSubmit={handlePostInlineComment}
                          placeholder={`Comment on line ${activeCommentLine()}...`}
                          label="Add Comment"
                          onCancel={() => setActiveCommentLine(null)}
                          collaborators={props.collaborators}
                        />
                      </div>
                    </Show>
                  </>
                )}
              </For>
            </pre>
          </div>
        </Show>
      </Show>
    </div>
  );
}

function DiffViewer(props: DiffViewerProps) {
  const totalAdditions = () =>
    props.files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = () =>
    props.files.reduce((s, f) => s + f.deletions, 0);

  const displayFiles = () =>
    props.activeFile
      ? props.files.filter((f) => f.filename === props.activeFile)
      : props.files;

  return (
    <div class="space-y-2 mt-2">
      <div class="text-xs text-gray-400">
        {props.files.length} file{props.files.length !== 1 ? "s" : ""}{" "}
        changed,{" "}
        <span class="text-green-400">+{totalAdditions()}</span>{" "}
        <span class="text-red-400">-{totalDeletions()}</span>
      </div>
      <For each={displayFiles()}>
        {(file) => (
          <FileSection
            file={file}
            owner={props.owner}
            repo={props.repo}
            prNumber={props.prNumber}
            token={props.token}
            inlineComments={props.inlineComments}
            headSha={props.headSha}
            onInlineCommentsChange={props.onInlineCommentsChange}
            collaborators={props.collaborators}
            username={props.username}
            onEditInlineComment={props.onEditInlineComment}
          />
        )}
      </For>
    </div>
  );
}

export default DiffViewer;
export type { PrFile };
