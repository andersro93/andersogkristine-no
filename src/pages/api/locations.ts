import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { fetchLocationsFromNotion } from "../../services/notion";
import { json } from "../../utils/http";

export const GET: APIRoute = async (context) => {
  try {
    const locations = await fetchLocationsFromNotion(
      env as Env,
      context.locals?.cfContext,
    );
    return json(locations, 200, { "Cache-Control": "private, max-age=10" });
  } catch (error) {
    console.error("Error in Locations API endpoint:", error);
    return json({ error: "Klarte ikke å hente lokasjoner." }, 500);
  }
};
