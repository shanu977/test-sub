"use client";

import { useViewStore, type MainView } from "@/store/viewStore";
import { useOpenCodeStore } from "@/opencode/store";
import { BotIcon, FolderIcon } from "@/components/icons";

interface OpenCodeNavProps {
  /** Called after a nav item is picked (used to close the mobile drawer). */
  onNavigate?: () => void;
}

const ITEMS: Array<{ view: MainView; label: string; Icon: typeof BotIcon }> = [
  { view: "agent-workspace", label: "Workspace", Icon: BotIcon },
  { view: "projects", label: "Projects", Icon: FolderIcon },
  { view: "plugins", label: "Plugins", Icon: BotIcon },
];

/**
 * Sidebar section for the migrated OpenCode surfaces. Shows live connection
 * state so the agent tooling reads as part of the Nexuss shell.
 */
export default function OpenCodeNav({ onNavigate }: OpenCodeNavProps) {
  const view = useViewStore((s) => s.view);
  const setView = useViewStore((s) => s.setView);
  const connected = useOpenCodeStore((s) => s.status?.connected ?? false);

  return (
    <div className="shrink-0 px-3 pt-3">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Agents
        </span>
        <span
          className="flex items-center gap-1 font-mono text-[9px] text-muted-foreground"
          title={connected ? "Connected to OpenCode" : "OpenCode offline"}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connected ? "bg-emerald-500" : "bg-muted-foreground/40"
            }`}
          />
          {connected ? "online" : "offline"}
        </span>
      </div>
      <nav className="space-y-0.5" aria-label="OpenCode navigation">
        {ITEMS.map(({ view: v, label, Icon }) => {
          const active = view === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => {
                setView(v);
                onNavigate?.();
              }}
              className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
