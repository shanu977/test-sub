"use client";

import SettingsContent from "@/components/SettingsContent";
import type { SettingsTab } from "@/store/viewStore";
import ScreenHeader from "../components/ScreenHeader";

interface SettingsScreenProps {
  initialTab: SettingsTab;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export default function SettingsScreen({ initialTab, sidebarOpen, onToggleSidebar }: SettingsScreenProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
      <ScreenHeader title="Settings" sidebarOpen={sidebarOpen} onToggleSidebar={onToggleSidebar} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div className="mx-auto w-full max-w-[1200px]">
          <SettingsContent initialTab={initialTab} />
        </div>
      </div>
    </div>
  );
}
