/** JSON response helper for API routes. */
export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Shared user-facing payload when Spotify is not configured in production. */
export const SPOTIFY_UNAVAILABLE = {
  error: "Musikkønsker er ikke tilgjengelig akkurat nå.",
  unavailable: true,
} as const;
