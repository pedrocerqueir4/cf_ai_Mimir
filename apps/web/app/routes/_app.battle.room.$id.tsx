/**
 * Stub for /battle/room/:id — Plan 07 will replace this with the live battle
 * room: WebSocket connection via useBattleSocket hook, question pacing, score
 * cards, timer ring, reconnect overlay.
 *
 * Plan 05 creates this stub so routes.ts type-checks and UAT navigation flows
 * land somewhere real instead of a 404.
 */
export default function BattleRoomPlaceholder() {
  return (
    <div className="px-4 pt-8 pb-24">
      <h1 className="text-xl font-semibold leading-tight mb-2">Battle room</h1>
      <p className="text-base text-muted-foreground">
        Coming soon (Plan 07). WebSocket battle experience ships here.
      </p>
    </div>
  );
}
