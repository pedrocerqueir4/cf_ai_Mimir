import { BottomNav } from "./BottomNav";
import { SidebarNav } from "./SidebarNav";
import { ThemeToggle } from "./ThemeToggle";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-background">
      <SidebarNav />
      <div className="flex flex-1 flex-col">
        {/* Mobile header */}
        <header className="flex items-center justify-end border-b border-border p-4 lg:hidden">
          <ThemeToggle />
        </header>
        {/* Desktop header */}
        <header className="hidden items-center justify-end border-b border-border p-4 lg:flex">
          <ThemeToggle />
        </header>
        <main className="flex-1 pb-20 lg:pb-4">
          <div className="mx-auto w-full max-w-[640px] px-4 pt-4">
            {children}
          </div>
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
