import { defineMiddleware } from "astro:middleware";
import { env as rawEnv } from "cloudflare:workers";

const env = rawEnv as Env;

import { fetchFeatureFlags } from "./services/notion";
import { verifySessionCookie } from "./services/pin";

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
  const isAuthed = sessionCookie
    ? verifySessionCookie(sessionCookie.value, env)
    : false;

  if (!isAuthed) {
    return context.redirect("/pin");
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
      context.locals?.runtime?.context,
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
