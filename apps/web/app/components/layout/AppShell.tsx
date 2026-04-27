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
        {/*
          Mobile-only top status bar (UI-SPEC § App Shell — 56px frosted sticky):
          MIMIR wordmark left + ThemeToggle right.
          On lg+ the SidebarNav owns the wordmark + ThemeToggle (in the user block),
          so this header collapses entirely (PATTERNS.md AppShell template lines 597-657).
        */}
        <header
          className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-[hsl(var(--border))] bg-[var(--bg-frosted)] px-4 backdrop-blur-md supports-[not_(backdrop-filter:blur(16px))]:bg-card lg:hidden"
          aria-label="Top status bar"
        >
          <span className="font-display text-lg tracking-tight text-foreground">MIMIR</span>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 pb-20 lg:pb-4">
          <div className="mx-auto w-full max-w-[640px] px-4 pt-4 lg:max-w-[960px]">
            {children}
          </div>
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
