"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOpenCodeStore } from "../store";
import type { ChatItem, ExecutionView, ResultsView, SessionRow } from "../types";
import { Markdown } from "../components/Markdown";
import { PermissionCard } from "../components/PermissionCard";
import { ModelSelector } from "../components/ModelSelector";
import { ThinkingIndicator } from "../components/ThinkingIndicator";
import { ResultsCard, FileList } from "../components/ResultsCard";
import ScreenHeader from "../components/ScreenHeader";
import { useViewStore } from "@/store/viewStore";
import { XIcon, PlusIcon, TrashIcon } from "@/components/icons";
import {
  applyTurnFrame,
  createTurnStream,
  turnView,
  type TurnStream,
  type TurnView,
} from "../chat-stream";

interface WorkspaceScreenProps {
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TERMINAL_PHASES = ["completed", "failed", "interrupted"] as const;

/**
 * Agent Workspace — migrated from Nexuss Lab `/workspace`.
 * Real OpenCode sessions, agent/model selection, prompt execution, live SSE
 * streaming, permission cards and verified results, rendered in the Nexuss
 * design system.
 */
export default function WorkspaceScreen({ sidebarOpen, onToggleSidebar }: WorkspaceScreenProps) {
  const status = useOpenCodeStore((s) => s.status);
  const refresh = useOpenCodeStore((s) => s.refresh);
  const permissions = useOpenCodeStore((s) => s.permissions);
  const events = useOpenCodeStore((s) => s.events);
  const notify = useOpenCodeStore((s) => s.notify);
  const clearEvents = useOpenCodeStore((s) => s.clearEvents);
  const setView = useViewStore((s) => s.setView);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [sessionID, setSessionID] = useState<string>("");
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [stream, setStream] = useState<TurnView | null>(null);
  const [tools, setTools] = useState<TurnView["tools"]>([]);
  const [running, setRunning] = useState(false);
  const [exec, setExec] = useState<ExecutionView | null>(null);
  const [results, setResults] = useState<ResultsView | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionDetail, setSessionDetail] = useState<{
    agent?: string;
    model?: string;
    updatedAt?: number;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSeqRef = useRef(0);
  /** Live turn reducer for the in-flight assistant response (never user text). */
  const turnRef = useRef<TurnStream | null>(null);
  const execRef = useRef<ExecutionView | null>(null);
  const execIdRef = useRef<string | null>(null);
  const sessionRef = useRef<string>("");
  /** Incremented on every send/interrupt so stale watchers can never touch state. */
  const epochRef = useRef(0);

  const connected = Boolean(status?.connected);
  const directory = status?.selections?.directory ?? "";
  const agent = status?.selections?.agent ?? "build";
  const model = status?.selections?.model ?? "";

  // ---- session list -------------------------------------------------------
  const loadSessions = useCallback(async (): Promise<SessionRow[]> => {
    const q = showAllSessions ? "?all=1" : directory ? `?directory=${encodeURIComponent(directory)}` : "";
    try {
      const r = await fetch(`/api/sessions${q}`, { cache: "no-store" });
      if (!r.ok) return [];
      const d = (await r.json()) as { sessions: SessionRow[] };
      return d.sessions ?? [];
    } catch {
      return [];
    }
  }, [directory, showAllSessions]);

  const reloadSessionList = useCallback(async () => {
    setSessions(await loadSessions());
  }, [loadSessions]);

  const loadMessages = useCallback(async (id: string): Promise<ChatItem[] | null> => {
    if (!id) return null;
    try {
      const r = await fetch(`/api/sessions/${id}?history=1`, { cache: "no-store" });
      if (!r.ok) return null;
      const d = (await r.json()) as {
        messages: ChatItem[];
        session: { agent?: string; model?: string; updatedAt?: number };
      };
      setMessages(d.messages ?? []);
      setSessionDetail(d.session ?? null);
      return d.messages ?? [];
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void reloadSessionList();
  }, [reloadSessionList]);

  useEffect(() => {
    const initial = status?.selections?.sessionID;
    if (initial && !sessionID) {
      setSessionID(initial);
      sessionRef.current = initial;
      void loadMessages(initial);
    }
  }, [status?.selections?.sessionID, sessionID, loadMessages]);

  useEffect(() => {
    sessionRef.current = sessionID;
  }, [sessionID]);

  // ---- derived: session permissions --------------------------------------
  const sessionPermissions = useMemo(
    () => permissions.filter((p) => !sessionID || p.sessionID === sessionID),
    [permissions, sessionID]
  );

  const missingReply = (list: ChatItem[] | null) =>
    !list?.some((m) => m.kind === "assistant" && (m.text ?? "").trim());

  /**
   * End the in-flight turn exactly once: keep the live bubble visible until
   * history confirms the answer, then transition smoothly to persisted history.
   */
  const finalizeTurn = useCallback(
    async (phase: string, epoch: number) => {
      if (epoch !== epochRef.current) return;
      epochRef.current += 1; // idle frame, watcher and Stop can all race here
      setRunning(false);
      turnRef.current = null;

      const id = sessionRef.current;
      if (!id) return;
      const finalText = execRef.current?.finalText ?? "";

      let msgs = await loadMessages(id);
      // OpenCode can publish `session.idle` a beat before its transcript is
      // readable - retry once rather than leaving the reply missing.
      if (phase !== "failed" && missingReply(msgs)) {
        await sleep(600);
        msgs = (await loadMessages(id)) ?? msgs;
      }
      // Now that history is confirmed to have the answer (or we have a fallback),
      // clear the live stream - the history bubble will render in its place.
      setStream(null);
      // Absolute fallback: the execution record already holds the final answer.
      if (phase !== "failed" && missingReply(msgs) && finalText) {
        const execId = execRef.current?.id ?? `final-${Date.now()}`;
        setMessages((m) => [
          ...m,
          { kind: "assistant", id: execId, messageID: execId, text: finalText, at: Date.now() },
        ]);
      }
      void refresh();
    },
    [loadMessages, refresh]
  );

  // ---- live event handling ------------------------------------------------
  useEffect(() => {
    if (!events.length) return;
    // SSE frames can arrive faster than React renders, so consume EVERY frame
    // since the last one we handled - otherwise token deltas are dropped and the
    // reply appears to stall and then jump.
    const fresh = events.filter((e) => e.seq > lastSeqRef.current);
    if (!fresh.length) return;
    lastSeqRef.current = events[events.length - 1].seq;

    for (const frame of fresh) {
      const p = frame.properties as Record<string, unknown>;
      const forThis = !sessionID || p.sessionID === sessionID || frame.type === "file.edited";

      if (frame.type === "permission.asked" || frame.type === "permission.v2.asked") {
        notify("Permission requested — review it in the chat pane.");
        continue;
      }

      if (frame.type === "session.error" && forThis) {
        // Not terminal by itself (OpenCode retries steps) - surface it and let
        // the idle frame or the execution watchdog settle the turn.
        notify(`Agent error: ${JSON.stringify(p.error ?? "unknown").slice(0, 200)}`);
        continue;
      }

      if (!forThis) continue;

      const turn = turnRef.current;
      if (turn) {
        applyTurnFrame(turn, frame);
        const view = turnView(turn);
        setStream(view);
        if (view.tools.length) setTools(view.tools);
      }

      if (frame.type === "session.idle" && turn && execIdRef.current) {
        void finalizeTurn("completed", epochRef.current);
      }
    }
  }, [events, sessionID, finalizeTurn, notify]);

  // ---- auto scroll --------------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, stream, tools, permissions]);

  // ---- actions ------------------------------------------------------------
  /** Drop every trace of the previous turn (used when switching/creating sessions). */
  const resetTurnState = useCallback(() => {
    epochRef.current += 1;
    turnRef.current = null;
    execRef.current = null;
    execIdRef.current = null;
    setRunning(false);
    setStream(null);
    setTools([]);
    setExec(null);
    setResults(null);
  }, []);

  const createSession = async () => {
    if (!connected) return notify("Connect to OpenCode first.");
    if (!directory) return notify("Select a project directory first.");
    setBusy(true);
    try {
      const r = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory, agent, model: model || undefined, title: "" }),
      });
      const d = await r.json();
      if (!r.ok) return notify(d?.error?.message || "Failed to create session");
      const s = d.session as { id: string; title: string };
      setSessionID(s.id);
      sessionRef.current = s.id;
      setMessages([]);
      resetTurnState();
      await reloadSessionList();
      await refresh();
      notify(`Session ${s.id.slice(0, 14)}… created`);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    if (!sessionID) return notify("Create or select a session first.");
    if (running) return notify("A task is already running — interrupt it first.");

    setInput("");
    setSending(true);
    setRunning(true);
    setResults(null);
    setExec(null);
    setTools([]);
    execRef.current = null;
    execIdRef.current = null;
    const epoch = ++epochRef.current;
    // The reducer is primed with our prompt text so OpenCode's own announcement
    // of the user's part can never be mistaken for the assistant's reply.
    const turn = createTurnStream({ sessionID, pendingUserText: text });
    turnRef.current = turn;
    setStream(turnView(turn));
    setMessages((m) => [
      ...m,
      {
        kind: "user",
        id: `local-${Date.now()}`,
        messageID: `local-${Date.now()}`,
        text,
        at: Date.now(),
      },
    ]);

    try {
      const r = await fetch(`/api/sessions/${sessionID}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, agent, model: model || undefined, directory, async: true }),
      });
      const d = await r.json();
      if (!r.ok) {
        epochRef.current += 1;
        turnRef.current = null;
        setRunning(false);
        setStream(null);
        notify(d?.error?.message || "Failed to submit prompt");
        setMessages((m) => [
          ...m,
          {
            kind: "error",
            id: `err-${Date.now()}`,
            messageID: "",
            error: d?.error?.message || `HTTP ${r.status}`,
            at: Date.now(),
          },
        ]);
        return;
      }
      if (epoch !== epochRef.current) return; // superseded while in flight
      const rec = d.execution as ExecutionView;
      execRef.current = rec;
      execIdRef.current = rec.id;
      setExec(rec);
      if (d.results) setResults(d.results as ResultsView);
      if (TERMINAL_PHASES.includes(rec.phase as "completed" | "failed" | "interrupted")) {
        await finalizeTurn(rec.phase, epoch);
      }
      // No polling watchdog: session.idle event (via store + event hub)
      // triggers finalizeTurn immediately via the events effect.
      void reloadSessionList();
    } catch (e) {
      epochRef.current += 1;
      turnRef.current = null;
      setRunning(false);
      setStream(null);
      notify((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const interrupt = async () => {
    if (!sessionID) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/sessions/${sessionID}/prompt`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) return notify(d?.error?.message || "Interrupt failed");
      notify("Execution interrupted");
      // Clears the live bubble, stops the watcher and reloads whatever the
      // interrupted turn actually produced - no stale or delayed response.
      await finalizeTurn("interrupted", epochRef.current);
    } finally {
      setBusy(false);
    }
  };

  const selectAgent = async (name: string) => {
    if (sessionID) {
      const r = await fetch(`/api/sessions/${sessionID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: name }),
      }).catch(() => null);
      if (r && !r.ok) {
        const d = await r.json().catch(() => ({}));
        notify(d?.error?.message || "Failed to switch agent");
        return;
      }
      setSessionDetail((s) => ({ ...(s ?? {}), agent: name }));
    }
    await refresh();
    notify(`Agent → ${name}`);
  };

  const selectModel = async (v: string) => {
    if (sessionID && v) {
      await fetch(`/api/sessions/${sessionID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: v }),
      }).catch(() => {});
    }
    await refresh();
  };

  const removeSession = async (id: string) => {
    if (!confirm(`Delete session ${id}? This removes it from OpenCode.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        return notify(d?.error?.message || "Delete failed");
      }
      if (sessionID === id) {
        setSessionID("");
        sessionRef.current = "";
        setMessages([]);
        resetTurnState();
      }
      await reloadSessionList();
      notify("Session deleted");
    } finally {
      setBusy(false);
    }
  };

  const selectSession = (id: string) => {
    setSessionID(id);
    sessionRef.current = id;
    setMessages([]);
    resetTurnState();
    void loadMessages(id);
  };

  const modelLabel = model ? model.split("/").pop() : "default";

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground dark:bg-[#0f0f0f]">
      <ScreenHeader
        title="Agent workspace"
        subtitle={sessionID || "no session"}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
        actions={
          <>
            <button className="btn btn-ghost" onClick={clearEvents}>
              clear events
            </button>
            <button className="btn btn-danger" disabled={!running || busy} onClick={() => void interrupt()}>
              ■ Stop
            </button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        {/* ---------------- LEFT SIDEBAR ---------------- */}
        <aside className="hidden w-[268px] shrink-0 flex-col border-r border-border bg-card md:flex">
          <div className="border-b border-border p-3">
            <button
              className="btn btn-primary w-full"
              onClick={() => void createSession()}
              disabled={busy || !connected}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              New session
            </button>
          </div>

          <div className="space-y-3 border-b border-border p-3">
            <div>
              <div className="label">Project</div>
              <div
                className="truncate rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-muted-foreground"
                title={directory}
              >
                {directory || "no project selected"}
              </div>
              {!directory && (
                <button
                  type="button"
                  className="mt-1.5 cursor-pointer text-[11px] text-primary hover:underline"
                  onClick={() => setView("projects")}
                >
                  Choose a project →
                </button>
              )}
            </div>
            <div>
              <div className="label">Agent</div>
              <div className="flex flex-wrap gap-1">
                {(status?.agents ?? [])
                  .filter((a) => !a.hidden)
                  .map((a) => (
                    <button
                      key={a.name}
                      onClick={() => void selectAgent(a.name)}
                      className={`chip cursor-pointer transition-colors ${
                        a.name === agent
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "hover:text-foreground"
                      }`}
                      title={a.description}
                    >
                      {a.name}
                    </button>
                  ))}
              </div>
            </div>
            <div>
              <div className="label">Model</div>
              <ModelSelector
                selectedModel={model}
                onSelect={(v) => void selectModel(v)}
                onConnectProvider={() => setView("diagnostics")}
                disabled={!connected}
              />
            </div>
            <div className="flex items-center justify-between pt-0.5">
              <span className="font-mono text-[10px] text-muted-foreground/70">
                {connected ? "● connected" : "○ offline"}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground/70">
                {status?.events?.eventsReceived ?? 0} evt
              </span>
            </div>
          </div>

        </aside>

        {/* ---------------- CENTER ---------------- */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-card px-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-[12px] text-foreground">
                {sessionID || "no session"}
              </span>
              {sessionDetail?.agent && <span className="chip">{sessionDetail.agent}</span>}
              {modelLabel && <span className="chip">{modelLabel}</span>}
              {running && (
                <span className="chip border-amber-600/50 text-amber-600 dark:text-amber-300">
                  <span className="pulse h-1.5 w-1.5 rounded-full bg-amber-500" />
                  running
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost md:hidden" onClick={clearEvents}>
                clear
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {!sessionID && (
              <div className="mx-auto mt-16 max-w-md text-center">
                <div className="mb-3 font-mono text-3xl text-primary">❯</div>
                <h2 className="font-mono text-sm text-foreground">No active session</h2>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
                  Select a project, then press <span className="font-mono text-primary">New session</span>.
                  Nexuss creates a real OpenCode session bound to that directory.
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  {!connected && (
                    <button className="btn btn-primary" onClick={() => setView("diagnostics")}>
                      Go to Diagnostics
                    </button>
                  )}
                  {connected && (
                    <button className="btn" onClick={() => setView("projects")}>
                      Choose a project
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="mx-auto max-w-[860px] space-y-3">
              {messages.map((m) => (
                <Bubble key={m.id + m.at} item={m} />
              ))}

              {/* ChatGPT-style thinking indicator: only while the agent is working
                  and has not produced any visible answer text yet. */}
              {running && !stream?.text && <ThinkingIndicator />}

              {/* live assistant response streaming into the normal chat */}
              {stream?.text && (
                <div className="slide-up rounded-lg border border-border bg-muted/40 p-3.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-primary">
                      agent
                    </span>
                    <span className="pulse h-1.5 w-1.5 rounded-full bg-primary" />
                  </div>
                  <Markdown content={stream.text} />
                </div>
              )}

              {/* tool executions observed live */}
              {tools.length > 0 && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                    tool execution ({tools.length})
                  </div>
                  <ul className="space-y-1">
                    {tools.map((t) => (
                      <li key={t.key} className="flex items-start gap-2 text-[12px]">
                        <span
                          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                            t.state === "completed"
                              ? "bg-emerald-500"
                              : t.state === "error"
                                ? "bg-destructive"
                                : "pulse bg-primary"
                          }`}
                        />
                        <span className="font-mono text-blue-600 dark:text-blue-400">{t.tool}</span>
                        <span className="font-mono text-muted-foreground/70">{t.state}</span>
                        {typeof (t.input as { command?: string })?.command === "string" && (
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                            {(t.input as { command: string }).command}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {sessionPermissions.map((p) => (
                <PermissionCard key={p.id} permission={p} />
              ))}

              {exec && (exec.phase === "failed" || exec.error) && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-[12.5px] text-destructive">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-widest">
                    execution failed
                  </div>
                  {exec.error}
                </div>
              )}

              {exec && exec.phase === "interrupted" && (
                <div className="rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 text-[12.5px] text-amber-700 dark:text-amber-300">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-widest">interrupted</div>
                  Execution stopped by user. Any partial output was preserved in the conversation.
                </div>
              )}

              {results && <ResultsCard results={results} />}
            </div>
          </div>

          {/* ---------------- INPUT ---------------- */}
          <div className="shrink-0 border-t border-border bg-card p-3">
            <div className="mx-auto max-w-[860px]">
              <div className="rounded-xl border border-border bg-background p-2 transition-colors focus-within:border-ring">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={2}
                  placeholder={
                    connected
                      ? "Describe a task for the OpenCode agent… (Enter to send, Shift+Enter for newline)"
                      : "Connect to OpenCode to send tasks…"
                  }
                  className="w-full resize-none bg-transparent px-1.5 py-1 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground/70"
                  disabled={!connected}
                />
                <div className="mt-1 flex items-center justify-between gap-2 px-1">
                  <div className="flex min-w-0 items-center gap-2 truncate font-mono text-[10px] text-muted-foreground/70">
                    <span className="text-primary">{agent}</span>
                    <span>·</span>
                    <span className="text-blue-600 dark:text-blue-400">{modelLabel}</span>
                    <span>·</span>
                    <span className="truncate">
                      {directory ? directory.split(/[\\/]/).slice(-2).join("\\") : "no project"}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      className="btn btn-danger"
                      disabled={!running || busy}
                      onClick={() => void interrupt()}
                    >
                      ■ Stop
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={!input.trim() || running || sending}
                      onClick={() => void send()}
                    >
                      {sending ? "Submitting…" : "Send ▸"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- RIGHT PANEL ---------------- */}
        <aside className="hidden w-[300px] shrink-0 flex-col border-l border-border bg-card xl:flex">
          <div className="border-b border-border p-3">
            <div className="label">Current project</div>
            <div className="break-all font-mono text-[11px] text-foreground">{directory || "—"}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border border-border bg-background px-2 py-1">
                <div className="text-muted-foreground/70">agent</div>
                <div className="font-mono">{agent}</div>
              </div>
              <div className="rounded-lg border border-border bg-background px-2 py-1">
                <div className="text-muted-foreground/70">model</div>
                <div className="truncate font-mono">{modelLabel}</div>
              </div>
            </div>
          </div>

          <div className="border-b border-border p-3">
            <div className="label">Session details</div>
            {sessionID ? (
              <dl className="space-y-1 font-mono text-[11px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground/70">id</dt>
                  <dd className="truncate">{sessionID}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground/70">messages</dt>
                  <dd>{messages.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground/70">tools</dt>
                  <dd>{tools.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground/70">phase</dt>
                  <dd>{exec?.phase ?? "idle"}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-[11.5px] text-muted-foreground/70">None</p>
            )}
          </div>

          <div className="border-b border-border p-3">
            <div className="label">Changed files</div>
            {results ? (
              <FileList results={results} />
            ) : (
              <p className="text-[11.5px] text-muted-foreground/70">
                Run a task to see file changes verified on disk.
              </p>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="label">Execution activity</div>
            {!exec && events.length === 0 && (
              <p className="text-[11.5px] text-muted-foreground/70">No activity yet.</p>
            )}
            <ul className="space-y-1">
              {(exec?.events ?? [])
                .slice(-40)
                .reverse()
                .map((e, i) => (
                  <li key={i} className="flex gap-2 font-mono text-[10.5px]">
                    <span className="text-muted-foreground/70">
                      {new Date(e.at).toLocaleTimeString()}
                    </span>
                    <span className="text-primary">{e.type}</span>
                    <span className="truncate text-muted-foreground">{e.summary}</span>
                  </li>
                ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Bubble({ item }: { item: ChatItem }) {
  if (item.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-xl border border-border bg-accent px-3.5 py-2.5">
          <div className="mb-1 font-mono text-[9.5px] uppercase tracking-widest text-muted-foreground/70">
            you
          </div>
          <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{item.text}</div>
        </div>
      </div>
    );
  }

  if (item.kind === "error") {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5">
        <div className="mb-1 font-mono text-[9.5px] uppercase tracking-widest text-destructive">
          error
        </div>
        <div className="font-mono text-[12px] text-destructive">{item.error}</div>
      </div>
    );
  }

  if (item.kind === "tool") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 font-mono text-[11.5px]">
        <span className="text-blue-600 dark:text-blue-400">{item.tool}</span>
        <span className="text-muted-foreground/70">{item.toolState}</span>
      </div>
    );
  }

  if (item.kind === "step") return null;

  // Hidden model reasoning is deliberately never rendered - the chat shows only
  // the user's prompt and the assistant's actual answer (ChatGPT-style).
  if (item.kind === "reasoning") return null;

  if (item.kind === "assistant") {
    return (
      <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5">
        <div className="mb-1 font-mono text-[9.5px] uppercase tracking-widest text-primary">agent</div>
        <Markdown content={item.text ?? ""} />
      </div>
    );
  }

  return null;
}
