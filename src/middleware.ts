import { defineMiddleware } from "astro:middleware";
import { env as rawEnv } from "cloudflare:workers";

const env = rawEnv as Env;

import { fetchFeatureFlags, fetchInviteByCode } from "./services/notion";
import { generateSessionCookie, verifySessionCookie } from "./services/pin";

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // Exclude auth routes and static assets from protection
  const isPinPage = pathname === "/pin";
  const isValidatePinApi = pathname === "/api/validate-pin";

  const isStaticAsset =
    pathname.startsWith("/_") ||
    pathname.startsWith("/fonts/") ||
    pathname === "/favicon.svg" ||
    pathname === "/robots.txt";

  if (isPinPage || isValidatePinApi || isStaticAsset) {
    return next();
  }

  // Retrieve cookie and check validity
  const sessionCookie = context.cookies.get("wedding_access");
  let isAuthed = sessionCookie
    ? verifySessionCookie(sessionCookie.value, env)
    : false;

  // Check if code query param is present
  const code = url.searchParams.get("code");
  if (code && !isAuthed) {
    try {
      const invite = await fetchInviteByCode(code, env);
      if (invite) {
        // Valid invite: generate and set cookie
        const newCookieValue = generateSessionCookie(env);
        context.cookies.set("wedding_access", newCookieValue, {
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "strict",
          maxAge: 30 * 24 * 60 * 60, // 30 days
        });
        isAuthed = true;
      } else {
        // Invalid code: redirect to /pin with error and next
        const redirectUrl = new URL("/pin", url.origin);
        redirectUrl.searchParams.set("error", "invalid_invite");
        redirectUrl.searchParams.set("next", pathname + url.search);
        return context.redirect(redirectUrl.pathname + redirectUrl.search);
      }
    } catch (err) {
      console.error("Error verifying invite code in middleware:", err);
      const redirectUrl = new URL("/pin", url.origin);
      redirectUrl.searchParams.set("error", "verification_error");
      redirectUrl.searchParams.set("next", pathname + url.search);
      return context.redirect(redirectUrl.pathname + redirectUrl.search);
    }
  }

  if (!isAuthed) {
    const redirectUrl = new URL("/pin", url.origin);
    redirectUrl.searchParams.set("next", pathname + url.search);
    return context.redirect(redirectUrl.pathname + redirectUrl.search);
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
