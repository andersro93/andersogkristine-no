import { defineMiddleware } from "astro:middleware";
import { env } from "./runtime";
import {
  DEFAULT_FLAGS,
  fetchFeatureFlags,
  fetchInviteByCode,
} from "./services/notion";
import {
  checkRateLimit,
  generateSessionCookie,
  recordFailedAttempt,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  verifySessionCookie,
} from "./services/pin";
import { json } from "./utils/http";

const invalidCodes = ["evig-troskap"];

/**
 * Baseline security headers. No script-src CSP (inline scripts + third-party
 * tiles/fonts make that a larger job); frame-ancestors alone stops clickjacking.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), microphone=(), payment=()",
};

function withSecurityHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(name)) {
      try {
        response.headers.set(name, value);
      } catch {
        // Immutable headers (e.g. some static asset responses) — skip
      }
    }
  }
  return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const response = (await handleRequest(context, next)) as Response;
  return withSecurityHeaders(response);
});

const handleRequest: Parameters<typeof defineMiddleware>[0] = async (
  context,
  next,
) => {
  const url = new URL(context.request.url);
  const { pathname, searchParams } = url;

  // Exclude auth routes and static assets from protection
  const isPinPage = pathname === "/pin";
  const isValidatePinApi = pathname === "/api/validate-pin";
  const isRsvpPage = pathname === "/rsvp";
  const isRsvpApi = pathname === "/api/rsvp";
  const isHealthApi = pathname === "/api/health";

  const isStaticAsset =
    pathname.startsWith("/_") ||
    pathname.startsWith("/fonts/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/favicon.svg" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/robots.txt";

  if (isRsvpPage && invalidCodes.includes(searchParams.get("code") ?? "")) {
    return context.redirect(pathname, 302);
  }

  const loadFlags = async (): Promise<Record<string, boolean>> => {
    try {
      return await fetchFeatureFlags(env, context.locals?.cfContext);
    } catch (err) {
      console.error("Failed to load feature flags in middleware:", err);
      return { ...DEFAULT_FLAGS };
    }
  };

  if (
    isPinPage ||
    isValidatePinApi ||
    isRsvpApi ||
    isHealthApi ||
    isStaticAsset
  ) {
    return next();
  }

  // The RSVP page is reachable without the PIN but still renders flag-gated links
  if (isRsvpPage) {
    context.locals.flags = await loadFlags();
    return next();
  }

  const redirectToPin = (error?: string) => {
    const redirectUrl = new URL("/pin", url.origin);
    if (error) redirectUrl.searchParams.set("error", error);
    redirectUrl.searchParams.set("next", pathname + url.search);
    return context.redirect(redirectUrl.pathname + redirectUrl.search);
  };

  // Retrieve cookie and check validity
  const sessionCookie = context.cookies.get(SESSION_COOKIE_NAME);
  let isAuthed = sessionCookie
    ? verifySessionCookie(sessionCookie.value, env)
    : false;

  // Check if code query param is present
  const code = searchParams.get("code");
  if (code && !isAuthed) {
    const ip = context.clientAddress || "unknown-ip";
    const kv = env?.CACHE;
    try {
      const limit = await checkRateLimit(ip, kv, "invite");
      if (!limit.allowed) {
        return redirectToPin("too_many_attempts");
      }

      const invite = await fetchInviteByCode(code, env);
      if (invite) {
        // Valid invite: generate and set cookie
        const newCookieValue = generateSessionCookie(env);
        context.cookies.set(
          SESSION_COOKIE_NAME,
          newCookieValue,
          SESSION_COOKIE_OPTIONS,
        );
        isAuthed = true;
      } else {
        await recordFailedAttempt(ip, kv, "invite");
        return redirectToPin("invalid_invite");
      }
    } catch (err) {
      console.error("Error verifying invite code in middleware:", err);
      return redirectToPin("verification_error");
    }
  }

  // API callers (fetch/XHR) cannot act on an HTML redirect — give them JSON.
  const isApiRequest = pathname.startsWith("/api/");
  if (!isAuthed) {
    return isApiRequest
      ? json({ error: "Logg inn på nytt." }, 401)
      : redirectToPin();
  }

  // Retrieve feature flags once per request; pages read them from locals
  const flags = await loadFlags();
  context.locals.flags = flags;

  // Block direct route access if features are disabled
  if (pathname === "/rsvp" && !flags.rsvp) {
    return context.redirect("/");
  }
  if (pathname === "/bordoppsett" && !flags.seating) {
    return context.redirect("/");
  }
  if (pathname === "/musikk" && !flags.music) {
    return context.redirect("/");
  }
  if (pathname === "/kart" && !flags.map) {
    return context.redirect("/");
  }
  if (pathname === "/galleri" && !flags.gallery) {
    return context.redirect("/");
  }
  // A null-body 404 from middleware would be rerouted to Astro's error page; JSON keeps it an API answer.
  if (pathname.startsWith("/api/galleri") && !flags.gallery) {
    return json({ error: "Ikke funnet." }, 404);
  }

  return next();
};
