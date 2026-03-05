import { createSignal, Show, For, type Accessor } from "solid-js";

export interface Collaborator {
  login: string;
  avatar_url: string;
}

interface MentionTextareaProps {
  value: Accessor<string>;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  collaborators?: Collaborator[];
  class?: string;
}

function MentionTextarea(props: MentionTextareaProps) {
  const [mentionQuery, setMentionQuery] = createSignal<string | null>(null);
  const [mentionIndex, setMentionIndex] = createSignal(0);
  let textareaRef: HTMLTextAreaElement | undefined;

  const mentionResults = () => {
    const q = mentionQuery();
    if (q === null || !props.collaborators) return [];
    const lower = q.toLowerCase();
    return props.collaborators
      .filter((c) => c.login.toLowerCase().startsWith(lower))
      .slice(0, 8);
  };

  const handleInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    const textarea = e.currentTarget;
    props.onValueChange(textarea.value);

    const pos = textarea.selectionStart;
    const text = textarea.value.slice(0, pos);
    const match = text.match(/(^|[\s])@([a-zA-Z0-9_-]*)$/);

    if (match && props.collaborators) {
      setMentionQuery(match[2]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  const insertMention = (login: string) => {
    if (!textareaRef) return;
    const pos = textareaRef.selectionStart;
    const text = props.value();
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    const match = before.match(/(^|[\s])@([a-zA-Z0-9_-]*)$/);
    if (!match) return;

    const mentionStart = pos - match[2].length;
    const newText = text.slice(0, mentionStart) + login + " " + after;
    props.onValueChange(newText);
    setMentionQuery(null);

    const newPos = mentionStart + login.length + 1;
    requestAnimationFrame(() => {
      textareaRef!.focus();
      textareaRef!.setSelectionRange(newPos, newPos);
    });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const results = mentionResults();
    if (results.length === 0 || mentionQuery() === null) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertMention(results[mentionIndex()].login);
    } else if (e.key === "Escape") {
      setMentionQuery(null);
    }
  };

  return (
    <div class="relative">
      <textarea
        ref={textareaRef}
        class={props.class ?? "w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm text-gray-200 placeholder-gray-500 resize-y min-h-[60px] focus:outline-none focus:border-blue-600"}
        placeholder={props.placeholder ?? "Leave a comment..."}
        value={props.value()}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        disabled={props.disabled}
        rows={props.rows ?? 3}
      />
      <Show when={mentionQuery() !== null && mentionResults().length > 0}>
        <div class="absolute z-30 bottom-full mb-1 left-0 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-lg overflow-hidden">
          <For each={mentionResults()}>
            {(user, i) => (
              <button
                class={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  i() === mentionIndex()
                    ? "bg-indigo-600 text-white"
                    : "text-gray-300 hover:bg-gray-700"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(user.login);
                }}
                onMouseEnter={() => setMentionIndex(i())}
              >
                <img
                  src={user.avatar_url}
                  class="w-4 h-4 rounded-full"
                  alt=""
                />
                <span>{user.login}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default MentionTextarea;
