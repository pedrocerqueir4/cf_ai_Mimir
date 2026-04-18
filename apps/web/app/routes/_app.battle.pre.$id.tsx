/**
 * Stub for /battle/pre/:id — Plan 06 will replace this with the slot-machine
 * reveal flow (roadmap reveal → wager reveal → navigate to /battle/room/:id).
 *
 * Keeping a stub here so Plan 05's lobby can navigate to this route without
 * hitting a 404 during UAT. Plan 06 overwrites this file.
 */
export default function BattlePrePlaceholder() {
  return (
    <div className="px-4 pt-8 pb-24">
      <h1 className="text-xl font-semibold leading-tight mb-2">
        Pre-battle reveals
      </h1>
      <p className="text-base text-muted-foreground">
        Coming soon (Plan 06). The roadmap and wager slot-machines ship here.
      </p>
    </div>
  );
}
