import { Outlet } from "react-router";
import { ThemeToggle } from "~/components/layout/ThemeToggle";

export default function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>
      <main className="flex flex-1 items-center justify-center px-4 pb-8">
        <div className="w-full max-w-[480px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
