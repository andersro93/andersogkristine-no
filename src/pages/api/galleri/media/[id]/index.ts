import type { APIRoute } from "astro";
import { env } from "../../../../../runtime";
import {
  GALLERY_UNAVAILABLE,
  getDeviceId,
  getGalleryBindings,
  getItem,
  isGalleryAdmin,
  isUuid,
  setHidden,
} from "../../../../../services/gallery";
import { json } from "../../../../../utils/http";

/** Soft-hide. Owners (same device) and admins may; the R2 objects stay. */
export const DELETE: APIRoute = async (context) => {
  const { id } = context.params;
  if (!isUuid(id)) return json({ error: "Ikke funnet." }, 404);
  const bindings = getGalleryBindings(env);
  if (!bindings) return json(GALLERY_UNAVAILABLE, 503);

  try {
    const row = await getItem(bindings.db, id);
    if (!row) return json({ error: "Ikke funnet." }, 404);
    const admin = isGalleryAdmin(context.cookies, env);
    const deviceId = getDeviceId(context.request);
    if (!admin && (!deviceId || row.device_id !== deviceId)) {
      return json({ error: "Ingen tilgang." }, 403);
    }
    await setHidden(bindings.db, id, admin ? "admin" : "owner", Date.now());
    return json({ ok: true });
  } catch (err) {
    console.error("Gallery delete failed:", err);
    return json({ error: "Noe gikk galt. Prøv igjen." }, 500);
  }
};
