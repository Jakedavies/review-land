import { A, useLocation } from "@solidjs/router";
import { Show } from "solid-js";

function Sidebar() {
  const location = useLocation();

  const linkClass = (path: string) =>
    `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      location.pathname === path
        ? "bg-indigo-600 text-white"
        : "text-gray-300 hover:bg-gray-800 hover:text-gray-100"
    }`;

  const diffMatch = () => {
    const match = location.pathname.match(
      /^\/diff\/([^/]+)\/([^/]+)\/(\d+)$/,
    );
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: match[3] };
  };

  return (
    <nav class="w-56 bg-gray-900 border-r border-gray-800 flex flex-col p-3">
      <h1 class="text-lg font-bold text-gray-100 mb-3 px-2">PR Review Land</h1>
      <div class="space-y-0.5">
        <A href="/" class={linkClass("/")}>
          Dashboard
        </A>
        <A href="/settings" class={linkClass("/settings")}>
          Settings
        </A>
      </div>
      <Show when={diffMatch()}>
        {(pr) => (
          <div class="mt-4 pt-3 border-t border-gray-800">
            <div class="px-2 text-xs text-gray-500 mb-1">Viewing PR</div>
            <div class="px-2 py-1.5 rounded-lg bg-indigo-600/15 border border-indigo-500/30">
              <div class="text-xs font-medium text-indigo-300 truncate">
                {pr().owner}/{pr().repo}
              </div>
              <div class="text-sm font-bold text-gray-100">
                #{pr().number}
              </div>
            </div>
          </div>
        )}
      </Show>
    </nav>
  );
}

export default Sidebar;
