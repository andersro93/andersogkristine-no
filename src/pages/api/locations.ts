import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { fetchLocationsFromNotion } from "../../services/notion";

export const GET: APIRoute = async (context) => {
  try {
    const cloudflareContext = context.locals.runtime?.context;

    const locations = await fetchLocationsFromNotion(
      env as Env,
      cloudflareContext,
    );

    return new Response(JSON.stringify(locations), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=10, s-maxage=60",
      },
    });
  } catch (error) {
    console.error("Error in Locations API endpoint:", error);
    return new Response(
      JSON.stringify({ error: "Klarte ikke å hente lokasjoner." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
