// Lobby participant identity tile. Plan 04-11, Task 4.
//
// Renders one of two slots in the pre-battle lobby: the host's or the
// guest's name + avatar + level + XP. Level is shown via the existing
// gamification LevelBadge component so the visual language stays
// consistent with the profile/home pages.
//
// Design note: the component is intentionally presentational. It takes
// already-resolved props (no data fetching, no useSession). The lobby
// route derives role and isSelf and passes everything down. This keeps
// ParticipantCard trivially unit-testable if we ever wire RTL.

import { LevelBadge } from "~/components/gamification/LevelBadge";
import { cn } from "~/lib/utils";

export interface ParticipantCardProps {
	name: string;
	image: string | null;
	level: number;
	xp: number;
	role: "host" | "guest";
	isSelf: boolean;
}

function initialsOf(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) return "?";
	const parts = trimmed.split(/\s+/);
	if (parts.length === 1) {
		return parts[0].slice(0, 2).toUpperCase();
	}
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ParticipantCard({
	name,
	image,
	level,
	xp,
	role,
	isSelf,
}: ParticipantCardProps) {
	return (
		<div
			className={cn(
				"flex items-center gap-3 rounded-[var(--radius-lg)] border bg-[hsl(var(--bg-elevated))] p-4",
				isSelf
					? "border-[hsl(var(--dominant))]/60"
					: "border-[hsl(var(--border))]",
			)}
			data-role={role}
			data-self={isSelf ? "true" : "false"}
		>
			{/* Avatar */}
			<div
				className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[hsl(var(--bg-subtle))] text-[14px] font-medium text-[hsl(var(--fg-muted))]"
				aria-hidden="true"
			>
				{image ? (
					// Small avatar; no lazy loading needed — this lives above the fold.
					// eslint-disable-next-line @next/next/no-img-element
					<img
						src={image}
						alt=""
						className="h-full w-full object-cover"
					/>
				) : (
					<span>{initialsOf(name)}</span>
				)}
			</div>

			{/* Name + metadata */}
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex items-center gap-2">
					<p className="truncate text-[16px] font-semibold leading-[1.5]">
						{name}
						{isSelf && (
							<span className="ml-1 text-[12px] font-normal text-[hsl(var(--fg-muted))]">
								(you)
							</span>
						)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<LevelBadge level={level} />
					<span className="text-[14px] leading-[1.5] tabular-nums text-[hsl(var(--fg-muted))]">
						{xp.toLocaleString()} XP
					</span>
				</div>
			</div>

			{/* Role chip — host vs guest */}
			<span
				className={cn(
					"shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium uppercase tracking-wide",
					role === "host"
						? "bg-[hsl(var(--dominant-soft))] text-[hsl(var(--dominant))]"
						: "bg-[hsl(var(--bg-subtle))] text-[hsl(var(--fg-muted))]",
				)}
			>
				{role}
			</span>
		</div>
	);
}
