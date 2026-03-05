import { For, createSignal, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

type Segment =
  | { kind: "text"; text: string }
  | { kind: "img"; src: string; alt: string };

function parseComment(body: string): Segment[] {
  const segments: Segment[] = [];
  // Match both Markdown images ![alt](url) and HTML <img src="url" alt="...">
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)|<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = imgRegex.exec(body)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", text: body.slice(lastIndex, match.index) });
    }
    if (match[2]) {
      segments.push({ kind: "img", src: match[2], alt: match[1] });
    } else {
      const altMatch = match[0].match(/alt=["']([^"']*)["']/i);
      segments.push({ kind: "img", src: match[3], alt: altMatch?.[1] ?? "" });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < body.length) {
    segments.push({ kind: "text", text: body.slice(lastIndex) });
  }

  return segments;
}

function ProxiedImage(props: { src: string; alt: string }) {
  const [dataUrl, setDataUrl] = createSignal<string | null>(null);
  const [failed, setFailed] = createSignal(false);

  onMount(async () => {
    // Try direct load first — if it fails, proxy through backend
    const img = new Image();
    img.onload = () => setDataUrl(props.src);
    img.onerror = async () => {
      try {
        const settings = await invoke<{ github_token: string }>("get_settings");
        const result = await invoke<string>("proxy_image", {
          url: props.src,
          token: settings.github_token,
        });
        setDataUrl(result);
      } catch {
        setFailed(true);
      }
    };
    img.src = props.src;
  });

  return (
    <>
      {failed() ? (
        <a href={props.src} class="text-blue-400 underline text-xs" target="_blank">
          [image]
        </a>
      ) : dataUrl() ? (
        <img
          src={dataUrl()!}
          alt={props.alt}
          class="max-w-[400px] max-h-[300px] object-contain rounded my-1"
          loading="lazy"
        />
      ) : (
        <span class="text-gray-500 text-xs">Loading image...</span>
      )}
    </>
  );
}

function CommentBody(props: { body: string; class?: string }) {
  const segments = () => parseComment(props.body);

  return (
    <div class={props.class ?? "text-sm text-gray-300 whitespace-pre-wrap"}>
      <For each={segments()}>
        {(seg) =>
          seg.kind === "img" ? (
            <ProxiedImage src={seg.src} alt={seg.alt} />
          ) : (
            <span>{seg.text}</span>
          )
        }
      </For>
    </div>
  );
}

export default CommentBody;
