import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import type { TableWithGuests } from "../../services/notion";
import { fetchAllSeatingData } from "../../services/notion";

export const GET: APIRoute = async (_context) => {
  try {
    const kv = env?.WEDDING_CACHE;
    let seatingData: TableWithGuests[] | null = null;
    let cacheHit = false;

    // 1. Try to fetch from Cloudflare KV
    if (kv) {
      try {
        const cached = await kv.get("seating_data");
        if (cached) {
          seatingData = JSON.parse(cached);
          cacheHit = true;
          console.log("Seating chart cache hit!");
        }
      } catch (cacheErr) {
        console.error("Error reading from KV cache:", cacheErr);
      }
    }

    // 2. Fetch fresh from Notion on cache miss
    if (!seatingData) {
      console.log("Seating chart cache miss, fetching from Notion...");
      seatingData = await fetchAllSeatingData(env);

      // Save to KV cache with a 60-second expiration (TTL)
      if (kv) {
        try {
          await kv.put("seating_data", JSON.stringify(seatingData), {
            expirationTtl: 60,
          });
          console.log("Saved seating chart to KV cache.");
        } catch (cacheErr) {
          console.error("Error writing to KV cache:", cacheErr);
        }
      }
    }

    return new Response(JSON.stringify(seatingData), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Cache": cacheHit ? "HIT" : "MISS",
        "Cache-Control": "public, max-age=10, s-maxage=60",
      },
    });
  } catch (error) {
    console.error("Error in Seating API endpoint:", error);
    return new Response(
      JSON.stringify({ error: "Klarte ikke å hente bordoppsett." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
