import { useState } from "react";
import { useSearchParams, Link } from "react-router";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "~/lib/auth-client";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const [isResending, setIsResending] = useState(false);

  // Email may come from query param (e.g. ?email=user@example.com)
  const email = searchParams.get("email") ?? "";

  async function handleResend() {
    if (!email) return;

    setIsResending(true);
    try {
      await authClient.sendVerificationEmail({
        email,
        callbackURL: "/auth/sign-in",
      });
      toast.success("Verification email resent. Check your inbox.");
    } catch {
      toast.error("Something went wrong. Check your connection and try again.");
    } finally {
      setIsResending(false);
    }
  }

  return (
    <div className="flex flex-col">
      {/* MIMIR brand mark — UI-SPEC § Auth Screens display-sm Rubik Mono One. */}
      <div className="mb-8 flex justify-center">
        <span className="font-display text-[22px] tracking-tight text-foreground">
          MIMIR
        </span>
      </div>

      <Card className="w-full max-w-[480px]">
        <CardHeader>
          <div className="mb-2 flex justify-center">
            <Mail className="h-10 w-10 text-primary" />
          </div>
          <CardTitle className="text-center text-[22px] font-semibold leading-[1.25] -tracking-[0.005em]">
            Verify your email
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <p className="text-center text-sm text-[hsl(var(--fg-muted))]">
            We&apos;ve sent a verification link
            {email ? (
              <>
                {" "}
                to{" "}
                <span className="font-medium text-foreground">{email}</span>
              </>
            ) : null}
            . Click the link to activate your account.
          </p>

          <Button
            type="button"
            variant="outline"
            className="min-h-12 w-full"
            onClick={handleResend}
            disabled={isResending || !email}
          >
            {isResending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Resending...
              </>
            ) : (
              "Resend verification email"
            )}
          </Button>

          {/* Secondary link — Button ghost full-width per UI-SPEC § Auth Screens. */}
          <Button asChild variant="ghost" className="min-h-12 w-full">
            <Link to="/auth/sign-in">Sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
