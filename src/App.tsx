import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import ChatPage from "@/components/ChatPage";
import { useChatStore, useAuthStore, useLocalModelStore } from "@/store";
import { useViewStore } from "@/store/viewStore";
import { useOpenCodeStore, initOpenCode } from "@/opencode/store";
import { initInstallTracker } from "@/opencode/install/store";
import OpenCodeScreen from "@/opencode/screens";
import InstallTracker from "@/opencode/install/InstallTracker";
import { InstallPill } from "@/opencode/install/InstallTracker";
import { NexussLogo } from "@/components/admin/NexussLogo";

/**
 * Nexuss internal application shell (prototype).
 * Starts directly inside the authenticated app — see README for scope notes.
 * The OpenCode agent surfaces (migrated Nexuss Lab) are reachable from the
 * sidebar and render inside this same shell.
 */
function MainApp() {
  const user = useAuthStore((s) => s.user);
  const hydrate = useChatStore((s) => s.hydrate);
  const view = useViewStore((s) => s.view);
  const settingsTab = useViewStore((s) => s.settingsTab);
  const toast = useOpenCodeStore((s) => s.toast);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ready, setReady] = useState(false);

  // Default the sidebar to open on desktop, closed on tablet/mobile.
  useEffect(() => {
    setSidebarOpen(window.innerWidth >= 1024);
  }, []);

  useEffect(() => {
    void hydrate().then(() => setReady(true));
    void useLocalModelStore.getState().hydrate();
    initOpenCode();
    initInstallTracker();
  }, [hydrate]);

  if (!user) return <SignedOutScreen />;

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  return (
    <div className="flex h-screen supports-[height:100dvh]:h-dvh overflow-hidden bg-background text-foreground">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {ready ? (
        view === "chat" ? (
          <ChatPage sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
        ) : (
          <OpenCodeScreen
            view={view}
            settingsTab={settingsTab}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
          />
        )
      ) : (
        <div className="flex h-full flex-1 items-center justify-center bg-background">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      )}

      {/* OpenCode toast channel (connection + permission + execution notices) */}
      {toast && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 animate-fade-in-up">
          <div className="rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-medium text-foreground shadow-2xl">
            {toast}
          </div>
        </div>
      )}

      {/* OpenCode installation tracker (modal + floating pill) */}
      <InstallTracker />
      <InstallPill />
    </div>
  );
}

function SignedOutScreen() {
  const setUser = useAuthStore((s) => s.setUser);
  return (
    <div className="flex h-screen supports-[height:100dvh]:h-dvh items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl">
        <NexussLogo size={40} color="currentColor" className="mx-auto text-foreground" />
        <h1 className="mt-4 text-sm font-semibold">You&apos;ve been signed out</h1>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          This prototype has no sign-in screen — jump straight back into the workspace to keep
          reviewing the interface.
        </p>
        <button
          type="button"
          onClick={() =>
            setUser({ uid: "mock-uid-001", email: "arjun@nexuss.in", displayName: "Arjun Mehta" })
          }
          className="mt-4 w-full cursor-pointer rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Sign back in
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return <MainApp />;
}
