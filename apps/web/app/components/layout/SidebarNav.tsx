import { Home, MessageCircle, Map, Swords, User } from "lucide-react";
import { NavLink } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { LevelBadge } from "~/components/gamification/LevelBadge";
import { ThemeToggle } from "./ThemeToggle";
import { useSession } from "~/lib/auth-client";
import { fetchUserStats, type UserStats } from "~/lib/api-client";
import { cn, getLocalTimezone } from "~/lib/utils";

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
  // (already used in _app.tsx + battle routes).
  const { data: session } = useSession();
  const displayName = (session?.user?.name as string | undefined) ?? null;
  const avatarUrl = (session?.user?.image as string | undefined) ?? null;
  const initial = displayName?.charAt(0).toUpperCase() ?? "?";

  // Plan 06-06: wire `level` from the shared user-stats query.
  // Same queryKey as Dashboard + Profile so TanStack Query caches one fetch.
  // `enabled` keeps the query parked until the user is signed in (auth chassis
  // doesn't render the sidebar, so this is just defensive for tests / SSR).
  const tz = getLocalTimezone();
  const { data: stats } = useQuery<UserStats>({
    queryKey: ["user", "stats"],
    queryFn: () => fetchUserStats(tz),
    staleTime: 30_000,
    enabled: !!session?.user,
  });
  const level = stats?.level ?? null;

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
        Avatar + display name (truncated) + LevelBadge below name + ThemeToggle on the right.
        Plan 06-06 wired `level` via the shared `["user","stats"]` TanStack Query cache.
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
          {level !== null && (
            <div className="mt-1">
              <LevelBadge level={level} />
            </div>
          )}
        </div>
        <ThemeToggle />
      </div>
    </nav>
  );
}
