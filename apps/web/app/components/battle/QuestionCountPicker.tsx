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
        className="text-xl font-semibold leading-tight mb-3"
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
                "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg border px-3 py-2 transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/40",
              )}
            >
              <span className="text-xl font-semibold leading-tight">
                {count}
              </span>
              <span className="text-sm font-normal leading-snug">{label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground mt-2">
        Each question has 15 seconds. A standard battle lasts about 3 minutes.
      </p>
    </section>
  );
}
