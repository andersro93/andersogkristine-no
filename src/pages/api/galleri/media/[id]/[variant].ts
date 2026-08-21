import type { APIRoute } from "astro";
import { env } from "../../../../../runtime";
import {
  allowedMimeFor,
  clearVariant,
  GALLERY_UNAVAILABLE,
  getDeviceId,
  getGalleryBindings,
  getItem,
  isUuid,
  isVariant,
  mimeMatchesSniff,
  normalizeContentType,
  setVariant,
  sizeCapFor,
  sniffMime,
  variantKey,
} from "../../../../../services/gallery";
import { json } from "../../../../../utils/http";

const ABORTED = { error: "Opplastingen ble avbrutt. Prøv igjen." };

/**
 * Step 2: stream one variant (thumb | display | original) straight into R2.
 * Requires Content-Length (R2 needs a known length; FixedLengthStream also
 * enforces it), checks the declared type against the first bytes afterwards,
 * and only then records the key on the row.
 */
export const PUT: APIRoute = async (context) => {
  const { id, variant } = context.params;
  if (!isUuid(id) || !isVariant(variant))
    return json({ error: "Ikke funnet." }, 404);
  const bindings = getGalleryBindings(env);
  if (!bindings) return json(GALLERY_UNAVAILABLE, 503);
  const deviceId = getDeviceId(context.request);
  if (!deviceId) return json({ error: "Mangler enhets-id." }, 400);
  const { db, bucket } = bindings;
  const { request } = context;

  try {
    const row = await getItem(db, id);
    if (!row) return json({ error: "Ikke funnet." }, 404);
    if (row.device_id !== deviceId)
      return json({ error: "Ingen tilgang." }, 403);
    if (row.status !== "uploading") {
      return json({ error: "Opplastingen er allerede fullført." }, 409);
    }

    const contentType = normalizeContentType(
      request.headers.get("content-type"),
    );
    const ext = contentType
      ? allowedMimeFor(row.kind, variant)[contentType]
      : undefined;
    if (!contentType || !ext)
      return json({ error: "Filformatet støttes ikke." }, 415);
    if (variant === "original" && contentType !== row.original_mime) {
      return json(
        { error: "Filformatet samsvarer ikke med det som ble meldt inn." },
        415,
      );
    }

    const length = Number(request.headers.get("content-length"));
    if (!Number.isInteger(length) || length <= 0 || !request.body) {
      return json({ error: "Mangler Content-Length." }, 411);
    }
    if (length > sizeCapFor(row.kind, variant))
      return json({ error: "Filen er for stor." }, 413);

    const stream =
      typeof FixedLengthStream === "undefined"
        ? request.body
        : request.body.pipeThrough(new FixedLengthStream(length));
    const key = variantKey(id, variant, ext);

    // Undo a rejected put: delete the R2 object and null the D1 column so
    // D1 never references a missing object (the key is deterministic, so a
    // retried PUT would otherwise leave a dangling reference to whatever
    // succeeded before).
    const discard = async () => {
      try {
        await bucket.delete(key);
        await clearVariant(db, id, variant);
      } catch (err) {
        console.error("Gallery discard failed:", err);
      }
    };

    let stored: R2Object | null = null;
    try {
      stored = await bucket.put(key, stream, { httpMetadata: { contentType } });
    } catch (err) {
      console.error("Gallery R2 put failed:", err);
    }
    if (!stored || stored.size !== length) {
      await discard();
      return json(ABORTED, 400);
    }

    const head = await bucket.get(key, { range: { offset: 0, length: 16 } });
    const sniffed =
      head && "body" in head
        ? sniffMime(new Uint8Array(await head.arrayBuffer()))
        : null;
    if (!mimeMatchesSniff(contentType, sniffed)) {
      await discard();
      return json(
        {
          error: "Filen ser ikke ut som et gyldig bilde eller en gyldig video.",
        },
        415,
      );
    }

    await setVariant(db, id, variant, key, length);
    return json({ ok: true });
  } catch (err) {
    console.error("Gallery upload failed:", err);
    return json({ error: "Noe gikk galt. Prøv igjen." }, 500);
  }
};
