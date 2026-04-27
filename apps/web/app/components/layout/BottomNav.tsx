import { Home, MessageCircle, Map, Swords, User } from "lucide-react";
import { NavLink } from "react-router";
import { cn } from "~/lib/utils";

// 5 items per CONTEXT patterns_handoff item 1 (Chat preserved). UI-SPEC § App Shell
// listed 4 labels as a high-level note; preserving Chat keeps Phase 02 + 03 nav intact.
const NAV_ITEMS = [
  { to: "/", label: "Home", icon: Home },
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/roadmaps", label: "Roadmaps", icon: Map },
  { to: "/battle", label: "Battle", icon: Swords },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t border-[hsl(var(--border))] bg-[var(--bg-frosted)] backdrop-blur-md pb-[env(safe-area-inset-bottom)] supports-[not_(backdrop-filter:blur(16px))]:bg-card lg:hidden"
      aria-label="Main navigation"
    >
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            cn(
              "relative flex min-h-12 min-w-12 flex-col items-center justify-center gap-1 px-3 text-xs font-medium transition-colors duration-[var(--duration-fast)] active:scale-[0.97] motion-reduce:active:scale-100",
              isActive ? "text-[hsl(var(--dominant))]" : "text-[hsl(var(--fg-muted))]",
              isActive &&
                "after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-8 after:-translate-x-1/2 after:rounded-full after:bg-[hsl(var(--dominant))]"
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
              {isActive && <span className="sr-only">(current page)</span>}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
