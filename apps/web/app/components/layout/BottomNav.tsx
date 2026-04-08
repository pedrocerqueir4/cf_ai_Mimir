import { Home, MessageCircle, Map, Swords, User } from "lucide-react";
import { NavLink } from "react-router";

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
      className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t border-border bg-card lg:hidden"
      aria-label="Main navigation"
    >
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            `flex min-h-12 min-w-12 flex-col items-center justify-center gap-1 px-3 text-sm font-normal ${
              isActive ? "text-primary" : "text-muted-foreground"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={20} aria-hidden="true" />
              <span className="text-xs">{label}</span>
              {isActive && <span className="sr-only">(current page)</span>}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
