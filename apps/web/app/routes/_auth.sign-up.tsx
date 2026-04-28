import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, Link } from "react-router";
import { Loader2 } from "lucide-react";

import { signUpSchema, type SignUpInput } from "~/lib/auth-schemas";
import { signUp } from "~/lib/auth-client";

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

export default function SignUpPage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(values: SignUpInput) {
    if (!turnstileToken) {
      setServerError("Please complete the CAPTCHA to continue.");
      return;
    }

    setIsLoading(true);
    setServerError(null);

    try {
      const result = await signUp.email(
        {
          name: values.name,
          email: values.email,
          password: values.password,
        },
        { headers: { "cf-turnstile-response": turnstileToken } }
      );

      if (result.error) {
        const status = result.error.status;
        if (status === 403) {
          setServerError("CAPTCHA verification failed. Please try again.");
          setTurnstileToken(null);
        } else if (status === 422 || result.error.message?.includes("already")) {
          setServerError(
            "An account with this email already exists. Sign in instead."
          );
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

      navigate("/auth/verify-email");
    } catch {
      setServerError(
        "Something went wrong. Check your connection and try again."
      );
    } finally {
      setIsLoading(false);
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
          <CardTitle className="text-[22px] font-semibold leading-[1.25] -tracking-[0.005em]">
            Create your account
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <OAuthButtons mode="sign-up" />

          <div className="flex items-center gap-4">
            <Separator className="flex-1" />
            <span className="text-sm text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>

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
                name="name"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="Your name"
                        autoFocus
                        autoComplete="name"
                        aria-invalid={fieldState.invalid || undefined}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                        autoComplete="email"
                        aria-invalid={fieldState.invalid || undefined}
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
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
                        aria-invalid={fieldState.invalid || undefined}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Repeat your password"
                        autoComplete="new-password"
                        aria-invalid={fieldState.invalid || undefined}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <TurnstileWidget
                onSuccess={(token) => setTurnstileToken(token)}
                onError={() => setTurnstileToken(null)}
              />

              <Button
                type="submit"
                className="min-h-12 w-full"
                disabled={isLoading || !turnstileToken}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  "Create account"
                )}
              </Button>
            </form>
          </Form>

          {/* Secondary link — Button ghost full-width per UI-SPEC § Auth Screens. */}
          <Button
            asChild
            variant="ghost"
            className="min-h-12 w-full"
          >
            <Link to="/auth/sign-in">Sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
