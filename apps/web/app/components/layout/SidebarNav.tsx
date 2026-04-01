import { Home, BookOpen, Swords, User } from "lucide-react";
import { NavLink } from "react-router";

const NAV_ITEMS = [
  { to: "/", label: "Home", icon: Home },
  { to: "/learn", label: "Learn", icon: BookOpen },
  { to: "/battle", label: "Battle", icon: Swords },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function SidebarNav() {
  return (
    <nav
      className="hidden lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-border lg:bg-card lg:p-4"
      aria-label="Main navigation"
    >
      <div className="mb-8 px-3 text-lg font-semibold text-foreground">
        Mimir
      </div>
      <div className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex min-h-12 items-center gap-3 rounded-md px-3 text-sm font-normal ${
                isActive
                  ? "bg-accent text-primary"
                  : "text-muted-foreground hover:bg-accent/50"
              }`
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
    </nav>
  );
}
