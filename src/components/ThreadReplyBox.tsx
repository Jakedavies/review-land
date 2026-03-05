import { createSignal, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import MentionTextarea, { type Collaborator } from "./MentionTextarea";

type ReviewAction = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

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
  const [action, setAction] = createSignal<ReviewAction>("COMMENT");
  const [submitting, setSubmitting] = createSignal(false);
  const [result, setResult] = createSignal<"success" | "error" | null>(null);
  const [errorMsg, setErrorMsg] = createSignal("");

  const actions: { label: string; value: ReviewAction; activeColor: string }[] = [
    { label: "Comment", value: "COMMENT", activeColor: "bg-gray-700 border-gray-500 text-white" },
    { label: "Approve", value: "APPROVE", activeColor: "bg-green-900 border-green-600 text-green-300" },
    { label: "Request Changes", value: "REQUEST_CHANGES", activeColor: "bg-red-900 border-red-600 text-red-300" },
  ];

  const handleSubmit = async () => {
    const text = body().trim();
    const act = action();

    // Comment requires body; Request Changes requires body; Approve body is optional
    if (act === "COMMENT" && !text) return;
    if (act === "REQUEST_CHANGES" && !text) return;

    setSubmitting(true);
    setResult(null);
    setErrorMsg("");

    try {
      if (act === "COMMENT") {
        // Plain comment (not a review)
        await invoke("post_comment", {
          owner: props.owner,
          repo: props.repo,
          prNumber: props.prNumber,
          body: text,
          token: props.token,
        });
      } else {
        // Submit as review (APPROVE or REQUEST_CHANGES)
        await invoke("submit_review", {
          owner: props.owner,
          repo: props.repo,
          prNumber: props.prNumber,
          event: act,
          body: text,
          token: props.token,
        });
      }
      setResult("success");
      setBody("");
      props.onCommented?.();
      setTimeout(() => setResult(null), 3000);
    } catch (e) {
      setResult("error");
      setErrorMsg(`${e}`);
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel = () => {
    if (submitting()) return "Submitting...";
    switch (action()) {
      case "APPROVE": return "Approve";
      case "REQUEST_CHANGES": return "Request Changes";
      default: return "Comment";
    }
  };

  return (
    <div class="space-y-2">
      <div class="flex gap-1.5">
        {actions.map((act) => (
          <button
            class={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
              action() === act.value ? act.activeColor : "border-gray-600 text-gray-400"
            }`}
            onClick={() => setAction(act.value)}
          >
            {act.label}
          </button>
        ))}
      </div>
      <MentionTextarea
        value={body}
        onValueChange={setBody}
        placeholder={
          action() === "APPROVE"
            ? "Optional comment..."
            : action() === "REQUEST_CHANGES"
              ? "Describe the changes needed..."
              : "Leave a comment..."
        }
        disabled={submitting()}
        collaborators={props.collaborators}
      />
      <div class="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={
            submitting() ||
            (action() === "COMMENT" && !body().trim()) ||
            (action() === "REQUEST_CHANGES" && !body().trim())
          }
          class={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            action() === "APPROVE"
              ? "bg-green-700 text-white hover:bg-green-600"
              : action() === "REQUEST_CHANGES"
                ? "bg-red-700 text-white hover:bg-red-600"
                : "bg-blue-700 text-white hover:bg-blue-600"
          }`}
        >
          {submitLabel()}
        </button>
        <Show when={result() === "success"}>
          <span class="text-xs text-green-400">
            {action() === "APPROVE" ? "Approved!" : action() === "REQUEST_CHANGES" ? "Changes requested!" : "Comment posted!"}
          </span>
        </Show>
        <Show when={result() === "error"}>
          <span class="text-xs text-red-400">{errorMsg()}</span>
        </Show>
      </div>
    </div>
  );
}

export default ThreadReplyBox;
