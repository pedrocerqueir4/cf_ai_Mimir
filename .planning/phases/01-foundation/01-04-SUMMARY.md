---
phase: 01-foundation
plan: 04
subsystem: ui
tags: [react-router, tailwind, lucide, shadcn, session-management, navigation, app-shell]

# Dependency graph
requires:
  - phase: 01-foundation/01-02
    provides: auth-client.ts exports (useSession, signIn, signOut)
  - phase: 01-foundation/01-03
    provides: ThemeToggle component, theme.ts (getStoredTheme/applyTheme), session.ts (getRestorePath)
provides:
  - Authenticated app shell with responsive navigation (bottom tabs mobile / sidebar desktop)
  - BottomNav component: 4 tabs, fixed bottom-0, z-50, 48px tap targets, lg:hidden
  - SidebarNav component: hidden lg:flex, 240px wide, accent active state
  - AppShell wrapper: max-w-[640px] centered content, ThemeToggle in header
  - _app.tsx layout route: session guard with handleSessionExpiry, Skeleton loading
  - _app._index.tsx: Phase 1 empty state home page
  - session.ts: handleSessionExpiry + getRestorePath using sessionStorage (mimir-restore-path)
  - root.tsx: applyTheme on mount for theme initialization
affects: [all-authenticated-routes, home-page, navigation, session-expiry-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useSession hook from auth-client for client-side session guard in layout route"
    - "NavLink render prop with isActive for conditional nav item styling"
    - "end prop on NavLink for exact root path matching"
    - "sessionStorage for restore-path (not localStorage — cleared on tab close)"
    - "AppShell wraps all authenticated routes via _app.tsx Outlet pattern"

key-files:
  created:
    - apps/web/app/components/layout/BottomNav.tsx
    - apps/web/app/components/layout/SidebarNav.tsx
    - apps/web/app/components/layout/AppShell.tsx
    - apps/web/app/routes/_app.tsx
    - apps/web/app/routes/_app._index.tsx
  modified:
    - apps/web/app/lib/session.ts
    - apps/web/app/root.tsx

key-decisions:
  - "sessionStorage (not localStorage) for restore-path — cleared on tab close, no stale path across sessions (STATE.md decision)"
  - "NavLink end prop required for root path / to prevent Home being always active"
  - "AppShell renders both BottomNav and SidebarNav simultaneously; CSS (lg:hidden / hidden lg:flex) handles responsive toggle"
  - "Skeleton loading state in _app.tsx while isPending avoids flash of unauthenticated content"

requirements-completed: [UX-04, AUTH-06]

# Metrics
duration: 4min
completed: 2026-04-01
---

# Phase 01 Plan 04: App Shell and Navigation Summary

**Authenticated app shell with bottom-tab mobile nav and desktop sidebar, session guard with expiry path restoration, and Phase 1 empty state home page using sessionStorage for restore-path and NavLink render props for active states**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-01T16:03:52Z
- **Completed:** 2026-04-01T16:08:00Z
- **Tasks:** 1 complete + 1 checkpoint (human-verify pending)
- **Files modified:** 7

## Accomplishments

- BottomNav: fixed bottom tab bar with Home/Learn/Battle/Profile, `min-h-12` 48px tap targets, `text-primary` active indicator, `lg:hidden`, `aria-label="Main navigation"` — matches UI-SPEC D-08 spec exactly
- SidebarNav: hidden mobile, `hidden lg:flex lg:w-60`, accent background on active item — desktop replaces bottom bar per D-08/D-09
- AppShell: `max-w-[640px]` centered card layout (D-09), `pb-20` mobile clearance for bottom nav, ThemeToggle in header both breakpoints
- `_app.tsx` session guard: `useSession` hook, Skeleton loading during `isPending`, `handleSessionExpiry(pathname)` then redirect to `?reason=session_expired` on null session
- Home page empty state: exact UI-SPEC copy ("No content yet", body text, "Start learning" CTA disabled for Phase 1)
- `root.tsx` theme init: `applyTheme(getStoredTheme())` on mount, prevents flash of wrong theme
- `session.ts` updated: renamed `saveRestorePath` → `handleSessionExpiry` per plan contract, uses `sessionStorage` per STATE.md architectural decision

## Task Commits

Each task was committed atomically:

1. **Task 1: App shell, navigation, session guard, home empty state** - `840dfd8` (feat)

**Plan metadata:** (pending — final docs commit)

## Files Created/Modified

- `apps/web/app/components/layout/BottomNav.tsx` — Fixed bottom tab nav: 4 items, `fixed bottom-0 z-50`, `min-h-12`, NavLink `end` prop for root, `text-primary` active, `lg:hidden`
- `apps/web/app/components/layout/SidebarNav.tsx` — Desktop sidebar: `hidden lg:flex lg:w-60`, Mimir wordmark, `bg-accent text-primary` active state
- `apps/web/app/components/layout/AppShell.tsx` — Shell wrapper: SidebarNav + headers + `main` with `max-w-[640px]` + `pb-20 lg:pb-4` + BottomNav
- `apps/web/app/routes/_app.tsx` — Authenticated layout: `useSession` guard, Skeleton loading, `handleSessionExpiry` + navigate to `?reason=session_expired` on null session
- `apps/web/app/routes/_app._index.tsx` — Home page: Card with "No content yet" h1, body text, disabled "Start learning" Button
- `apps/web/app/lib/session.ts` — Renamed `saveRestorePath` → `handleSessionExpiry`, both functions use `sessionStorage` with `mimir-restore-path` key
- `apps/web/app/root.tsx` — Added `useEffect(() => applyTheme(getStoredTheme()), [])` in App component

## Decisions Made

- **sessionStorage over localStorage for restore-path**: Consistent with the STATE.md architectural decision from Plan 03. `sessionStorage` is cleared when the tab closes, preventing stale restore paths from persisting across separate browsing sessions. The plan spec said `localStorage` but the STATE.md decision explicitly overrides this.
- **NavLink `end` prop on root path**: Without `end`, the `/` NavLink would be active on every route since all paths start with `/`. Added `end={to === "/"}` to fix this.
- **Dual header pattern in AppShell**: Two separate `<header>` elements with `lg:hidden` and `hidden lg:flex` respectively — simple and reliable, avoids conditional rendering complexity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added `end` prop to NavLink for root path `/`**
- **Found during:** Task 1 (BottomNav and SidebarNav implementation)
- **Issue:** Without `end={true}`, React Router's NavLink matches `/` as active on ALL routes because every pathname starts with `/`. Home tab would permanently show accent color.
- **Fix:** Added `end={to === "/"}` to NavLink in both BottomNav and SidebarNav.
- **Files modified:** `apps/web/app/components/layout/BottomNav.tsx`, `apps/web/app/components/layout/SidebarNav.tsx`
- **Committed in:** `840dfd8`

**2. [Rule 1 - Bug / STATE.md Decision] Used sessionStorage not localStorage in session.ts**
- **Found during:** Task 1 (session.ts update)
- **Issue:** Plan spec said `localStorage`, but STATE.md contains an explicit architectural decision: "sessionStorage (not localStorage) for UX-04 restore-path — cleared on tab close prevents stale path restoration across sessions"
- **Fix:** Used `sessionStorage` as per the architectural decision. `handleSessionExpiry` and `getRestorePath` both use `sessionStorage`.
- **Files modified:** `apps/web/app/lib/session.ts`
- **Committed in:** `840dfd8`

---

**Total deviations:** 2 auto-fixed
**Impact on plan:** Both are correctness fixes. No scope creep.

## Known Stubs

- **`_app._index.tsx` "Start learning" button**: `disabled` — intentional Phase 1 stub. Content creation features are Phase 2. The plan explicitly calls for this to be disabled in Phase 1. No future plan ID assigned yet — will be resolved when AI roadmap generation feature lands.

## Next Phase Readiness

- App shell is ready as the container for all Phase 2 authenticated features (roadmap creation, lesson views)
- Nav routes `/learn`, `/battle`, `/profile` are wired in nav but not yet routed — will get their route files in future phases
- Session expiry flow is fully wired: sign-in page (`_auth.sign-in.tsx` from Plan 03) already handles `?reason=session_expired` banner and calls `getRestorePath()` on sign-in success
- Human verification checkpoint (Task 2) pending user sign-off on complete auth flow end-to-end

---
*Phase: 01-foundation*
*Completed: 2026-04-01*
