import { createSignal, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import MentionTextarea, { type Collaborator } from "./MentionTextarea";

interface ReviewPanelProps {
  owner: string;
  repo: string;
  prNumber: number;
  token: string;
  collaborators?: Collaborator[];
}

type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

function ReviewPanel(props: ReviewPanelProps) {
  const [event, setEvent] = createSignal<ReviewEvent>("APPROVE");
  const [body, setBody] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [result, setResult] = createSignal<"success" | "error" | null>(null);
  const [errorMsg, setErrorMsg] = createSignal("");

  const handleSubmit = async () => {
    if (event() === "REQUEST_CHANGES" && !body().trim()) return;
    setSubmitting(true);
    setResult(null);
    setErrorMsg("");
    try {
      await invoke("submit_review", {
        owner: props.owner,
        repo: props.repo,
        prNumber: props.prNumber,
        event: event(),
        body: body(),
        token: props.token,
      });
      setResult("success");
      setBody("");
      setTimeout(() => setResult(null), 3000);
    } catch (e) {
      setResult("error");
      setErrorMsg(`${e}`);
    } finally {
      setSubmitting(false);
    }
  };

  const buttons: { label: string; value: ReviewEvent; color: string; activeColor: string }[] = [
    { label: "Comment", value: "COMMENT", color: "border-gray-600 text-gray-300", activeColor: "bg-gray-700 border-gray-500 text-white" },
    { label: "Approve", value: "APPROVE", color: "border-gray-600 text-gray-300", activeColor: "bg-green-900 border-green-600 text-green-300" },
    { label: "Request Changes", value: "REQUEST_CHANGES", color: "border-gray-600 text-gray-300", activeColor: "bg-red-900 border-red-600 text-red-300" },
  ];

  return (
    <div class="bg-gray-900 border border-gray-800 rounded-lg p-3 space-y-3">
      <h3 class="text-sm font-semibold text-gray-200">Submit Review</h3>
      <div class="flex gap-2">
        {buttons.map((btn) => (
          <button
            class={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              event() === btn.value ? btn.activeColor : btn.color
            }`}
            onClick={() => setEvent(btn.value)}
          >
            {btn.label}
          </button>
        ))}
      </div>
      <MentionTextarea
        value={body}
        onValueChange={setBody}
        placeholder={
          event() === "APPROVE"
            ? "Optional review comment..."
            : "Review comment..."
        }
        disabled={submitting()}
        collaborators={props.collaborators}
        class="w-full bg-gray-950 border border-gray-700 rounded-lg p-2 text-sm text-gray-200 placeholder-gray-500 resize-y min-h-[60px] focus:outline-none focus:border-blue-600"
      />
      <div class="flex items-center gap-3">
        <button
          onClick={handleSubmit}
          disabled={
            submitting() ||
            (event() === "REQUEST_CHANGES" && !body().trim())
          }
          class="px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-700 text-white hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting() ? "Submitting..." : "Submit Review"}
        </button>
        <Show when={result() === "success"}>
          <span class="text-xs text-green-400">Review submitted!</span>
        </Show>
        <Show when={result() === "error"}>
          <span class="text-xs text-red-400">{errorMsg()}</span>
        </Show>
      </div>
    </div>
  );
}

export default ReviewPanel;
