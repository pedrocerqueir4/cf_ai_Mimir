import { Home, MessageCircle, Map, Swords, User } from "lucide-react";
import { NavLink } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { ThemeToggle } from "./ThemeToggle";
import { useSession } from "~/lib/auth-client";
import { cn } from "~/lib/utils";

// 5 items per CONTEXT patterns_handoff item 1 (Chat preserved). Mirrors BottomNav.
const NAV_ITEMS = [
  { to: "/", label: "Home", icon: Home },
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/roadmaps", label: "Roadmaps", icon: Map },
  { to: "/battle", label: "Battle", icon: Swords },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function SidebarNav() {
  // Pull display name + avatar from the existing Better Auth session hook
  // (already used in _app.tsx + battle routes). Level requires a separate
  // user_stats query that this sidebar doesn't currently own — wiring it
  // is deferred to Plan 6 polish per the plan's acceptance criteria.
  const { data: session } = useSession();
  const displayName = (session?.user?.name as string | undefined) ?? null;
  const avatarUrl = (session?.user?.image as string | undefined) ?? null;
  const initial = displayName?.charAt(0).toUpperCase() ?? "?";

  return (
    <nav
      className="hidden lg:flex lg:w-[280px] lg:flex-col lg:border-r lg:border-[hsl(var(--border))] lg:bg-[hsl(var(--bg-elevated))] lg:p-4"
      aria-label="Main navigation"
    >
      <div className="mb-8 px-3 font-display text-2xl tracking-tight text-foreground">
        MIMIR
      </div>
      <div className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex min-h-12 items-center gap-3 rounded-[var(--radius-md)] px-3 text-base font-medium transition-colors duration-[var(--duration-fast)]",
                isActive
                  ? "bg-[hsl(var(--dominant-soft))] text-[hsl(var(--dominant))]"
                  : "text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg-subtle))] hover:text-foreground"
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
      </div>
      {/*
        User block (UI-SPEC § Sidebar Nav user block):
        Avatar + display name (truncated) + ThemeToggle on the right.
        TODO Plan 6: wire `level` from the user_stats query and render <LevelBadge level={level} />
        beneath the display name. Sidebar doesn't currently own that query so deferring per
        plan acceptance criteria ("Do not block this plan on user-data wiring").
      */}
      <div className="mt-auto flex items-center gap-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] p-3">
        <Avatar className="h-9 w-9">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {displayName ?? "Signed in"}
          </p>
        </div>
        <ThemeToggle />
      </div>
    </nav>
  );
}
