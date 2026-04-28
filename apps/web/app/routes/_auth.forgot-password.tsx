import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router";
import { Loader2, Mail } from "lucide-react";

import { forgotPasswordSchema, type ForgotPasswordInput } from "~/lib/auth-schemas";
import { forgetPassword } from "~/lib/auth-client";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "~/components/ui/form";
import { Alert, AlertDescription } from "~/components/ui/alert";

export default function ForgotPasswordPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: {
      email: "",
    },
  });

  async function onSubmit(values: ForgotPasswordInput) {
    setIsLoading(true);
    setServerError(null);

    try {
      await forgetPassword({
        email: values.email,
        redirectTo: "/auth/reset-password",
      });
      // Phase 01 lock: always show success state regardless of whether the
      // email exists — prevents email enumeration. Do not change.
      setSubmittedEmail(values.email);
    } catch {
      setServerError(
        "Something went wrong. Check your connection and try again."
      );
    } finally {
      setIsLoading(false);
    }
  }

  // Success state — Phase 01 enumeration-prevention lock.
  if (submittedEmail) {
    return (
      <div className="flex flex-col">
        {/* MIMIR brand mark — UI-SPEC § Auth Screens. */}
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
              Check your email
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <p className="text-center text-sm text-[hsl(var(--fg-muted))]">
              We&apos;ve sent a password reset link to{" "}
              <span className="font-medium text-foreground">{submittedEmail}</span>
              . Check your inbox and follow the link to reset your password.
            </p>
            <Button asChild variant="ghost" className="min-h-12 w-full">
              <Link to="/auth/sign-in">Back to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* MIMIR brand mark — UI-SPEC § Auth Screens. */}
      <div className="mb-8 flex justify-center">
        <span className="font-display text-[22px] tracking-tight text-foreground">
          MIMIR
        </span>
      </div>

      <Card className="w-full max-w-[480px]">
        <CardHeader>
          <CardTitle className="text-[22px] font-semibold leading-[1.25] -tracking-[0.005em]">
            Reset your password
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <p className="text-sm text-[hsl(var(--fg-muted))]">
            Enter your email address and we&apos;ll send you a link to reset your
            password.
          </p>

          {/* Error summary above form — UI-SPEC § Auth A11y aria-live="polite". */}
          <div aria-live="polite">
            {serverError && (
              <Alert variant="destructive">
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}
          </div>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              aria-busy={isLoading}
              className="flex flex-col gap-4"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="you@example.com"
                        autoFocus
                        autoComplete="email"
                        aria-invalid={fieldState.invalid || undefined}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="min-h-12 w-full"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Send reset link"
                )}
              </Button>
            </form>
          </Form>

          {/* Secondary link — Button ghost full-width per UI-SPEC § Auth Screens. */}
          <Button asChild variant="ghost" className="min-h-12 w-full">
            <Link to="/auth/sign-in">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
