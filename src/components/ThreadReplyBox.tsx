import { createSignal, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import MentionTextarea, { type Collaborator } from "./MentionTextarea";

interface ThreadReplyBoxProps {
  owner: string;
  repo: string;
  prNumber: number;
  token: string;
  collaborators?: Collaborator[];
  onCommented?: () => void;
}

function ThreadReplyBox(props: ThreadReplyBoxProps) {
  const [body, setBody] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [result, setResult] = createSignal<"success" | "error" | null>(null);
  const [resultMsg, setResultMsg] = createSignal("");

  const submit = async (action: "COMMENT" | "APPROVE" | "REQUEST_CHANGES") => {
    const text = body().trim();
    if (action === "COMMENT" && !text) return;
    if (action === "REQUEST_CHANGES" && !text) return;

    setSubmitting(true);
    setResult(null);
    setResultMsg("");

    try {
      if (action === "COMMENT") {
        await invoke("post_comment", {
          owner: props.owner,
          repo: props.repo,
          prNumber: props.prNumber,
          body: text,
          token: props.token,
        });
      } else {
        await invoke("submit_review", {
          owner: props.owner,
          repo: props.repo,
          prNumber: props.prNumber,
          event: action,
          body: text,
          token: props.token,
        });
      }
      setResult("success");
      setResultMsg(
        action === "APPROVE" ? "Approved!" :
        action === "REQUEST_CHANGES" ? "Changes requested!" :
        "Comment posted!"
      );
      setBody("");
      props.onCommented?.();
      setTimeout(() => setResult(null), 3000);
    } catch (e) {
      setResult("error");
      setResultMsg(`${e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="space-y-2">
      <MentionTextarea
        value={body}
        onValueChange={setBody}
        placeholder="Leave a comment..."
        disabled={submitting()}
        collaborators={props.collaborators}
      />
      <div class="flex items-center gap-2">
        <button
          onClick={() => submit("COMMENT")}
          disabled={submitting() || !body().trim()}
          class="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-700 text-white hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Comment
        </button>
        <button
          onClick={() => submit("APPROVE")}
          disabled={submitting()}
          class="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-800 text-green-200 hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Approve
        </button>
        <button
          onClick={() => submit("REQUEST_CHANGES")}
          disabled={submitting() || !body().trim()}
          class="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-800 text-red-200 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Request Changes
        </button>
        <Show when={result() === "success"}>
          <span class="text-xs text-green-400">{resultMsg()}</span>
        </Show>
        <Show when={result() === "error"}>
          <span class="text-xs text-red-400">{resultMsg()}</span>
        </Show>
      </div>
    </div>
  );
}

export default ThreadReplyBox;
