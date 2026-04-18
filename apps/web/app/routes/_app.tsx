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
