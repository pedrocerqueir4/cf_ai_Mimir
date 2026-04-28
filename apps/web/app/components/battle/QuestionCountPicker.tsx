import { cn } from "~/lib/utils";

export type QuestionCount = 5 | 10 | 15;

interface QuestionCountPickerProps {
  value: QuestionCount;
  onChange: (value: QuestionCount) => void;
}

const OPTIONS: Array<{
  count: QuestionCount;
  label: string;
}> = [
  { count: 5, label: "Quick" },
  { count: 10, label: "Standard" },
  { count: 15, label: "Marathon" },
];

/**
 * Three-button segmented picker (UI-SPEC §Question count).
 * Full-width container split into thirds, 8px gap, min-h-12 tap targets.
 * Helper text below: "Each question has 15 seconds. A standard battle lasts about 3 minutes."
 */
export function QuestionCountPicker({
  value,
  onChange,
}: QuestionCountPickerProps) {
  return (
    <section aria-labelledby="question-count-heading">
      <h2
        id="question-count-heading"
        className="text-[22px] font-semibold leading-[1.25] -tracking-[0.005em] mb-3"
      >
        How many questions?
      </h2>
      <div
        role="radiogroup"
        aria-labelledby="question-count-heading"
        className="grid grid-cols-3 gap-2"
      >
        {OPTIONS.map(({ count, label }) => {
          const isSelected = count === value;
          return (
            <button
              key={count}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(count)}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-md)] border px-3 py-2 transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
                isSelected
                  ? "border-[hsl(var(--dominant))] bg-[hsl(var(--dominant-soft))] text-[hsl(var(--dominant))]"
                  : "border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg-subtle))]",
              )}
            >
              <span className="font-display tabular-nums text-[22px] leading-[1.15]">
                {count}
              </span>
              <span className="text-[14px] font-normal leading-[1.5]">{label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[14px] leading-[1.5] text-[hsl(var(--fg-muted))] mt-2">
        Each question has 15 seconds. A standard battle lasts about 3 minutes.
      </p>
    </section>
  );
}
