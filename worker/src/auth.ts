import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { multiSession } from "better-auth/plugins";

export function createAuth(env: Env) {
  return betterAuth({
    baseURL: env.PUBLIC_URL,
    database: drizzleAdapter(env.DB, { provider: "sqlite", usePlural: true }),
    trustedOrigins: [env.PUBLIC_URL],
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
        console.error("[AUTH ERROR]", error.message, error.status);
      },
    },
    // D-06: Configure OAuth error redirect — when provider denies permission
    // or returns an error, Better Auth redirects to callbackURL with ?error= param.
    // The sign-in UI (Plan 03) reads this param and shows an Alert.
    advanced: {
      defaultCallbackURL: "/auth/sign-in",
    },
  });
}
