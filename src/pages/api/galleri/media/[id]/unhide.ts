import type { APIRoute } from "astro";
import { env } from "../../../../../runtime";
import {
  clearHidden,
  GALLERY_UNAVAILABLE,
  getGalleryBindings,
  getItem,
  isGalleryAdmin,
  isUuid,
} from "../../../../../services/gallery";
import { json } from "../../../../../utils/http";

/** Admin-only: make a hidden item visible again. */
export const POST: APIRoute = async (context) => {
  const { id } = context.params;
  if (!isUuid(id)) return json({ error: "Ikke funnet." }, 404);
  const bindings = getGalleryBindings(env);
  if (!bindings) return json(GALLERY_UNAVAILABLE, 503);
  if (!isGalleryAdmin(context.cookies, env))
    return json({ error: "Ingen tilgang." }, 403);

  try {
    const row = await getItem(bindings.db, id);
    if (!row) return json({ error: "Ikke funnet." }, 404);
    await clearHidden(bindings.db, id);
    return json({ ok: true });
  } catch (err) {
    console.error("Gallery unhide failed:", err);
    return json({ error: "Noe gikk galt. Prøv igjen." }, 500);
  }
};
