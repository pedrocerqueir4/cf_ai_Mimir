import { Outlet, useNavigate } from "react-router";
import { useEffect } from "react";
import { useSession } from "~/lib/auth-client";
import { AppShell } from "~/components/layout/AppShell";
import { handleSessionExpiry } from "~/lib/session";
import { Skeleton } from "~/components/ui/skeleton";

export default function AppLayout() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPending && !session) {
      handleSessionExpiry(window.location.pathname);
      navigate("/auth/sign-in?reason=session_expired");
    }
  }, [session, isPending, navigate]);

  if (isPending) {
    return (
      <AppShell>
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
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
