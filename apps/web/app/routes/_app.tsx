import { Outlet, useLocation, useNavigate } from "react-router";
import { useEffect } from "react";
import { useSession } from "~/lib/auth-client";
import { AppShell } from "~/components/layout/AppShell";
import { handleSessionExpiry } from "~/lib/session";
import { Skeleton } from "~/components/ui/skeleton";

/**
 * Routes that render full-viewport and hide the bottom/sidebar nav so the
 * user can't exit mid-reveal or mid-battle. Matches UI-SPEC §Screens in
 * Scope (Phase 4): "Bottom nav / sidebar nav are hidden on `/battle/pre/*`
 * and `/battle/room/*` to remove exit friction during the signature
 * animations and the live battle."
 */
function isImmersivePath(pathname: string): boolean {
  return (
    pathname.startsWith("/battle/pre") ||
    pathname.startsWith("/battle/room")
  );
}

export default function AppLayout() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const immersive = isImmersivePath(location.pathname);
  // Page-level transitions intentionally disabled. Three iterations with
  // framer-motion AnimatePresence (mode=wait, mode=popLayout, opacity-only)
  // produced perceptible flicker on tab nav — React Router 7 commits the new
  // route's Outlet content before AnimatePresence's initial state applies,
  // so the new page paints once at full opacity then re-animates from y:6.
  // Active-tab indicator change in BottomNav/SidebarNav already provides the
  // visual feedback for navigation. Phase 06 design language lives in
  // per-component motion (button press, list-stagger, celebrations).
  // DEVIATION from UI-SPEC § 5.1 page-transition — flagged for Plan 6 polish
  // to revisit via React Router 7's native viewTransition API (CSS view
  // transitions avoid the framer-motion paint-flash).

  useEffect(() => {
    if (!isPending && !session) {
      handleSessionExpiry(window.location.pathname);
      navigate("/auth/sign-in?reason=session_expired");
    }
  }, [session, isPending, navigate]);

  if (isPending) {
    return (
      <AppShell immersive={immersive}>
        <div className="space-y-4 p-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </AppShell>
    );
  }

  if (!session) return null;

  return (
    <AppShell immersive={immersive}>
      <Outlet />
    </AppShell>
  );
}
