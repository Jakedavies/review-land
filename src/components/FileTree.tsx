import { createSignal, For, Show } from "solid-js";

interface PrFile {
  filename: string;
  status: string;
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

function TreeNodeView(props: { node: TreeNode; depth: number }) {
  const [open, setOpen] = createSignal(true);
  const isDir = () => !props.node.file;

  const scrollToFile = () => {
    if (props.node.file) {
      const el = document.getElementById(
        `file-${encodeURIComponent(props.node.file.filename)}`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div>
      <button
        class="w-full flex items-center gap-1.5 py-0.5 text-left text-xs hover:bg-gray-800 rounded px-1 transition-colors"
        style={{ "padding-left": `${props.depth * 12 + 4}px` }}
        onClick={() => {
          if (isDir()) setOpen(!open());
          else scrollToFile();
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
          class={`truncate ${isDir() ? "text-gray-400 font-medium" : "text-gray-300"}`}
        >
          {props.node.name}
        </span>
      </button>
      <Show when={isDir() && open()}>
        <For each={props.node.children}>
          {(child) => <TreeNodeView node={child} depth={props.depth + 1} />}
        </For>
      </Show>
    </div>
  );
}

function FileTree(props: { files: PrFile[] }) {
  const tree = () => buildTree(props.files);

  return (
    <div class="bg-gray-900 border border-gray-800 rounded-lg p-2">
      <div class="text-xs font-semibold text-gray-400 mb-1 px-1">Files</div>
      <For each={tree()}>
        {(node) => <TreeNodeView node={node} depth={0} />}
      </For>
    </div>
  );
}

export default FileTree;
