import { For, Show, createSignal, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

type Segment =
  | { kind: "text"; text: string }
  | { kind: "img"; src: string; alt: string }
  | { kind: "link"; href: string; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "sub"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code_block"; lang: string; code: string }
  | { kind: "inline_code"; code: string }
  | { kind: "details"; summary: string; body: Segment[] };

/** Parse inline markdown/HTML within a text chunk (no block-level elements). */
function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  const regex =
    /`([^`]+)`|!\[([^\]]*)\]\(([^)]+)\)|<img\s+[^>]*src=["']([^"']+)["'][^>]*>|<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>|\[([^\]]+)\]\(([^)]+)\)|<(h[1-4])>([\s\S]*?)<\/\9>|<sub>([\s\S]*?)<\/sub>|\*\*(.+?)\*\*|^(#{1,4})\s+(.+)$|(?:https?:\/\/[^\s<)\]]+)/gim;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      segments.push({ kind: "inline_code", code: match[1] });
    } else if (match[3]) {
      segments.push({ kind: "img", src: match[3], alt: match[2] });
    } else if (match[4]) {
      const altMatch = match[0].match(/alt=["']([^"']*)["']/i);
      segments.push({ kind: "img", src: match[4], alt: altMatch?.[1] ?? "" });
    } else if (match[5] !== undefined) {
      segments.push({ kind: "link", href: match[5], text: match[6] || match[5] });
    } else if (match[8] !== undefined) {
      segments.push({ kind: "link", href: match[8], text: match[7] });
    } else if (match[9] !== undefined) {
      const level = parseInt(match[9][1]);
      segments.push({ kind: "heading", level, text: match[10] });
    } else if (match[11] !== undefined) {
      segments.push({ kind: "sub", text: match[11] });
    } else if (match[12] !== undefined) {
      segments.push({ kind: "bold", text: match[12] });
    } else if (match[13] !== undefined) {
      segments.push({ kind: "heading", level: match[13].length, text: match[14] });
    } else if (match[0].startsWith("http")) {
      segments.push({ kind: "link", href: match[0], text: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }

  return segments;
}

/** Top-level parser: extract block elements first, then parse inline content. */
function parseComment(body: string): Segment[] {
  const segments: Segment[] = [];
  const blockRegex =
    /```(\w*)\n([\s\S]*?)```|<details>\s*(?:<summary>([\s\S]*?)<\/summary>)?\s*([\s\S]*?)<\/details>/gim;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(body)) !== null) {
    if (match.index > lastIndex) {
      segments.push(...parseInline(body.slice(lastIndex, match.index)));
    }
    if (match[2] !== undefined && match[0].startsWith("```")) {
      segments.push({ kind: "code_block", lang: match[1] || "", code: match[2] });
    } else {
      const summary = match[3]?.trim() || "Details";
      const innerBody = match[4]?.trim() || "";
      segments.push({ kind: "details", summary, body: parseComment(innerBody) });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < body.length) {
    segments.push(...parseInline(body.slice(lastIndex)));
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

const isSafeUrl = (url: string) => /^https?:\/\//i.test(url);

function SegmentRenderer(props: { seg: Segment }) {
  const seg = props.seg;
  switch (seg.kind) {
    case "img":
      return isSafeUrl(seg.src)
        ? <ProxiedImage src={seg.src} alt={seg.alt} />
        : <span class="text-gray-500 text-xs">[image]</span>;
    case "link":
      return isSafeUrl(seg.href)
        ? (
          <a href={seg.href} target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 underline">
            {seg.text}
          </a>
        )
        : <span>{seg.text}</span>;
    case "heading": {
      const classes: Record<number, string> = {
        1: "text-lg font-bold text-gray-100 mt-3 mb-1",
        2: "text-base font-semibold text-gray-100 mt-2 mb-1",
        3: "text-sm font-semibold text-gray-200 mt-2 mb-1",
        4: "text-sm font-medium text-gray-200 mt-1 mb-0.5",
      };
      return <div class={classes[seg.level]}>{seg.text}</div>;
    }
    case "sub":
      return <sub class="text-xs text-gray-400">{seg.text}</sub>;
    case "bold":
      return <strong class="font-semibold text-gray-100">{seg.text}</strong>;
    case "inline_code":
      return <code class="px-1.5 py-0.5 rounded bg-gray-800 text-orange-300 text-[13px] font-mono">{seg.code}</code>;
    case "code_block":
      return (
        <div class="my-2">
          <Show when={seg.lang}>
            <div class="text-[10px] text-gray-500 bg-gray-800 rounded-t px-2 py-0.5 border border-b-0 border-gray-700 w-fit font-mono">{seg.lang}</div>
          </Show>
          <pre class={`bg-gray-950 border border-gray-700 ${seg.lang ? "rounded-b" : "rounded"} p-3 overflow-x-auto`}>
            <code class="text-sm font-mono text-gray-200">{seg.code}</code>
          </pre>
        </div>
      );
    case "details":
      return (
        <details class="my-2 border border-gray-700 rounded-lg overflow-hidden">
          <summary class="px-3 py-1.5 bg-gray-800 text-sm font-medium text-gray-200 cursor-pointer select-none">{seg.summary}</summary>
          <div class="px-3 py-2 text-sm text-gray-300 whitespace-pre-wrap">
            <For each={seg.body}>
              {(inner) => <SegmentRenderer seg={inner} />}
            </For>
          </div>
        </details>
      );
    default:
      return <span>{seg.text}</span>;
  }
}

function CommentBody(props: { body: string; class?: string }) {
  const segments = () => parseComment(props.body);

  return (
    <div class={props.class ?? "text-sm text-gray-300 whitespace-pre-wrap"}>
      <For each={segments()}>
        {(seg) => <SegmentRenderer seg={seg} />}
      </For>
    </div>
  );
}

export default CommentBody;
