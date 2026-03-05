import { createSignal, Show } from "solid-js";
import MentionTextarea, { type Collaborator } from "./MentionTextarea";

interface CommentBoxProps {
  onSubmit: (body: string) => Promise<void>;
  placeholder?: string;
  label?: string;
  onCancel?: () => void;
  collaborators?: Collaborator[];
}

function CommentBox(props: CommentBoxProps) {
  const [body, setBody] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal("");

  const handleSubmit = async () => {
    const text = body().trim();
    if (!text) return;
    setSubmitting(true);
    setError("");
    try {
      await props.onSubmit(text);
      setBody("");
    } catch (e) {
      setError(`${e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="space-y-2">
      <MentionTextarea
        value={body}
        onValueChange={setBody}
        placeholder={props.placeholder}
        disabled={submitting()}
        collaborators={props.collaborators}
      />
      <Show when={error()}>
        <div class="text-xs text-red-400">{error()}</div>
      </Show>
      <div class="flex items-center gap-2">
        <Show when={props.onCancel}>
          <button
            onClick={props.onCancel}
            class="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 transition-colors"
            disabled={submitting()}
          >
            Cancel
          </button>
        </Show>
        <button
          onClick={handleSubmit}
          disabled={submitting() || !body().trim()}
          class="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-700 text-white hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting() ? "Submitting..." : (props.label ?? "Comment")}
        </button>
      </div>
    </div>
  );
}

export default CommentBox;
export type { Collaborator };
