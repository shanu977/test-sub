import { create } from "zustand";

/**
 * Main-area view switcher: the Nexuss chat stays the default screen, with the
 * migrated OpenCode surfaces (agent workspace, projects, monitor, diagnostics)
 * reachable from the sidebar.
 */
export type SettingsTab = "general" | "account" | "usage" | "agents" | "path" | "diagnostics";
export type MainView = "chat" | "agent-workspace" | "projects" | "plugins" | "monitor" | "diagnostics" | "settings";

interface ViewState {
  view: MainView;
  setView: (view: MainView) => void;
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  view: "chat",
  setView: (view) => set({ view }),
  settingsTab: "account",
  setSettingsTab: (settingsTab) => set({ settingsTab }),
}));
