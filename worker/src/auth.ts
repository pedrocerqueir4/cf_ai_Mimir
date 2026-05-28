import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { multiSession } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";

export function createAuth(env: Env, requestUrl?: string) {
  const db = drizzle(env.DB, { schema });
  // baseURL MUST match the origin the session cookie was created on, otherwise
  // Better Auth derives a different cookie name (https baseURL → `__Secure-`
  // prefix) and getSession() can't find the session → 401. The login handler
  // (apps/web/workers/app.ts getOrCreateAuth) uses the request origin, so this
  // validator must too. PUBLIC_URL is only a fallback when no request is in
  // scope. Without this, local dev (http://localhost) sets a plain cookie that
  // the https PUBLIC_URL validator never reads.
  const requestOrigin = requestUrl ? new URL(requestUrl).origin : undefined;
  const baseURL = requestOrigin ?? env.PUBLIC_URL;
  const trustedOrigins = Array.from(
    new Set([env.PUBLIC_URL, requestOrigin].filter((v): v is string => !!v)),
  );
  return betterAuth({
    baseURL,
    database: drizzleAdapter(db, { provider: "sqlite", usePlural: true, schema }),
    trustedOrigins,
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days per D-02
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ url, user }) => {
        // TODO: Replace with real email provider (MailChannels or Resend)
        console.log(`[DEV] Password reset for ${user.email}: ${url}`);
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ url, user }) => {
        // TODO: Replace with real email provider
        console.log(`[DEV] Verification email for ${user.email}: ${url}`);
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
    },
    plugins: [
      multiSession({
        maximumSessions: 3, // D-01: max 3 concurrent sessions
      }),
    ],
    account: {
      accountLinking: {
        enabled: true,
        allowDifferentEmails: false, // Link OAuth to existing email account
      },
    },
    onAPIError: {
      // D-06: OAuth error handling — log for debugging in dev
      onError: async (error, ctx) => {
        console.error("[AUTH ERROR]", (error as any).message, (error as any).status);
      },
    },
    // D-06: Configure OAuth error redirect — when provider denies permission
    // or returns an error, Better Auth redirects to callbackURL with ?error= param.
    // The sign-in UI (Plan 03) reads this param and shows an Alert.
  });
}
