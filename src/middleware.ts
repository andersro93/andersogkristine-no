import { defineMiddleware } from "astro:middleware";
import { env as rawEnv } from "cloudflare:workers";

const env = rawEnv as Env;

import { fetchFeatureFlags, fetchInviteByCode } from "./services/notion";
import {
  checkRateLimit,
  generateSessionCookie,
  recordFailedAttempt,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  verifySessionCookie,
} from "./services/pin";

const invalidCodes = ["evig-troskap"];

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const { pathname, searchParams } = url;

  // Exclude auth routes and static assets from protection
  const isPinPage = pathname === "/pin";
  const isValidatePinApi = pathname === "/api/validate-pin";
  const isRsvpPage = pathname === "/rsvp";
  const isRsvpApi = pathname === "/api/rsvp";

  const isStaticAsset =
    pathname.startsWith("/_") ||
    pathname.startsWith("/fonts/") ||
    pathname === "/favicon.svg" ||
    pathname === "/robots.txt";

  if (isRsvpPage && invalidCodes.includes(searchParams.get("code") ?? "")) {
    return context.redirect(pathname, 302);
  }

  if (
    isPinPage ||
    isValidatePinApi ||
    isRsvpPage ||
    isRsvpApi ||
    isStaticAsset
  ) {
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

  if (!isAuthed) {
    return redirectToPin();
  }

  // Retrieve feature flags
  let flags: Record<string, boolean> = {
    rsvp: true,
    seating: true,
    music: true,
    map: true,
  };
  try {
    const fetchedFlags = await fetchFeatureFlags(
      env,
      context.locals?.cfContext,
    );
    if (fetchedFlags) {
      flags = fetchedFlags;
    }
  } catch (err) {
    console.error("Failed to load feature flags in middleware:", err);
  }

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

  return next();
});
