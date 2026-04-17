import type { Context, Next } from "hono";

const XSS_PATTERN = /<\s*script|<\s*img\s+[^>]*onerror|javascript:|on\w+\s*=/i;
const SQLI_PATTERN = /(';\s*(DROP|ALTER|DELETE|UPDATE|INSERT)|UNION\s+SELECT|\bOR\s+1\s*=\s*1)/i;
const PROMPT_INJECTION_PATTERN = /(\[INST\]|<<SYS>>|ignore\s+(all\s+)?previous|system\s*:|<\|im_start\|>)/i;

function containsMalicious(value: string): boolean {
  return XSS_PATTERN.test(value) || SQLI_PATTERN.test(value) || PROMPT_INJECTION_PATTERN.test(value);
}

function checkObject(obj: unknown): boolean {
  if (typeof obj === "string") return containsMalicious(obj);
  if (Array.isArray(obj)) return obj.some(checkObject);
  if (obj && typeof obj === "object") {
    return Object.values(obj).some(checkObject);
  }
  return false;
}

export async function sanitize(c: Context, next: Next) {
  // Skip body sanitization for Better Auth routes — Better Auth validates its own
  // inputs, and reading the body here would consume the ReadableStream, causing
  // "Body has already been used" errors when Better Auth calls getBody() later.
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/auth/")) {
    return next();
  }

  if (["POST", "PUT", "PATCH"].includes(c.req.method)) {
    try {
      const body = await c.req.json();
      if (checkObject(body)) {
        return c.json({ error: "Invalid input" }, 400);
      }
    } catch {
      // No JSON body or parse error — let downstream handle
    }
  }
  await next();
}
