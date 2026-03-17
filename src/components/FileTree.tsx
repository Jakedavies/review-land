import { createSignal, For, Show } from "solid-js";

interface PrFile {
  filename: string;
  status: string;
  sha: string;
}

interface FileViewEntry {
  sha: string;
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  file?: PrFile;
}

function buildTree(files: PrFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };

  for (const file of files) {
    const parts = file.filename.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          children: [],
          file: isFile ? file : undefined,
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  // Collapse single-child directories
  function collapse(node: TreeNode): TreeNode {
    node.children = node.children.map(collapse);
    if (!node.file && node.children.length === 1 && !node.children[0].file) {
      const child = node.children[0];
      return {
        name: node.name ? `${node.name}/${child.name}` : child.name,
        path: child.path,
        children: child.children,
        file: child.file,
      };
    }
    return node;
  }

  const collapsed = collapse(root);
  return collapsed.children;
}

function statusDot(status: string) {
  const colors: Record<string, string> = {
    added: "bg-green-400",
    modified: "bg-yellow-400",
    removed: "bg-red-400",
    renamed: "bg-blue-400",
  };
  return (
    <span
      class={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${colors[status] || "bg-gray-400"}`}
    />
  );
}

type ViewedStatus = "not-viewed" | "viewed" | "changed";

function viewedIndicator(status: ViewedStatus) {
  if (status === "viewed") {
    return (
      <span class="text-green-500 text-[10px] flex-shrink-0" title="Viewed">
        ✓
      </span>
    );
  }
  if (status === "changed") {
    return (
      <span
        class="inline-block w-2 h-2 rounded-full flex-shrink-0 bg-orange-400"
        title="Changed since viewed"
      />
    );
  }
  return null;
}

function TreeNodeView(props: {
  node: TreeNode;
  depth: number;
  activeFile?: string;
  viewedFiles?: Record<string, FileViewEntry>;
  commentCounts?: Record<string, number>;
  onSelectFile?: (filename: string) => void;
}) {
  const [open, setOpen] = createSignal(true);
  const isDir = () => !props.node.file;

  const viewedStatus = (): ViewedStatus => {
    if (!props.node.file || !props.viewedFiles) return "not-viewed";
    const entry = props.viewedFiles[props.node.file.filename];
    if (!entry) return "not-viewed";
    if (entry.sha === props.node.file.sha) return "viewed";
    return "changed";
  };

  const isActive = () =>
    props.node.file && props.activeFile === props.node.file.filename;

  return (
    <div>
      <button
        class={`w-full flex items-center gap-1.5 py-0.5 text-left text-xs rounded px-1 transition-colors ${
          isActive()
            ? "bg-blue-900/50 text-blue-200"
            : "hover:bg-gray-800"
        }`}
        style={{ "padding-left": `${props.depth * 12 + 4}px` }}
        onClick={() => {
          if (isDir()) setOpen(!open());
          else props.onSelectFile?.(props.node.file!.filename);
        }}
      >
        <Show when={isDir()}>
          <span class="text-gray-500 w-3 text-center flex-shrink-0">
            {open() ? "\u25BC" : "\u25B6"}
          </span>
        </Show>
        <Show when={!isDir()}>
          {statusDot(props.node.file!.status)}
        </Show>
        <span
          class={`truncate ${
            isDir()
              ? "text-gray-400 font-medium"
              : viewedStatus() === "viewed"
                ? "text-gray-500"
                : "text-gray-300"
          }`}
        >
          {props.node.name}
        </span>
        <Show when={!isDir() && props.commentCounts?.[props.node.file!.filename]}>
          <span class="px-1 rounded text-[9px] font-medium bg-indigo-900 text-indigo-300 flex-shrink-0">
            {props.commentCounts![props.node.file!.filename]}
          </span>
        </Show>
        <Show when={!isDir()}>
          {viewedIndicator(viewedStatus())}
        </Show>
      </button>
      <Show when={isDir() && open()}>
        <For each={props.node.children}>
          {(child) => (
            <TreeNodeView
              node={child}
              depth={props.depth + 1}
              activeFile={props.activeFile}
              viewedFiles={props.viewedFiles}
              commentCounts={props.commentCounts}
              onSelectFile={props.onSelectFile}
            />
          )}
        </For>
      </Show>
    </div>
  );
}

function FileTree(props: {
  files: PrFile[];
  activeFile?: string;
  viewedFiles?: Record<string, FileViewEntry>;
  commentCounts?: Record<string, number>;
  onSelectFile?: (filename: string) => void;
}) {
  const tree = () => buildTree(props.files);

  return (
    <div class="bg-gray-900 border border-gray-800 rounded-lg p-2">
      <div class="text-xs font-semibold text-gray-400 mb-1 px-1">Files</div>
      <For each={tree()}>
        {(node) => (
          <TreeNodeView
            node={node}
            depth={0}
            activeFile={props.activeFile}
            viewedFiles={props.viewedFiles}
            commentCounts={props.commentCounts}
            onSelectFile={props.onSelectFile}
          />
        )}
      </For>
    </div>
  );
}

export default FileTree;
export type { FileViewEntry };
