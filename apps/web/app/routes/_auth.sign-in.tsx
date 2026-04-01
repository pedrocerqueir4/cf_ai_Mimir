import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useSearchParams, Link } from "react-router";
import { Loader2, AlertCircle } from "lucide-react";

import { signInSchema, type SignInInput } from "~/lib/auth-schemas";
import { signIn } from "~/lib/auth-client";
import { getRestorePath } from "~/lib/session";

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
import { Separator } from "~/components/ui/separator";
import { OAuthButtons } from "~/components/auth/OAuthButtons";
import { TurnstileWidget } from "~/components/auth/TurnstileWidget";

export default function SignInPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [turnstileRequired, setTurnstileRequired] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const reason = searchParams.get("reason");
  const oauthError = searchParams.get("error");

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: SignInInput) {
    // If Turnstile is required but not yet solved, wait for it
    if (turnstileRequired && !turnstileToken) {
      return;
    }

    setIsLoading(true);
    setServerError(null);

    try {
      const fetchOptions =
        turnstileToken
          ? { headers: { "cf-turnstile-response": turnstileToken } }
          : undefined;

      const result = await signIn.email(
        {
          email: values.email,
          password: values.password,
        },
        fetchOptions
      );

      if (result.error) {
        const status = result.error.status;

        if (status === 403) {
          // D-05: server requires Turnstile CAPTCHA
          const body = result.error as unknown as Record<string, unknown>;
          if (body?.turnstileRequired) {
            setTurnstileRequired(true);
            setTurnstileToken(null);
            setIsLoading(false);
            return;
          }
        }

        if (status === 401 || status === 400) {
          setServerError("Incorrect email or password.");
        } else if (status === 429) {
          setServerError(
            "Too many attempts. Wait a few minutes before trying again."
          );
        } else {
          setServerError(
            "Something went wrong. Check your connection and try again."
          );
        }
        return;
      }

      // UX-04: navigate to restored path or default
      const restorePath = getRestorePath();
      navigate(restorePath ?? "/");
    } catch {
      setServerError(
        "Something went wrong. Check your connection and try again."
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Welcome back</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* D-06: OAuth error query param */}
        {oauthError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Sign-in failed. The provider returned an error. Please try again.
            </AlertDescription>
          </Alert>
        )}

        {/* Session expired banner */}
        {reason === "session_expired" && (
          <Alert>
            <AlertDescription>
              Your session expired. Sign in to continue.
            </AlertDescription>
          </Alert>
        )}

        <OAuthButtons mode="sign-in" />

        <div className="flex items-center gap-4">
          <Separator className="flex-1" />
          <span className="text-sm text-muted-foreground">or</span>
          <Separator className="flex-1" />
        </div>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            aria-busy={isLoading}
            className="flex flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      autoFocus
                      autoComplete="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Your password"
                      autoComplete="current-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                  <div className="text-right">
                    <Link
                      to="/auth/forgot-password"
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      Forgot your password?
                    </Link>
                  </div>
                </FormItem>
              )}
            />

            {/* D-05: Turnstile CAPTCHA shown when server requires it */}
            {turnstileRequired && (
              <TurnstileWidget
                onSuccess={(token) => setTurnstileToken(token)}
                onError={() => setTurnstileToken(null)}
              />
            )}

            <Button
              type="submit"
              className="min-h-12 w-full"
              disabled={isLoading || (turnstileRequired && !turnstileToken)}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </Form>

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            to="/auth/sign-up"
            className="text-primary underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
