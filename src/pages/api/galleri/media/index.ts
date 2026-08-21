import type { APIRoute } from "astro";
import { env } from "../../../../runtime";
import {
  checkUploadQuota,
  createItem,
  GALLERY_UNAVAILABLE,
  getDeviceId,
  getGalleryBindings,
  hashIp,
  uploadsOpen,
  validateCreatePayload,
} from "../../../../services/gallery";
import { json } from "../../../../utils/http";

/**
 * Step 1 of an upload: register the item and get an id. The bytes follow as
 * PUT /media/:id/:variant and the row becomes visible on POST /media/:id/complete.
 */
export const POST: APIRoute = async (context) => {
  const bindings = getGalleryBindings(env);
  if (!bindings) return json(GALLERY_UNAVAILABLE, 503);
  if (!uploadsOpen(context.locals))
    return json({ error: "Opplasting er stengt." }, 403);

  const deviceId = getDeviceId(context.request);
  if (!deviceId) return json({ error: "Mangler enhets-id." }, 400);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Ugyldig forespørsel." }, 400);
  }
  const v = validateCreatePayload(body);
  if (!v.ok) return json({ error: v.error }, 400);

  const now = Date.now();
  const ipHash = hashIp(context.clientAddress || "unknown-ip", env);
  try {
    const quota = await checkUploadQuota(bindings.db, {
      deviceId,
      ipHash,
      now,
    });
    if (!quota.allowed) {
      return json(
        {
          error:
            "Du har lastet opp mange filer på kort tid – prøv igjen om en liten stund.",
        },
        429,
      );
    }
    const id = crypto.randomUUID();
    await createItem(bindings.db, {
      id,
      kind: v.value.kind,
      createdAt: now,
      name: v.value.name,
      deviceId,
      ipHash,
      width: v.value.width,
      height: v.value.height,
      durationMs: v.value.durationMs,
      originalMime: v.value.mime,
    });
    return json({ id }, 201);
  } catch (err) {
    console.error("Gallery create failed:", err);
    return json({ error: "Noe gikk galt. Prøv igjen." }, 500);
  }
};
