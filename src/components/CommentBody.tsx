import { For, createSignal, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

type Segment =
  | { kind: "text"; text: string }
  | { kind: "img"; src: string; alt: string }
  | { kind: "link"; href: string; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "sub"; text: string }
  | { kind: "bold"; text: string };

function parseComment(body: string): Segment[] {
  const segments: Segment[] = [];
  // Match: Markdown images, HTML images, HTML links, Markdown links, HTML headings, HTML <sub>
  const regex =
    /!\[([^\]]*)\]\(([^)]+)\)|<img\s+[^>]*src=["']([^"']+)["'][^>]*>|<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>|\[([^\]]+)\]\(([^)]+)\)|<(h[1-4])>([\s\S]*?)<\/\8>|<sub>([\s\S]*?)<\/sub>|\*\*(.+?)\*\*|^(#{1,4})\s+(.+)$|(?:https?:\/\/[^\s<)\]]+)/gim;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(body)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", text: body.slice(lastIndex, match.index) });
    }
    if (match[2]) {
      // Markdown image ![alt](url)
      segments.push({ kind: "img", src: match[2], alt: match[1] });
    } else if (match[3]) {
      // HTML <img>
      const altMatch = match[0].match(/alt=["']([^"']*)["']/i);
      segments.push({ kind: "img", src: match[3], alt: altMatch?.[1] ?? "" });
    } else if (match[4] !== undefined) {
      // HTML <a href="...">text</a>
      segments.push({ kind: "link", href: match[4], text: match[5] || match[4] });
    } else if (match[7] !== undefined) {
      // Markdown [text](url)
      segments.push({ kind: "link", href: match[7], text: match[6] });
    } else if (match[8] !== undefined) {
      // HTML <h1>-<h4>
      const level = parseInt(match[8][1]);
      segments.push({ kind: "heading", level, text: match[9] });
    } else if (match[10] !== undefined) {
      // HTML <sub>
      segments.push({ kind: "sub", text: match[10] });
    } else if (match[11] !== undefined) {
      // Markdown **bold**
      segments.push({ kind: "bold", text: match[11] });
    } else if (match[12] !== undefined) {
      // Markdown heading ## text
      segments.push({ kind: "heading", level: match[12].length, text: match[13] });
    } else if (match[0].startsWith("http")) {
      // Bare URL
      segments.push({ kind: "link", href: match[0], text: match[0] });
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

const isSafeUrl = (url: string) => /^https?:\/\//i.test(url);

function CommentBody(props: { body: string; class?: string }) {
  const segments = () => parseComment(props.body);

  return (
    <div class={props.class ?? "text-sm text-gray-300 whitespace-pre-wrap"}>
      <For each={segments()}>
        {(seg) => {
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
            default:
              return <span>{seg.text}</span>;
          }
        }}
      </For>
    </div>
  );
}

export default CommentBody;
