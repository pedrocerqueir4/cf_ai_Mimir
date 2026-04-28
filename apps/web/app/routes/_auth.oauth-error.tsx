import { useSearchParams, Link } from "react-router";
import { AlertCircle } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";

/**
 * OAuth error route — UI-SPEC § OAuth error screen.
 *
 * Frontend-only error-code mapping per CONTEXT.md D-04: reads `?error=<code>`
 * from the URL (set by Better Auth via `errorCallbackURL` redirect — see
 * OAuthButtons.tsx) and classifies it into one of three UI-SPEC copy variants.
 *
 * Mapping table verified in installed Better Auth dist:
 * - state-mismatch → `worker/node_modules/better-auth/dist/state.mjs.map`
 *   StateErrorCode union
 * - account-conflict → `@better-auth/core/dist/error/codes.mjs.map`
 *   BASE_ERROR_CODES enum
 * - default → any other code (USER_EMAIL_NOT_FOUND, FAILED_TO_GET_USER_INFO,
 *   INVALID_CALLBACK_URL, no code, etc.)
 *
 * The displayed text is sourced from the static `COPY` map below — `?error=`
 * is only used as a Set-membership lookup key (no DOM echo, no template
 * injection — see Plan 06-05 threat register T-06-27 / T-06-28).
 */

const STATE_CODES = new Set([
  "state_mismatch",
  "state_invalid",
  "state_security_mismatch",
  "state_generation_error",
]);

const ACCOUNT_CONFLICT_CODES = new Set([
  "SOCIAL_ACCOUNT_ALREADY_LINKED",
  "LINKED_ACCOUNT_ALREADY_EXISTS",
  "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
]);

type OAuthErrorVariant = "default" | "state-mismatch" | "account-conflict";

export function classifyOAuthError(code: string | null): OAuthErrorVariant {
  if (!code) return "default";
  const upper = code.toUpperCase();
  if (STATE_CODES.has(code) || STATE_CODES.has(code.toLowerCase())) {
    return "state-mismatch";
  }
  if (
    ACCOUNT_CONFLICT_CODES.has(upper) ||
    code.includes("already_linked") ||
    code.includes("already_exists")
  ) {
    return "account-conflict";
  }
  return "default";
}

// UI-SPEC § Copywriting Contract — three OAuth error copy variants. Locked.
const COPY: Record<OAuthErrorVariant, string> = {
  default:
    "We couldn't complete your sign-in. Try again, or use email and password.",
  "state-mismatch":
    "Your sign-in session expired. Start over to keep your account secure.",
  "account-conflict":
    "An account with that email already exists. Sign in with your password to link providers.",
};

export default function OAuthErrorPage() {
  const [searchParams] = useSearchParams();
  const variant = classifyOAuthError(searchParams.get("error"));

  return (
    // max-w-[400px] per CONTEXT patterns_handoff item 5 — UI-SPEC contract
    // wins for this new screen (existing auth screens stay at max-w-[480px]).
    <Card className="w-full max-w-[400px]">
      <CardHeader>
        <CardTitle className="text-[22px] font-semibold leading-[1.25] -tracking-[0.005em]">
          Sign-in failed
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* role="alert" makes the failure announce on mount — UI-SPEC § A11y. */}
        <Alert variant="destructive" role="alert">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{COPY[variant]}</AlertDescription>
        </Alert>
        <Button asChild className="min-h-12 w-full">
          <Link to="/auth/sign-in">Try again</Link>
        </Button>
        <Button asChild variant="ghost" className="min-h-12 w-full">
          <Link to="/auth/sign-in">Back to sign in</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
