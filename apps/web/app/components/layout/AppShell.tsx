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
    //
    // min-h-dvh instead of min-h-screen: dvh tracks the actual dynamic
    // viewport (shrinks when the mobile URL bar is visible), preventing the
    // 100vh trap where min-height exceeds the visible area on iOS/Android.
    // h-dvh + overflow-y-auto: the document is locked (html/body overflow:hidden
    // in app.css), so an immersive route taller than the viewport scrolls HERE,
    // not on the document. Full-viewport battle screens fit and won't scroll.
    return (
      <div className="h-dvh overflow-y-auto bg-background">
        {children}
      </div>
    );
  }

  return (
    // h-dvh locks the shell to exactly the dynamic viewport height on all
    // breakpoints — including mobile. overflow-hidden on the outer container
    // prevents the document/body from ever growing a scrollbar. The single
    // scroll container is <main> (overflow-y-auto below), so the body stays
    // pinned and only the content area scrolls. This eliminates the mobile
    // over-scroll bug where the body was the scroll target because main lacked
    // overflow-y-auto at the <lg breakpoint.
    //
    // h-dvh (not h-screen) on mobile: dvh tracks the actual dynamic viewport
    // (shrinks when the mobile URL bar slides in), so the shell is always
    // exactly as tall as the visible area — no invisible blank space below.
    // lg:h-screen is fine on desktop (no dynamic URL bar).
    <div className="flex h-dvh overflow-hidden bg-background lg:h-screen">
      <SidebarNav />
      <div className="flex flex-1 flex-col min-h-0">
        {/*
          Mobile-only top status bar (UI-SPEC § App Shell — 56px frosted sticky):
          MIMIR wordmark left + ThemeToggle right.
          On lg+ the SidebarNav owns the wordmark + ThemeToggle (in the user block),
          so this header collapses entirely (PATTERNS.md AppShell template lines 597-657).

          NOTE: The header is sticky top-0 here but it is NOT inside main — it is a
          sibling of main inside the flex column. This means route-level sticky elements
          inside main use sticky top-0 (relative to main's scroll container), not top-14.
          See the lesson reader header for the corrected value.
        */}
        <header
          className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-[hsl(var(--border))] bg-[var(--bg-frosted)] px-4 backdrop-blur-md supports-[not_(backdrop-filter:blur(16px))]:bg-card lg:hidden"
          aria-label="Top status bar"
        >
          <span className="font-display text-lg tracking-tight text-foreground">MIMIR</span>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>
        {/*
          main is the sole scroll container on ALL breakpoints (not just lg+).
          - min-h-0: required for a flex-column child to shrink below its content
            size and scroll. Without it, the default min-height:auto lets main grow
            to fit all content, so the flex parent expands rather than main scrolling.
          - overflow-y-auto: enables internal scrolling at every breakpoint. Promoted
            from lg:overflow-y-auto — the mobile-only gap was the root cause of the
            body scrolling bug.
          - The inner sizing div uses min-h-full + flex flex-col so that routes that
            need to fill the full available height (e.g. chat's ScrollArea) can use
            flex-1 on their root element. Routes that exceed min-h-full simply overflow
            into main's scroll area normally.
        */}
        <main className="flex-1 min-h-0 overflow-y-auto pb-20 lg:pb-4">
          <div className="mx-auto w-full max-w-[640px] px-4 pt-4 lg:max-w-[960px] min-h-full flex flex-col">
            {children}
          </div>
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
