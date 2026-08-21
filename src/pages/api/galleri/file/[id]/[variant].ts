import type { APIRoute } from "astro";
import { env } from "../../../../../runtime";
import {
  GALLERY_UNAVAILABLE,
  getGalleryBindings,
  getItem,
  isGalleryAdmin,
  isUuid,
  isVariant,
  resolveRange,
} from "../../../../../services/gallery";
import { json } from "../../../../../utils/http";

const CACHE_CONTROL = "private, max-age=31536000, immutable";

/**
 * Serve one variant from R2. Passes Range/If-None-Match straight through so
 * <video> can seek (Safari probes `bytes=0-1` first) and browsers can
 * revalidate. Hidden or unfinished items are 404 for everyone but admins.
 */
export const GET: APIRoute = async (context) => {
  const { id, variant } = context.params;
  if (!isUuid(id) || !isVariant(variant))
    return json({ error: "Ikke funnet." }, 404);
  const bindings = getGalleryBindings(env);
  if (!bindings) return json(GALLERY_UNAVAILABLE, 503);

  try {
    const row = await getItem(bindings.db, id);
    if (!row) return json({ error: "Ikke funnet." }, 404);
    const visible = row.status === "ready" && row.hidden_at === null;
    if (!visible && !isGalleryAdmin(context.cookies, env))
      return json({ error: "Ikke funnet." }, 404);

    const key =
      variant === "thumb"
        ? row.thumb_key
        : variant === "display"
          ? row.display_key
          : row.original_key;
    if (!key) return json({ error: "Ikke funnet." }, 404);

    let object: R2Object | R2ObjectBody | null;
    try {
      object = await bindings.bucket.get(key, {
        range: context.request.headers,
        onlyIf: context.request.headers,
      });
    } catch {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": "bytes */0" },
      });
    }
    if (!object) return json({ error: "Ikke funnet." }, 404);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", CACHE_CONTROL);

    if (!("body" in object))
      return new Response(null, { status: 304, headers });

    const range = resolveRange(object.range, object.size);
    if (range) {
      headers.set(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${object.size}`,
      );
      headers.set("Content-Length", String(range.end - range.start + 1));
      return new Response(object.body, { status: 206, headers });
    }
    headers.set("Content-Length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  } catch (err) {
    console.error("Gallery file failed:", err);
    return json({ error: "Noe gikk galt." }, 500);
  }
};
