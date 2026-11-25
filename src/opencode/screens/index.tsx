"use client";

import type { MainView } from "@/store/viewStore";
import WorkspaceScreen from "./WorkspaceScreen";
import ProjectsScreen from "./ProjectsScreen";
import MonitorScreen from "./MonitorScreen";
import DiagnosticsScreen from "./DiagnosticsScreen";
import SettingsScreen from "./SettingsScreen";
import ScreenHeader from "../components/ScreenHeader";

interface OpenCodeScreenProps {
  view: Exclude<MainView, "chat">;
  settingsTab?: import("@/store/viewStore").SettingsTab;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

/**
 * Dispatcher for the migrated Nexuss Lab surfaces. The Nexuss chat remains the
 * default main view; the sidebar "Agents" section switches between these.
 */
export default function OpenCodeScreen({ view, sidebarOpen, onToggleSidebar, settingsTab = "account" }: OpenCodeScreenProps) {
  const props = { sidebarOpen, onToggleSidebar };
  switch (view) {
    case "agent-workspace":
      return <WorkspaceScreen {...props} />;
    case "projects":
      return <BlankAgentScreen title="Projects" {...props} />;
    case "plugins":
      return <BlankAgentScreen title="Plugins" {...props} />;
    case "monitor":
      return <MonitorScreen {...props} />;
    case "diagnostics":
      return <DiagnosticsScreen {...props} />;
    case "settings":
      return <SettingsScreen {...props} initialTab={settingsTab} />;
    default:
      return <WorkspaceScreen {...props} />;
  }
}

/**
 * Blank agent pages still live inside the shared shell. The header is part of
 * that shell and keeps the sidebar toggle available without adding page
 * content to these intentionally blank surfaces.
 */
function BlankAgentScreen({
  title,
  sidebarOpen,
  onToggleSidebar,
}: {
  title: string;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background" aria-label={title}>
      <div className="shrink-0">
        <ScreenHeader title={title} sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} />
      </div>
      <div className="min-h-0 flex-1" />
    </div>
  );
}
