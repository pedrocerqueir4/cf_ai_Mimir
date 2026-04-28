import { Outlet } from "react-router";
import { ThemeToggle } from "~/components/layout/ThemeToggle";

/**
 * Auth chassis — UI-SPEC § Auth Screens.
 * Centered card on `--bg-base` with `--space-4xl` (96px) hero spacing above and
 * below on tall mobile viewports. Existing screens use max-w-[480px] (per
 * CONTEXT patterns_handoff item 5); the new `/auth/oauth-error` route uses
 * its own max-w-[400px] chassis (UI-SPEC contract wins for the new screen).
 */
export default function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-[hsl(var(--bg-base))]">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>
      <main className="flex flex-1 items-center justify-center px-4 py-24">
        <div className="w-full max-w-[480px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
