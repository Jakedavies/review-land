import { createSignal, onMount, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

interface RepoConfig {
  owner: string;
  repo: string;
  filter_mode: string;
}

interface AppSettings {
  github_token: string;
  repos: RepoConfig[];
  username: string;
  refresh_interval_secs: number;
}

function Settings() {
  const [token, setToken] = createSignal("");
  const [repos, setRepos] = createSignal<RepoConfig[]>([]);
  const [repoInput, setRepoInput] = createSignal("");
  const [username, setUsername] = createSignal("");
  const [refreshInterval, setRefreshInterval] = createSignal(300);
  const [status, setStatus] = createSignal("");
  const [testResult, setTestResult] = createSignal("");

  onMount(async () => {
    const settings = await invoke<AppSettings>("get_settings");
    setToken(settings.github_token);
    setRepos(settings.repos);
    setUsername(settings.username);
    setRefreshInterval(settings.refresh_interval_secs || 300);
  });

  const save = async () => {
    await invoke("save_settings", {
      settings: {
        github_token: token(),
        repos: repos(),
        username: username(),
        refresh_interval_secs: refreshInterval(),
      },
    });
    // Clear dashboard cache when settings change (repos/token may have changed)
    await invoke("clear_dashboard_cache").catch(() => {});
    setStatus("Settings saved!");
    setTimeout(() => setStatus(""), 2000);
  };

  const testConnection = async () => {
    setTestResult("Testing...");
    try {
      const user = await invoke<{ login: string }>("get_github_user", {
        token: token(),
      });
      setUsername(user.login);
      setTestResult(`Connected as ${user.login}`);
    } catch (e) {
      setTestResult(`Error: ${e}`);
    }
  };

  const addRepo = () => {
    const val = repoInput().trim();
    const parts = val.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      setStatus("Enter repo as owner/repo");
      return;
    }
    const exists = repos().some(
      (r) => r.owner === parts[0] && r.repo === parts[1],
    );
    if (exists) {
      setStatus("Repo already added");
      return;
    }
    setRepos([...repos(), { owner: parts[0], repo: parts[1], filter_mode: "all" }]);
    setRepoInput("");
  };

  const removeRepo = (index: number) => {
    setRepos(repos().filter((_, i) => i !== index));
  };

  return (
    <div class="max-w-2xl">
      <h2 class="text-2xl font-bold mb-4">Settings</h2>

      {/* GitHub Token */}
      <section class="mb-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-2">
          GitHub Personal Access Token
        </h3>
        <p class="text-xs text-gray-400 mb-2">
          Requires a classic PAT with <span class="font-mono font-medium text-gray-300">repo</span> scope,
          or a fine-grained PAT with <span class="font-mono font-medium text-gray-300">Pull requests</span> (read)
          and <span class="font-mono font-medium text-gray-300">Contents</span> (read) permissions
          on the repos you want to watch.
        </p>
        <div class="flex gap-2">
          <input
            type="password"
            value={token()}
            onInput={(e) => setToken(e.currentTarget.value)}
            placeholder="ghp_..."
            class="flex-1 px-3 py-2 border border-gray-700 bg-gray-900 text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder-gray-600"
          />
          <button
            onClick={testConnection}
            class="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
          >
            Test
          </button>
        </div>
        {testResult() && (
          <p
            class={`text-sm mt-2 ${testResult().startsWith("Error") ? "text-red-400" : "text-green-400"}`}
          >
            {testResult()}
          </p>
        )}
      </section>

      {/* Refresh Interval */}
      <section class="mb-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-2">
          Refresh interval (seconds)
        </h3>
        <input
          type="number"
          value={refreshInterval()}
          onInput={(e) =>
            setRefreshInterval(parseInt(e.currentTarget.value) || 300)
          }
          min="60"
          class="w-32 px-3 py-2 border border-gray-700 bg-gray-900 text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </section>

      {/* Repos */}
      <section class="mb-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-2">
          Watched Repositories
        </h3>
        <div class="flex gap-2 mb-3">
          <input
            value={repoInput()}
            onInput={(e) => setRepoInput(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && addRepo()}
            placeholder="owner/repo"
            class="flex-1 px-3 py-2 border border-gray-700 bg-gray-900 text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder-gray-600"
          />
          <button
            onClick={addRepo}
            class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Add
          </button>
        </div>
        <ul class="space-y-2">
          <For each={repos()}>
            {(repo, i) => (
              <li class="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2">
                <span class="text-sm font-mono text-gray-300 flex-1">
                  {repo.owner}/{repo.repo}
                </span>
                <select
                  value={repo.filter_mode || "all"}
                  onChange={(e) => {
                    const updated = [...repos()];
                    updated[i()] = { ...updated[i()], filter_mode: e.currentTarget.value };
                    setRepos(updated);
                  }}
                  class="text-xs border border-gray-700 rounded px-2 py-1 bg-gray-800 text-gray-300 [&>option]:bg-gray-800 [&>option]:text-gray-300"
                >
                  <option value="all">All PRs</option>
                  <option value="involved">Mine + Tagged</option>
                </select>
                <button
                  onClick={() => removeRepo(i())}
                  class="text-gray-500 hover:text-red-400 transition-colors text-sm"
                >
                  Remove
                </button>
              </li>
            )}
          </For>
        </ul>
        {repos().length === 0 && (
          <p class="text-sm text-gray-500 italic">No repos configured yet.</p>
        )}
      </section>

      {/* Save */}
      <div class="flex items-center gap-3">
        <button
          onClick={save}
          class="px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          Save Settings
        </button>
        {status() && <span class="text-sm text-green-400">{status()}</span>}
      </div>
    </div>
  );
}

export default Settings;
