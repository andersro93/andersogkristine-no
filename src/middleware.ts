import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
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

  return next();
});
