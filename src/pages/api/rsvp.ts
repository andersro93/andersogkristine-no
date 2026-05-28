import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { updateGuestRSVP } from "../../services/notion";

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const { guests } = body;

    if (!guests || !Array.isArray(guests)) {
      return new Response(
        JSON.stringify({ error: "Ugyldig forespørsel. Gjester mangler." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Update each guest in Notion
    const updatePromises = guests.map(
      (guest: {
        id: string;
        rsvp: string;
        allergies?: string;
        comment?: string;
      }) =>
        updateGuestRSVP(
          guest.id,
          guest.rsvp,
          guest.allergies || "",
          guest.comment || "",
        ),
    );
    await Promise.all(updatePromises);

    // Invalidate the seating cache in Cloudflare KV
    const kv = env?.WEDDING_CACHE;
    if (kv) {
      try {
        await kv.delete("seating_data");
        console.log("Seating cache successfully busted in KV.");
      } catch (cacheErr) {
        console.error("Failed to delete KV cache:", cacheErr);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in RSVP API endpoint:", error);
    return new Response(
      JSON.stringify({
        error: "Klarte ikke å lagre svar. Vennligst prøv igjen.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
