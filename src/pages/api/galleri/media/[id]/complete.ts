import type { APIRoute } from "astro";
import { env } from "../../../../../runtime";
import {
  GALLERY_UNAVAILABLE,
  getDeviceId,
  getGalleryBindings,
  getItem,
  isUuid,
  markReady,
  toGalleryItem,
  type Variant,
} from "../../../../../services/gallery";
import { json } from "../../../../../utils/http";

/**
 * Step 3: make the item visible. Images need thumb + display (the original is
 * a bonus); videos need the original (poster optional). Idempotent.
 */
export const POST: APIRoute = async (context) => {
  const { id } = context.params;
  if (!isUuid(id)) return json({ error: "Ikke funnet." }, 404);
  const bindings = getGalleryBindings(env);
  if (!bindings) return json(GALLERY_UNAVAILABLE, 503);
  const deviceId = getDeviceId(context.request);
  if (!deviceId) return json({ error: "Mangler enhets-id." }, 400);

  try {
    const row = await getItem(bindings.db, id);
    if (!row) return json({ error: "Ikke funnet." }, 404);
    if (row.device_id !== deviceId)
      return json({ error: "Ingen tilgang." }, 403);

    if (row.status === "uploading") {
      const missing: Variant[] = [];
      if (row.kind === "image") {
        if (!row.thumb_key) missing.push("thumb");
        if (!row.display_key) missing.push("display");
      } else if (!row.original_key) {
        missing.push("original");
      }
      if (missing.length > 0) {
        return json({ error: "Opplastingen er ikke komplett.", missing }, 409);
      }
      await markReady(bindings.db, id, Date.now());
    }

    const ready = await getItem(bindings.db, id);
    if (!ready) return json({ error: "Ikke funnet." }, 404);
    return json({ item: toGalleryItem(ready, { deviceId }) });
  } catch (err) {
    console.error("Gallery complete failed:", err);
    return json({ error: "Noe gikk galt. Prøv igjen." }, 500);
  }
};
