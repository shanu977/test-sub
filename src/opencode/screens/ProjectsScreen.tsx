"use client";

import { useCallback, useEffect, useState } from "react";
import { useOpenCodeStore } from "../store";
import type { ProjectInfoView } from "../types";
import ScreenHeader from "../components/ScreenHeader";

interface Root {
  path: string;
  label: string;
  source: string;
}
interface Entry {
  name: string;
  path: string;
  hasGit: boolean;
}

interface ProjectsScreenProps {
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  embedded?: boolean;
}

/**
 * Project management — migrated from Nexuss Lab `/projects`.
 * Allowed roots, directory browsing, inspection (files, git, working-tree
 * changes) and project selection with server-side containment validation.
 */
export default function ProjectsScreen({ sidebarOpen, onToggleSidebar, embedded = false }: ProjectsScreenProps) {
  const status = useOpenCodeStore((s) => s.status);
  const refresh = useOpenCodeStore((s) => s.refresh);
  const notify = useOpenCodeStore((s) => s.notify);
  const connected = !!status?.connected;

  const [roots, setRoots] = useState<Root[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [root, setRoot] = useState<string>("");
  const [inspect, setInspect] = useState<ProjectInfoView | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const current = status?.selections?.directory ?? "";

  const loadRoots = useCallback(async () => {
    try {
      const r = await fetch("/api/projects", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { roots: Root[]; current: string | null };
      setRoots(d.roots ?? []);
      if (!root && d.roots?.length) setRoot(d.roots[0].path);
    } catch {
      /* ignore */
    }
  }, [root]);

  const browse = useCallback(
    async (dir: string) => {
      setRoot(dir);
      try {
        const r = await fetch(`/api/projects?browse=${encodeURIComponent(dir)}`, { cache: "no-store" });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          notify(d?.error?.message || "Browse failed");
          return;
        }
        const d = (await r.json()) as { entries: Entry[] };
        setEntries(d.entries ?? []);
      } catch (e) {
        notify((e as Error).message);
      }
    },
    [notify]
  );

  const inspectDir = useCallback(
    async (dir: string) => {
      setBusy(true);
      try {
        const r = await fetch(`/api/projects?inspect=${encodeURIComponent(dir)}`, { cache: "no-store" });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          notify(d?.error?.message || "Inspect failed");
          return;
        }
        const d = (await r.json()) as { project: ProjectInfoView };
        setInspect(d.project);
      } finally {
        setBusy(false);
      }
    },
    [notify]
  );

  const select = async (dir: string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: dir }),
      });
      const d = await r.json();
      if (!r.ok) return notify(d?.error?.message || "Selection rejected");
      setInspect(d.project as ProjectInfoView);
      await refresh();
      notify(`Project → ${d.directory}`);
    } finally {
      setBusy(false);
    }
  };

  const createAndSelect = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ create: newName.trim() }),
      });
      const d = await r.json();
      if (!r.ok) return notify(d?.error?.message || "Create failed");
      setNewName("");
      setInspect(d.project as ProjectInfoView);
      await refresh();
      await loadRoots();
      notify(`Created ${d.directory}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadRoots();
  }, [loadRoots]);

  useEffect(() => {
    if (root) void browse(root);
    if (current) void inspectDir(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  return (
    <div className={`flex min-h-0 w-full flex-col bg-background text-foreground dark:bg-[#0f0f0f] ${embedded ? "" : "h-full"}`}>
      {!embedded && (
        <ScreenHeader
          title="Projects"
          subtitle={current ? current.split(/[\\/]/).pop() : "no project"}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={onToggleSidebar}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-[1200px] space-y-4">
          <div>
            <p className="text-[12.5px] text-muted-foreground">
              Nexuss only opens folders under its own root (or roots you explicitly allow in{" "}
              <span className="font-mono text-foreground">LAB_EXTRA_PROJECT_ROOTS</span>). Traversal and
              symlink escapes are rejected server-side.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card px-3.5 py-2.5 font-mono text-[12px]">
            <span className="text-muted-foreground/70">current project → </span>
            <span className={current ? "text-primary" : "text-destructive"}>
              {current || "none selected"}
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="rounded-lg border border-border bg-card p-4 lg:col-span-1">
              <h2 className="mb-3 font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
                Allowed roots
              </h2>
              <ul className="space-y-1">
                {roots.map((r) => (
                  <li key={r.path}>
                    <button
                      type="button"
                      onClick={() => void browse(r.path)}
                      className={`w-full cursor-pointer rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                        root === r.path
                          ? "border-primary/50 bg-primary/10"
                          : "border-border hover:bg-accent"
                      }`}
                    >
                      <div className="text-[12.5px]">{r.label}</div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground/70">
                        {r.path}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-4">
                <div className="label">Open an allowed path directly</div>
                <div className="flex gap-2">
                  <input
                    className="field py-1.5 font-mono text-[11px]"
                    placeholder="C:\...\nexuss-design-prototype\my-project"
                    value={pathInput}
                    onChange={(e) => setPathInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn shrink-0"
                    disabled={busy || !pathInput}
                    onClick={() => void select(pathInput)}
                  >
                    Select
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <div className="label">New scratch project (inside the Lab)</div>
                <div className="flex gap-2">
                  <input
                    className="field py-1.5 font-mono text-[11px]"
                    placeholder="hello-project"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void createAndSelect()}
                  />
                  <button
                    type="button"
                    className="btn btn-primary shrink-0"
                    disabled={busy || !newName}
                    onClick={() => void createAndSelect()}
                  >
                    Create
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
              <h2 className="mb-3 font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
                Sub-directories {root && <span className="text-muted-foreground/70">· {root}</span>}
              </h2>
              {entries.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground/70">No sub-directories.</p>
              ) : (
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {entries.map((e) => (
                    <li
                      key={e.path}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px]">
                          {e.name} {e.hasGit && <span className="chip ml-1">git</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          className="btn btn-ghost py-0.5"
                          onClick={() => void inspectDir(e.path)}
                        >
                          inspect
                        </button>
                        <button
                          type="button"
                          className="btn py-0.5"
                          disabled={busy}
                          onClick={() => void select(e.path)}
                        >
                          use
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {inspect && (
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-all font-mono text-[13px] text-foreground">{inspect.path}</h2>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className="chip">{inspect.fileCount} files</span>
                    <span className="chip">
                      {inspect.git ? `git · ${inspect.branch ?? "detached"}` : "no git"}
                    </span>
                    <span className="chip">{inspect.files.length} entries listed</span>
                    <span className="chip">
                      {inspect.changes.length + inspect.fileChanges.length} changes
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void select(inspect.path)}
                >
                  Use this project
                </button>
              </div>

              {inspect.warnings.length > 0 && (
                <div className="mb-3 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-700 dark:text-amber-200">
                  {inspect.warnings.join(" · ")}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="label">Files</div>
                  <ul className="max-h-[260px] space-y-0.5 overflow-y-auto">
                    {inspect.files.map((f) => (
                      <li key={f.name} className="flex items-center gap-2 font-mono text-[11px]">
                        <span className={f.type === "dir" ? "text-primary" : "text-muted-foreground/70"}>
                          {f.type === "dir" ? "▸" : "·"}
                        </span>
                        <span className="truncate text-muted-foreground">{f.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="label">Working tree changes (via OpenCode)</div>
                  {inspect.changes.length === 0 && inspect.fileChanges.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground/70">Clean — no changes reported.</p>
                  ) : (
                    <ul className="max-h-[260px] space-y-0.5 overflow-y-auto">
                      {[...inspect.changes, ...inspect.fileChanges].map((c, i) => {
                        const delta = c as { additions?: number; deletions?: number };
                        return (
                          <li key={i} className="flex items-center gap-2 font-mono text-[11px]">
                            <span className="text-primary">{String(c.status)[0]?.toUpperCase()}</span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.path}</span>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              +{delta.additions ?? 0}
                            </span>
                            <span className="text-destructive">−{delta.deletions ?? 0}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          )}

          {!connected && (
            <p className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-200">
              Not connected to OpenCode — file/VCS inspection requires a live server.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
