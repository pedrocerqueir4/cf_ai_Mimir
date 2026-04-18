import {
  type ClipboardEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
} from "react";
import { motion, useAnimationControls } from "framer-motion";
import { cn } from "~/lib/utils";

export const JOIN_CODE_LENGTH = 6;
const ALPHANUMERIC = /^[A-Z0-9]$/;

interface JoinCodeInputProps {
  value: string;
  onChange: (code: string) => void;
  /** Non-null string triggers shake animation + destructive border. */
  error?: string | null;
  /** Auto-focus first box on mount. Default true. */
  autoFocus?: boolean;
}

/**
 * 6-segmented-box OTP-style code input (UI-SPEC §Join code input).
 * Each box: 56×56px, Display role (28/600 mobile, 40/600 desktop) tabular-nums.
 * Auto-advance on keystroke, backspace-rewind on empty, paste distributes.
 * Error state: shake via framer-motion + destructive border.
 */
export function JoinCodeInput({
  value,
  onChange,
  error,
  autoFocus = true,
}: JoinCodeInputProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const controls = useAnimationControls();
  const prevErrorRef = useRef<string | null | undefined>(error);

  // Normalize value to fixed-length char array
  const chars: string[] = Array.from(
    { length: JOIN_CODE_LENGTH },
    (_, i) => value[i] ?? "",
  );

  // Auto-focus first box on mount
  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => inputRefs.current[0]?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  // Trigger shake when `error` transitions from falsy to truthy
  useEffect(() => {
    const prev = prevErrorRef.current;
    if (error && !prev) {
      controls.start({
        x: [-4, 4, -4, 4, 0],
        transition: { duration: 0.4, ease: "easeInOut" },
      });
    }
    prevErrorRef.current = error;
  }, [error, controls]);

  const focusBox = (index: number) => {
    const clamped = Math.max(0, Math.min(JOIN_CODE_LENGTH - 1, index));
    inputRefs.current[clamped]?.focus();
    inputRefs.current[clamped]?.select();
  };

  const updateCharAt = (index: number, nextChar: string) => {
    const next = [...chars];
    next[index] = nextChar;
    onChange(next.join(""));
  };

  const handleChange = (index: number, raw: string) => {
    // Take only the last character typed (covers IME edge cases).
    const upper = raw.toUpperCase();
    const lastChar = upper.slice(-1);
    if (!lastChar) {
      updateCharAt(index, "");
      return;
    }
    if (!ALPHANUMERIC.test(lastChar)) {
      // Reject non-alphanumeric by short-circuit; do not update.
      return;
    }
    updateCharAt(index, lastChar);
    if (index < JOIN_CODE_LENGTH - 1) {
      focusBox(index + 1);
    }
  };

  const handleKeyDown = (
    index: number,
    e: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Backspace") {
      if (chars[index]) {
        // Clear current box; keep focus here.
        e.preventDefault();
        updateCharAt(index, "");
        return;
      }
      // Empty box: rewind focus to previous box.
      if (index > 0) {
        e.preventDefault();
        focusBox(index - 1);
      }
      return;
    }
    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      focusBox(index - 1);
    }
    if (e.key === "ArrowRight" && index < JOIN_CODE_LENGTH - 1) {
      e.preventDefault();
      focusBox(index + 1);
    }
  };

  const handlePaste = (index: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!pasted) return;
    const next = [...chars];
    let write = index;
    for (let i = 0; i < pasted.length && write < JOIN_CODE_LENGTH; i++) {
      next[write] = pasted[i];
      write++;
    }
    onChange(next.join(""));
    // Focus the next empty box or the final box after fill.
    focusBox(Math.min(write, JOIN_CODE_LENGTH - 1));
  };

  const hasError = Boolean(error);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="join-code-0" className="sr-only">
        6-character battle code
      </label>
      <motion.div
        animate={controls}
        className="flex items-center gap-2"
        role="group"
        aria-label="Join code"
      >
        {chars.map((char, i) => (
          <input
            key={i}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            id={`join-code-${i}`}
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            pattern="[A-Za-z0-9]"
            maxLength={1}
            value={char}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            onFocus={(e) => e.target.select()}
            aria-invalid={hasError}
            className={cn(
              "h-14 w-14 rounded-lg border bg-card text-center",
              "text-[28px] font-semibold leading-[1.15] tabular-nums lg:text-[40px]",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              hasError ? "border-destructive" : "border-border",
            )}
          />
        ))}
      </motion.div>
      <p className="text-sm text-muted-foreground">
        Ask your opponent for the code.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
