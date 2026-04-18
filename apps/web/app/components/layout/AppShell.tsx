import { BottomNav } from "./BottomNav";
import { SidebarNav } from "./SidebarNav";
import { ThemeToggle } from "./ThemeToggle";

interface AppShellProps {
  children: React.ReactNode;
  /**
   * When true, hides BottomNav + SidebarNav + headers and removes the
   * max-width content frame — used for immersive full-viewport routes
   * (`/battle/pre/*`, `/battle/room/*`) per Phase 4 UI-SPEC §Screens in
   * Scope "Bottom nav / sidebar nav are hidden on /battle/pre/* and
   * /battle/room/* to remove exit friction during the signature
   * animations and the live battle."
   */
  immersive?: boolean;
}

export function AppShell({ children, immersive = false }: AppShellProps) {
  if (immersive) {
    // No nav, no header, no content frame — the route renders its own
    // full-viewport layout. Keeps the reveal animations and the live
    // battle free from navigation exit-friction.
    return (
      <div className="min-h-screen bg-background">
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <SidebarNav />
      <div className="flex flex-1 flex-col">
        {/* Mobile header */}
        <header className="flex items-center justify-end border-b border-border p-4 lg:hidden">
          <ThemeToggle />
        </header>
        {/* Desktop header */}
        <header className="hidden items-center justify-end border-b border-border p-4 lg:flex">
          <ThemeToggle />
        </header>
        <main className="flex-1 pb-20 lg:pb-4">
          <div className="mx-auto w-full max-w-[640px] px-4 pt-4">
            {children}
          </div>
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
