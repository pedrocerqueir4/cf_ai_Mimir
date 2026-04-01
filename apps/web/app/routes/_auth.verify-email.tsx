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
    <Card>
      <CardHeader>
        <div className="flex justify-center mb-2">
          <Mail className="h-10 w-10 text-primary" />
        </div>
        <CardTitle className="text-xl font-semibold text-center">
          Verify your email
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <p className="text-sm text-muted-foreground text-center">
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

        <p className="text-center text-sm text-muted-foreground">
          Already verified?{" "}
          <Link
            to="/auth/sign-in"
            className="text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
